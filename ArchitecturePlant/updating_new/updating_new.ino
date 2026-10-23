#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <ModbusMaster.h>
#include <ArduinoJson.h>
#include <SD.h>
#include <Wire.h>
#include <RTClib.h>

// ================= PLANT CONFIGURATION =================
// Set this once when flashing. Each device gets a unique number.
// Register this ID in the Admin Dashboard → assign it to a plant name.
#define PLANT_ID "202326"

// ================= W5500 ETHERNET PINS =================
#define W5500_MISO 12
#define W5500_MOSI 13
#define W5500_SCK  14
#define W5500_CS   15
#define W5500_RST  25

// ================= SD CARD (HSPI) PINS =================
#define SD_MISO 19 
#define SD_MOSI 23 
#define SD_SCK  18 
#define SD_CS   5   // GPIO 5 as configured

// ================= RTC DS3231 (I2C) PINS =================
#define RTC_SDA 21
#define RTC_SCL 22

// ================= RS485 / MODBUS PINS =================
#define MAX485_RE_DE 4
#define RX2_PIN 32
#define TX2_PIN 33

// ================= NETWORK SETTINGS =================
byte mac[] = {0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED};

IPAddress ip(192, 168, 0, 229);
IPAddress gateway(192, 168, 0, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress dns(8, 8, 8, 8);

IPAddress remoteIP(192, 168, 0, 159);
const unsigned int remotePort = 10011;
const unsigned int localPort  = 8888;

const char* offlineFileName = "/offline_data.json";

// ================= GLOBAL OBJECTS =================
EthernetUDP Udp;
ModbusMaster node;
RTC_DS3231 rtc;
SPIClass spiSD(HSPI);

// Hardware status flags
bool rtcReady = false;
bool sdReady  = false;
bool wasNetworkConnected = false;

// ================= TIMING VARIABLES =================
unsigned long previousDataMillis = 0;
const unsigned long dataInterval = 60000; // 60 seconds interval

// ================= METERS CONFIGURATION =================
#define MIN_SLAVE_ID  1
#define MAX_SLAVE_ID  32

// Schneider iEM3xxx series kWh register (Wh delivered, 32-bit float, 2 registers)
uint16_t SCH_KWH_REG = 2699;

// ================= CONSECUTIVE FAIL TRACKING =================
#define OFFLINE_CONFIRM_COUNT 3
uint8_t failCount[MAX_SLAVE_ID + 1] = {0};
bool    knownConnected[MAX_SLAVE_ID + 1] = {false};

// ================= RS485 DIRECTION CONTROL =================
void preTransmission() {
  digitalWrite(MAX485_RE_DE, HIGH);
}

void postTransmission() {
  digitalWrite(MAX485_RE_DE, LOW);
}

// ================= FLOAT DECODING =================
float decodeNormal(uint16_t r1, uint16_t r2) {
  uint32_t val = ((uint32_t)r1 << 16) | r2;
  float f;
  memcpy(&f, &val, 4);
  return f;
}

// ================= READ KWH VIA MODBUS =================
uint8_t readKwh(uint8_t slave, float &value) {
  node.begin(slave, Serial2);

  while (Serial2.available()) {
    Serial2.read();
  }

  uint8_t res = node.readHoldingRegisters(SCH_KWH_REG, 2);

  // If failed due to CRC noise or temporary glitch, retry once after 20ms
  if (res != node.ku8MBSuccess) {
    delay(20);
    while (Serial2.available()) {
      Serial2.read();
    }
    res = node.readHoldingRegisters(SCH_KWH_REG, 2);
  }

  if (res == node.ku8MBSuccess) {
    uint16_t r1 = node.getResponseBuffer(0);
    uint16_t r2 = node.getResponseBuffer(1);
    value = round(decodeNormal(r1, r2) * 100) / 100.0;
    return 0; // SUCCESS
  }

  value = -1;

  if (res == node.ku8MBResponseTimedOut) {
    return 1; // TIMEOUT
  }
  if (res == node.ku8MBInvalidCRC) {
    return 2; // CRC ERROR
  }
  return 3;   // OTHER ERROR
}

// ================= RTC TIMESTAMP HELPER =================
String getTimestamp() {
  if (rtcReady) {
    DateTime now = rtc.now();
    char buffer[25];
    snprintf(buffer, sizeof(buffer), "%04d-%02d-%02d %02d:%02d:%02d",
             now.year(), now.month(), now.day(),
             now.hour(), now.minute(), now.second());
    return String(buffer);
  }
  return "2000-01-01 00:00:00";
}

// ================= NETWORK CONNECTIVITY CHECK =================
bool isNetworkAvailable() {
  if (Ethernet.hardwareStatus() == EthernetNoHardware) {
    return false;
  }
  return (Ethernet.linkStatus() == LinkON && Ethernet.localIP() != IPAddress(0, 0, 0, 0));
}

// ================= ETHERNET INITIALIZATION & RECOVERY =================
unsigned long lastEthCheckMillis = 0;
const unsigned long ethCheckInterval = 15000; // Check every 15 seconds if network is down

void initEthernet() {
  Serial.println("[ETH] Initializing W5500 Ethernet...");

  pinMode(W5500_CS, OUTPUT);
  digitalWrite(W5500_CS, HIGH);

  pinMode(W5500_RST, OUTPUT);
  digitalWrite(W5500_RST, LOW);
  delay(150);
  digitalWrite(W5500_RST, HIGH);
  delay(200);

  SPI.begin(W5500_SCK, W5500_MISO, W5500_MOSI, W5500_CS);
  Ethernet.init(W5500_CS);
  Ethernet.begin(mac, ip, dns, gateway, subnet);

  delay(500);

  Serial.print("[ETH] IP Address: ");
  Serial.println(Ethernet.localIP());

  Udp.stop();
  if (Udp.begin(localPort)) {
    Serial.printf("[UDP] Listening on port %d, transmitting to %s:%d\n", 
                  localPort, remoteIP.toString().c_str(), remotePort);
  } else {
    Serial.println("[UDP] ERROR: Failed to bind local UDP port.");
  }
}

void maintainEthernet() {
  unsigned long now = millis();
  if (now - lastEthCheckMillis < ethCheckInterval) {
    return;
  }
  lastEthCheckMillis = now;

  if (!isNetworkAvailable()) {
    Serial.println("[ETH] Network unavailable or W5500 unresponsive. Attempting auto-recovery...");
    initEthernet();
  }
}

// ================= SEND UDP PACKET =================
bool sendToDashboard(const char* jsonPayload, size_t len) {
  if (!isNetworkAvailable()) {
    return false;
  }

  if (Udp.beginPacket(remoteIP, remotePort)) {
    Udp.write((const uint8_t*)jsonPayload, len);
    int ok = Udp.endPacket();
    return (ok == 1);
  }
  return false;
}

// ================= SD CARD STORE AND FORWARD =================
void logToSD(const char* jsonPayload) {
  if (!sdReady) {
    Serial.println("[SD] Cannot log: SD card unavailable.");
    return;
  }

  // Deselect Ethernet during SD transaction
  digitalWrite(W5500_CS, HIGH);

  File dataFile = SD.open(offlineFileName, FILE_APPEND);
  if (dataFile) {
    dataFile.println(jsonPayload);
    dataFile.flush();
    dataFile.close();
    Serial.println("[SD] Offline record appended successfully.");
  } else {
    Serial.println("[SD] Error opening file for writing!");
  }
}

bool pushOfflineData() {
  if (!sdReady || !isNetworkAvailable()) {
    return false;
  }

  digitalWrite(W5500_CS, HIGH);

  if (!SD.exists(offlineFileName)) {
    return true; // Nothing to push
  }

  File dataFile = SD.open(offlineFileName, FILE_READ);
  if (!dataFile) {
    Serial.println("[SD] Failed to open offline data for reading.");
    return false;
  }

  Serial.println("[SD] Found offline data. Flushing backlog to server...");

  bool allSent = true;

  while (dataFile.available()) {
    String line = dataFile.readStringUntil('\n');
    line.trim();

    if (line.length() > 0) {
      bool sent = sendToDashboard(line.c_str(), line.length());
      if (!sent) {
        Serial.println("[SD] Offline push interrupted (network drop). Retaining remaining data.");
        allSent = false;
        break;
      }
      delay(30); // Prevent UDP socket congestion
      yield();   // Prevent Watchdog Timer reset
    }
  }

  dataFile.close();

  if (allSent) {
    SD.remove(offlineFileName);
    Serial.println("[SD] All offline data sent. SD buffer cleared.");
    return true;
  }

  return false;
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n--- Initializing EMS Energy Meter Logger ---");

  // 1. Initialize RS485
  pinMode(MAX485_RE_DE, OUTPUT);
  digitalWrite(MAX485_RE_DE, LOW);
  Serial2.begin(9600, SERIAL_8E1, RX2_PIN, TX2_PIN);
  node.preTransmission(preTransmission);
  node.postTransmission(postTransmission);
  Serial.println("[RS485] Modbus initialized.");

  // 2. Initialize RTC DS3231
  Wire.begin(RTC_SDA, RTC_SCL);
  if (rtc.begin()) {
    rtcReady = true;
    Serial.print("[RTC] DS3231 detected. Current time: ");
    Serial.println(getTimestamp());
  } else {
    Serial.println("[RTC] WARNING: RTC DS3231 not detected!");
  }

  // 3. Initialize SD Card (HSPI)
  pinMode(SD_CS, OUTPUT);
  digitalWrite(SD_CS, HIGH);

  spiSD.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (SD.begin(SD_CS, spiSD, 4000000)) {
    sdReady = true;
    Serial.println("[SD] MicroSD card initialized successfully.");
  } else {
    Serial.println("[SD] WARNING: SD card initialization failed! Check wiring & CS pin.");
  }

  // 4. Initialize W5500 Ethernet
  initEthernet();
  Serial.print("[ETH] Plant ID: ");
  Serial.println(PLANT_ID);

  wasNetworkConnected = isNetworkAvailable();
  Serial.printf("[SYSTEM] Setup complete. Scanning Modbus meters %d to %d\n", MIN_SLAVE_ID, MAX_SLAVE_ID);
}

// ================= MAIN LOOP =================
void loop() {
  maintainEthernet();

  unsigned long currentMillis = millis();
  bool currentNetworkConnected = isNetworkAvailable();

  // ---------------------------------------------------------
  // TASK 1: Immediate Backlog Flush on Network Restoration
  // ---------------------------------------------------------
  if (currentNetworkConnected && !wasNetworkConnected) {
    Serial.println("[NET] Ethernet link restored!");
    if (sdReady && SD.exists(offlineFileName)) {
      pushOfflineData();
    }
  }
  wasNetworkConnected = currentNetworkConnected;

  // ---------------------------------------------------------
  // TASK 2: Scan Meters & Send / Log Every 60 Seconds
  // ---------------------------------------------------------
  if (currentMillis - previousDataMillis >= dataInterval || previousDataMillis == 0) {
    previousDataMillis = currentMillis;

    Serial.println("\n--- Starting Meter Scan Cycle ---");
    String timeStamp = getTimestamp();

    // Prepare JSON Document
    StaticJsonDocument<4096> doc;
    doc["device"]    = PLANT_ID;
    doc["timestamp"] = timeStamp;

    JsonArray meterArray = doc.createNestedArray("meters");
    uint8_t respondingCount = 0;
    uint8_t offlineCount    = 0;

    // Scan Modbus meters
    for (uint8_t slave = MIN_SLAVE_ID; slave <= MAX_SLAVE_ID; slave++) {
      float kwh = 0;
      uint8_t result = readKwh(slave, kwh);

      Serial.printf("Meter ID: %2d | ", slave);

      if (result == 0) {
        Serial.printf("OK     | KWH: %.2f\n", kwh);
        knownConnected[slave] = true;
        failCount[slave]      = 0;

        JsonObject meter = meterArray.createNestedObject();
        meter["id"]     = slave;
        meter["status"] = "OK";
        meter["kwh"]    = kwh;
        respondingCount++;

      } else if (result == 1) {
        failCount[slave]++;
        if (!knownConnected[slave]) {
          Serial.println("EMPTY  | (never connected, skip)");
          continue;
        }

        Serial.printf("FAIL %d/%d | Was connected, now no response\n",
                      failCount[slave], OFFLINE_CONFIRM_COUNT);

        if (failCount[slave] >= OFFLINE_CONFIRM_COUNT) {
          Serial.println("         -> CONFIRMED OFFLINE");
          JsonObject meter = meterArray.createNestedObject();
          meter["id"]     = slave;
          meter["status"] = "OFFLINE";
          offlineCount++;
        }

      } else if (result == 2) {
        failCount[slave]++;
        Serial.printf("CRC_ERR %d/%d| Wiring noise on address %d\n", 
                      failCount[slave], OFFLINE_CONFIRM_COUNT, slave);
        if (knownConnected[slave] && failCount[slave] >= OFFLINE_CONFIRM_COUNT) {
          JsonObject meter = meterArray.createNestedObject();
          meter["id"]     = slave;
          meter["status"] = "CRC_ERROR";
          offlineCount++;
        }

      } else {
        Serial.printf("ERR 0x%02X| Modbus error on address %d\n", result, slave);
      }

      delay(80); // Prevent RS485 bus collisions
      yield();
    }

    // Serialize JSON
    char buffer[4096];
    size_t len = serializeJson(doc, buffer);

    Serial.println("\n========== JSON PAYLOAD ==========");
    Serial.println(buffer);
    Serial.printf("Responding: %d | Offline: %d\n", respondingCount, offlineCount);

    // Delivery: Online push or Offline SD buffering
    if (!currentNetworkConnected) {
      Serial.println("[NET] Network offline. Saving readings to SD card.");
      logToSD(buffer);
    } else {
      // First flush backlog if any
      if (sdReady && SD.exists(offlineFileName)) {
        pushOfflineData();
      }

      Serial.println("[UDP] Sending live telemetry...");
      bool success = sendToDashboard(buffer, len);

      if (!success) {
        Serial.println("[UDP] Transmission failed! Saving to SD card instead.");
        logToSD(buffer);
      } else {
        Serial.println("[UDP] Live telemetry successfully delivered.");
      }
    }
  }

  yield();
}