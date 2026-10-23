
#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <ModbusMaster.h>
#include <ArduinoJson.h>
#include <SD.h>
#include <Wire.h>
#include <RTClib.h>
#include <math.h>
#include <string.h>

// =====================================================
// CONFIGURATION
// =====================================================
#define PLANT_ID "20246"
#define DEVICE_ID "ESP32_20246"

// W5500
#define W5500_MISO 12
#define W5500_MOSI 13
#define W5500_SCK  14
#define W5500_CS   15
#define W5500_RST  25

byte mac[] = {0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED};

IPAddress ip(192, 168, 0, 229);
IPAddress gateway(192, 168, 0, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress dns(8, 8, 8, 8);

IPAddress remoteIP(192, 168, 0, 159);
const uint16_t remotePort = 10011;
const uint16_t localUdpPort = 8888;

EthernetUDP Udp;

// RS485 / Modbus
#define MAX485_RE_DE 4
#define RX2_PIN 32
#define TX2_PIN 33

const uint8_t SLAVE_ID = 1;
const uint16_t FREQUENCY_REGISTER = 156;
const uint32_t POLL_INTERVAL_MS = 5000;

ModbusMaster node;

// DS3231
#define RTC_SDA_PIN 21
#define RTC_SCL_PIN 5

RTC_DS3231 rtc;

// SD card
#define SD_CS_PIN   27
#define SD_SCK_PIN  18
#define SD_MISO_PIN 19
#define SD_MOSI_PIN 23

const char* LOG_FILE = "/modbus_log.csv";

// IMPORTANT:
// This assumes a classic ESP32 with separate VSPI and HSPI hosts.
// The Ethernet library uses global SPI; SD uses HSPI.
SPIClass sdSPI(HSPI);

// Device states
bool rtcReady = false;
bool sdReady = false;
bool ethernetReady = false;
bool udpReady = false;

unsigned long lastPoll = 0;

// =====================================================
// RS485 DIRECTION
// =====================================================
void preTransmission() {
  digitalWrite(MAX485_RE_DE, HIGH);
}

void postTransmission() {
  digitalWrite(MAX485_RE_DE, LOW);
}

// =====================================================
// FLOAT32 CONVERSION
// Low word first, preserving your current working result.
// =====================================================
float registersToFloat(uint16_t firstWord, uint16_t secondWord) {
  union {
    uint32_t bits;
    float value;
  } decoded;

  decoded.bits =
      ((uint32_t)secondWord << 16) | firstWord;

  return decoded.value;
}

// =====================================================
// RTC TIMESTAMP
// =====================================================
String getTimestamp() {
  if (!rtcReady) {
    return "RTC_UNAVAILABLE";
  }

  DateTime now = rtc.now();

  char buffer[24];

  snprintf(
    buffer, sizeof(buffer),
    "%04d-%02d-%02d %02d:%02d:%02d",
    now.year(), now.month(), now.day(),
    now.hour(), now.minute(), now.second()
  );

  return String(buffer);
}

// =====================================================
// RTC INITIALIZATION
// =====================================================
void initializeRTC() {
  Serial.println("\n[RTC] Initializing...");

  Wire.begin(RTC_SDA_PIN, RTC_SCL_PIN);

  if (!rtc.begin()) {
    Serial.println("[RTC] ERROR: DS3231 not detected.");
    return;
  }

  rtcReady = true;

  if (rtc.lostPower()) {
    Serial.println("[RTC] Lost power; setting compile time.");
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }

  Serial.print("[RTC] Current time: ");
  Serial.println(getTimestamp());
}

// =====================================================
// SD FILE CHECK
// =====================================================
bool createCSVIfMissing() {
  if (SD.exists(LOG_FILE)) {
    Serial.println("[SD] CSV file already exists.");
    return true;
  }

  Serial.println("[SD] Creating CSV file...");

  File file = SD.open(LOG_FILE, FILE_WRITE);

  if (!file) {
    Serial.println("[SD] ERROR: CSV creation failed.");
    return false;
  }

  file.println(
    "Timestamp,PlantID,DeviceID,SlaveID,Parameter,"
    "Register,RawWord1,RawWord2,Frequency_Hz,Status"
  );

  file.flush();
  file.close();

  if (!SD.exists(LOG_FILE)) {
    Serial.println("[SD] ERROR: CSV not found after creation.");
    return false;
  }

  Serial.println("[SD] CSV created successfully.");
  return true;
}

// =====================================================
// SD INITIALIZATION
// =====================================================
void initializeSD() {
  Serial.println("\n[SD] Initializing...");

  pinMode(SD_CS_PIN, OUTPUT);
  digitalWrite(SD_CS_PIN, HIGH);

  // Deselect W5500 while initializing SD.
  pinMode(W5500_CS, OUTPUT);
  digitalWrite(W5500_CS, HIGH);

  sdSPI.begin(
    SD_SCK_PIN,
    SD_MISO_PIN,
    SD_MOSI_PIN,
    SD_CS_PIN
  );

  if (!SD.begin(SD_CS_PIN, sdSPI, 400000)) {
    Serial.println("[SD] ERROR: SD.begin() failed.");
    sdReady = false;
    return;
  }

  Serial.println("[SD] Card initialized.");

  uint8_t cardType = SD.cardType();

  if (cardType == CARD_NONE) {
    Serial.println("[SD] ERROR: No card detected.");
    sdReady = false;
    return;
  }

  Serial.print("[SD] Card type: ");

  if (cardType == CARD_MMC) {
    Serial.println("MMC");
  } else if (cardType == CARD_SD) {
    Serial.println("SDSC");
  } else if (cardType == CARD_SDHC) {
    Serial.println("SDHC/SDXC");
  } else {
    Serial.println("Unknown");
  }

  Serial.print("[SD] Capacity: ");
  Serial.print(
    (unsigned long)(SD.cardSize() / (1024ULL * 1024ULL))
  );
  Serial.println(" MB");

  // Verify root directory access.
  File root = SD.open("/");

  if (!root) {
    Serial.println("[SD] ERROR: Cannot open root directory.");
    sdReady = false;
    return;
  }

  root.close();

  if (!createCSVIfMissing()) {
    sdReady = false;
    return;
  }

  // Verify that the file can be opened and written.
  File testFile = SD.open(LOG_FILE, FILE_WRITE);

  if (!testFile) {
    Serial.println("[SD] ERROR: CSV file cannot be opened.");
    sdReady = false;
    return;
  }

  testFile.flush();
  testFile.close();

  sdReady = true;
  Serial.println("[SD] CSV file ready for logging.");
}

// =====================================================
// W5500 ETHERNET
// =====================================================
void initializeEthernet() {
  Serial.println("\n[ETH] Initializing W5500...");

  pinMode(W5500_CS, OUTPUT);
  digitalWrite(W5500_CS, HIGH);

  pinMode(W5500_RST, OUTPUT);
  digitalWrite(W5500_RST, LOW);
  delay(200);
  digitalWrite(W5500_RST, HIGH);
  delay(200);

  // Your tested W5500 initialization approach.
  SPI.begin(
    W5500_SCK,
    W5500_MISO,
    W5500_MOSI,
    W5500_CS
  );

  Ethernet.init(W5500_CS);
  Ethernet.begin(mac, ip, dns, gateway, subnet);
  delay(1000);

  if (Ethernet.hardwareStatus() == EthernetNoHardware) {
    Serial.println("[ETH] ERROR: W5500 not detected.");
    return;
  }

  Serial.print("[ETH] IP: ");
  Serial.println(Ethernet.localIP());

  if (Ethernet.linkStatus() == LinkOFF) {
    Serial.println("[ETH] WARNING: Ethernet link is down.");
    return;
  }

  ethernetReady = true;

  if (Udp.begin(localUdpPort)) {
    udpReady = true;
    Serial.print("[UDP] Listening locally on port ");
    Serial.println(localUdpPort);
  } else {
    Serial.println("[UDP] ERROR: Failed to bind local port.");
  }

  Serial.print("[UDP] Destination: ");
  Serial.print(remoteIP);
  Serial.print(':');
  Serial.println(remotePort);
}

// =====================================================
// APPEND CSV RECORD
// =====================================================
void logCSV(
  uint16_t raw1,
  uint16_t raw2,
  float frequency,
  const char* status
) {
  if (!sdReady) {
    Serial.println("[SD] Logging skipped: SD unavailable.");
    return;
  }

  // FILE_WRITE is append mode in the standard ESP32 SD
  // library. Do not use FILE_APPEND here.
  File file = SD.open(LOG_FILE, FILE_WRITE);

  if (!file) {
    Serial.println("[SD] ERROR: Cannot open CSV file.");
    Serial.print("[SD] File exists: ");
    Serial.println(SD.exists(LOG_FILE) ? "YES" : "NO");
    return;
  }

  file.print(getTimestamp());
  file.print(',');
  file.print(PLANT_ID);
  file.print(',');
  file.print(DEVICE_ID);
  file.print(',');
  file.print(SLAVE_ID);
  file.print(",Freq_Hz,");
  file.print(FREQUENCY_REGISTER);
  file.print(',');
  file.print(raw1);
  file.print(',');
  file.print(raw2);
  file.print(',');

  if (strcmp(status, "OK") == 0) {
    file.print(frequency, 3);
  }

  file.print(',');
  file.println(status);

  file.flush();

  bool writeOK = (file.getWriteError() == 0);
  file.close();

  if (writeOK) {
    Serial.println("[SD] CSV record saved.");
  } else {
    Serial.println("[SD] ERROR: CSV write failed.");
  }
}

// =====================================================
// UDP JSON TELEMETRY
// =====================================================
void sendUDP(
  uint16_t raw1,
  uint16_t raw2,
  float frequency,
  const char* status
) {
  if (!ethernetReady || !udpReady) {
    Serial.println("[UDP] Skipped: network unavailable.");
    return;
  }

  StaticJsonDocument<384> doc;

  doc["plant_id"] = PLANT_ID;
  doc["device"] = DEVICE_ID;
  doc["slave_id"] = SLAVE_ID;
  doc["timestamp"] = getTimestamp();
  doc["parameter"] = "Freq_Hz";
  doc["register"] = FREQUENCY_REGISTER;
  doc["raw_word_1"] = raw1;
  doc["raw_word_2"] = raw2;
  doc["status"] = status;

  if (strcmp(status, "OK") == 0) {
    doc["frequency_hz"] = frequency;
  } else {
    doc["frequency_hz"] = nullptr;
  }

  char payload[384];

  size_t length =
    serializeJson(doc, payload, sizeof(payload));

  if (length == 0 || length >= sizeof(payload)) {
    Serial.println("[UDP] ERROR: JSON serialization failed.");
    return;
  }

  if (Udp.beginPacket(remoteIP, remotePort) == 0) {
    Serial.println("[UDP] ERROR: beginPacket failed.");
    return;
  }

  Udp.write((const uint8_t*)payload, length);

  if (Udp.endPacket()) {
    Serial.println("[UDP] Telemetry sent:");
    Serial.println(payload);
  } else {
    Serial.println("[UDP] ERROR: UDP transmission failed.");
  }
}

// =====================================================
// MODBUS POLL
// =====================================================
void pollModbus() {
  Serial.println("\n========== MODBUS POLL ==========");

  Serial.print("Timestamp: ");
  Serial.println(getTimestamp());

  Serial.print("Slave ID: ");
  Serial.println(SLAVE_ID);

  Serial.print("Register: ");
  Serial.println(FREQUENCY_REGISTER);

  uint8_t result =
    node.readHoldingRegisters(FREQUENCY_REGISTER, 2);

  if (result != node.ku8MBSuccess) {
    Serial.print("[MODBUS] Read failed. Error: 0x");
    Serial.println(result, HEX);

    logCSV(0, 0, NAN, "MODBUS_ERROR");
    sendUDP(0, 0, NAN, "MODBUS_ERROR");
    return;
  }

  uint16_t raw1 = node.getResponseBuffer(0);
  uint16_t raw2 = node.getResponseBuffer(1);

  float frequency = registersToFloat(raw1, raw2);

  Serial.printf(
    "Raw registers: 0x%04X 0x%04X\n",
    raw1, raw2
  );

  if (isnan(frequency) || isinf(frequency)) {
    Serial.println("[MODBUS] Invalid FLOAT32.");

    logCSV(raw1, raw2, NAN, "INVALID_FLOAT");
    sendUDP(raw1, raw2, NAN, "INVALID_FLOAT");
    return;
  }

  Serial.print("[MODBUS] Frequency: ");
  Serial.print(frequency, 3);
  Serial.println(" Hz");

  logCSV(raw1, raw2, frequency, "OK");
  sendUDP(raw1, raw2, frequency, "OK");

  Serial.println("=================================");
}

// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n======================================");
  Serial.println(" ESP32 MODBUS + RTC + SD + W5500 UDP");
  Serial.println("======================================");

  // RS485
  pinMode(MAX485_RE_DE, OUTPUT);
  postTransmission();

  Serial2.begin(
    9600,
    SERIAL_8E1,
    RX2_PIN,
    TX2_PIN
  );

  node.begin(SLAVE_ID, Serial2);
  node.preTransmission(preTransmission);
  node.postTransmission(postTransmission);

  initializeRTC();
  initializeSD();
  initializeEthernet();

  Serial.println("\n========== DEVICE STATUS ==========");
  Serial.printf("RTC: %s\n", rtcReady ? "READY" : "FAILED");
  Serial.printf("SD: %s\n", sdReady ? "READY" : "FAILED");
  Serial.printf("Ethernet: %s\n",
                ethernetReady ? "READY" : "FAILED");
  Serial.printf("UDP: %s\n", udpReady ? "READY" : "FAILED");
  Serial.println("Polling interval: 5000 ms");
}

// =====================================================
// LOOP
// =====================================================
void loop() {
  if (millis() - lastPoll >= POLL_INTERVAL_MS) {
    lastPoll = millis();
    pollModbus();
  }
}
