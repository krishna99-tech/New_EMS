#include <SPI.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <PubSubClient.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <ModbusMaster.h>
#include <ArduinoJson.h>
#include <SD.h>
#include <Wire.h>
#include <RTClib.h>
#include <WiFiManager.h>

#include "ConfigManager.h"

// ================= GLOBAL CONFIGURATION OBJECT =================
EMSConfig emsConfig;

// ================= AP MODE TRIGGER BUTTON =================
// External Push Button (e.g. GPIO 34, 35, 27, 0).
// NOTE FOR GPIO 34/35/36/39: ESP32 has NO internal pullup on these input-only pins!
// An external 10k pullup resistor between the pin and 3.3V is required for GPIO 34/35.
// For pins like GPIO 27, 26, 0, 4, internal INPUT_PULLUP is active.
#define AP_TRIGGER_PIN      0
#define AP_HOLD_TIME_MS     3000 // Must be held for 3 seconds to enter AP mode

unsigned long buttonPressStartTime = 0;
bool buttonIsPressed = false;

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
#define SD_CS   27 // GPIO 5 as configured

// ================= RTC DS3231 (I2C) PINS =================
#define RTC_SDA 21
#define RTC_SCL 5

// ================= RS485 / MODBUS PINS =================
#define MAX485_RE_DE 4
#define RX2_PIN 32
#define TX2_PIN 33

// ================= NETWORK & TELEMETRY OBJECTS =================
byte mac[] = {0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED};

const unsigned int localPort = 8888;
const char* offlineFileName  = "/offline_data.jsonl";

// Network Clients
EthernetUDP    ethUdp;
WiFiUDP        wifiUdp;

EthernetClient ethClient;
WiFiClient     wifiClient;
PubSubClient   mqttClient;

// Hardware Objects
ModbusMaster   node;
RTC_DS3231     rtc;
SPIClass       spiSD(HSPI);

// Hardware status flags
bool rtcReady = false;
bool sdReady  = false;
bool wasNetworkConnected = false;

// ================= TIMING VARIABLES =================
unsigned long previousDataMillis = 0;

// ================= CONSECUTIVE FAIL TRACKING =================
#define MAX_SUPPORTED_SLAVES 248
#define OFFLINE_CONFIRM_COUNT 3
uint8_t failCount[MAX_SUPPORTED_SLAVES]      = {0};
bool    knownConnected[MAX_SUPPORTED_SLAVES] = {false};

// ================= RS485 DIRECTION CONTROL =================
void preTransmission() {
  digitalWrite(MAX485_RE_DE, HIGH);
}

void postTransmission() {
  digitalWrite(MAX485_RE_DE, LOW);
}

// Convert parity string to ESP32 Serial config
uint32_t getSerialParityConfig(const char* parityStr) {
  if (strcmp(parityStr, "8N1") == 0) return SERIAL_8N1;
  if (strcmp(parityStr, "8O1") == 0) return SERIAL_8O1;
  return SERIAL_8E1; // Default: 8E1 Even
}

// ================= FLOAT DECODING =================
float decodeNormal(uint16_t r1, uint16_t r2) {
  uint32_t val = ((uint32_t)r1 << 16) | r2;
  float f;
  memcpy(&f, &val, 4);
  return f;
}

// ================= READ KWH VIA MODBUS =================
uint8_t readKwh(uint8_t slave, uint16_t regAddress, float &value) {
  node.begin(slave, Serial2);

  while (Serial2.available()) {
    Serial2.read();
  }

  uint8_t res = node.readHoldingRegisters(regAddress, 2);

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
  if (strcmp(emsConfig.net_interface, "WIFI") == 0) {
    return (WiFi.status() == WL_CONNECTED);
  } else {
    // Ethernet
    if (Ethernet.hardwareStatus() == EthernetNoHardware) {
      return false;
    }
    return (Ethernet.linkStatus() == LinkON && Ethernet.localIP() != IPAddress(0, 0, 0, 0));
  }
}

// ================= MQTT CONNECTION HELPER =================
bool ensureMqttConnected() {
  if (mqttClient.connected()) {
    return true;
  }
  if (!isNetworkAvailable()) {
    return false;
  }

  Serial.printf("[MQTT] Attempting connection to %s:%d...\n", emsConfig.server_host, emsConfig.server_port);
  
  String clientId = "EMS-" + String(emsConfig.plant_id) + "-" + String(random(0xffff), HEX);
  bool connected = false;

  if (strlen(emsConfig.mqtt_user) > 0) {
    connected = mqttClient.connect(clientId.c_str(), emsConfig.mqtt_user, emsConfig.mqtt_pass);
  } else {
    connected = mqttClient.connect(clientId.c_str());
  }

  if (connected) {
    Serial.println("[MQTT] Connected successfully.");
    return true;
  } else {
    Serial.printf("[MQTT] Connection failed, state rc=%d\n", mqttClient.state());
    return false;
  }
}

// ================= SEND TELEMETRY PACKET =================
bool sendTelemetry(const char* jsonPayload, size_t len) {
  if (!isNetworkAvailable()) {
    return false;
  }

  // --- OPTION A: UDP PROTOCOL ---
  if (strcmp(emsConfig.comm_proto, "UDP") == 0) {
    IPAddress targetIP;
    if (!targetIP.fromString(emsConfig.server_host)) {
      Serial.printf("[UDP] Resolving host %s...\n", emsConfig.server_host);
    }

    if (strcmp(emsConfig.net_interface, "WIFI") == 0) {
      if (wifiUdp.beginPacket(emsConfig.server_host, emsConfig.server_port)) {
        wifiUdp.write((const uint8_t*)jsonPayload, len);
        return (wifiUdp.endPacket() == 1);
      }
    } else {
      if (ethUdp.beginPacket(emsConfig.server_host, emsConfig.server_port)) {
        ethUdp.write((const uint8_t*)jsonPayload, len);
        return (ethUdp.endPacket() == 1);
      }
    }
    return false;
  }

  // --- OPTION B: MQTT PROTOCOL ---
  else if (strcmp(emsConfig.comm_proto, "MQTT") == 0) {
    if (!ensureMqttConnected()) {
      return false;
    }
    bool published = mqttClient.publish(emsConfig.mqtt_topic, jsonPayload);
    mqttClient.loop();
    return published;
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

  Serial.println("[SD] Found offline backlog. Flushing to server...");

  bool allSent = true;

  while (dataFile.available()) {
    String line = dataFile.readStringUntil('\n');
    line.trim();

    if (line.length() > 0) {
      bool sent = sendTelemetry(line.c_str(), line.length());
      if (!sent) {
        Serial.println("[SD] Offline push interrupted (network drop). Retaining remaining data.");
        allSent = false;
        break;
      }
      delay(30); // Prevent socket congestion
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

// ================= INITIALIZE NETWORK =================
void initNetwork() {
  if (strcmp(emsConfig.net_interface, "WIFI") == 0) {
    Serial.println("[NET] Configuring WiFi mode...");
    WiFi.mode(WIFI_STA);
    WiFi.begin(); // Connects using credentials previously stored by WiFiManager

    Serial.print("[WiFi] Connecting to WiFi");
    unsigned long startAttempt = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) {
      delay(400);
      Serial.print(".");
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
      if (strcmp(emsConfig.comm_proto, "UDP") == 0) {
        wifiUdp.begin(localPort);
      } else {
        mqttClient.setClient(wifiClient);
        mqttClient.setServer(emsConfig.server_host, emsConfig.server_port);
      }
    } else {
      Serial.println("[WiFi] Warning: Could not connect to saved WiFi. Hold button 3s to reconfigure.");
    }

  } else {
    // Ethernet Mode
    Serial.println("[NET] Configuring W5500 Ethernet mode...");

    pinMode(W5500_CS, OUTPUT);
    digitalWrite(W5500_CS, HIGH);

    pinMode(W5500_RST, OUTPUT);
    digitalWrite(W5500_RST, LOW);
    delay(150);
    digitalWrite(W5500_RST, HIGH);
    delay(200);

    SPI.begin(W5500_SCK, W5500_MISO, W5500_MOSI, W5500_CS);
    Ethernet.init(W5500_CS);

    if (emsConfig.eth_dhcp) {
      Serial.println("[ETH] Requesting DHCP IP...");
      if (Ethernet.begin(mac) == 0) {
        Serial.println("[ETH] DHCP failed! Falling back to static IP.");
        IPAddress ip, gw, sn, dns;
        ip.fromString(emsConfig.eth_ip);
        gw.fromString(emsConfig.eth_gateway);
        sn.fromString(emsConfig.eth_subnet);
        dns.fromString(emsConfig.eth_dns);
        Ethernet.begin(mac, ip, dns, gw, sn);
      }
    } else {
      IPAddress ip, gw, sn, dns;
      ip.fromString(emsConfig.eth_ip);
      gw.fromString(emsConfig.eth_gateway);
      sn.fromString(emsConfig.eth_subnet);
      dns.fromString(emsConfig.eth_dns);
      Ethernet.begin(mac, ip, dns, gw, sn);
    }

    delay(500);

    Serial.print("[ETH] IP Address: ");
    Serial.println(Ethernet.localIP());

    if (strcmp(emsConfig.comm_proto, "UDP") == 0) {
      if (ethUdp.begin(localPort)) {
        Serial.printf("[UDP] Listening on port %d, sending to %s:%d\n", 
                      localPort, emsConfig.server_host, emsConfig.server_port);
      } else {
        Serial.println("[UDP] ERROR: Failed to bind Ethernet UDP port.");
      }
    } else {
      mqttClient.setClient(ethClient);
      mqttClient.setServer(emsConfig.server_host, emsConfig.server_port);
      Serial.printf("[MQTT] Configured with broker %s:%d\n", emsConfig.server_host, emsConfig.server_port);
    }
  }

  wasNetworkConnected = isNetworkAvailable();
}

// ================= AP MODE TRIGGER =================
void enterAPConfigMode() {
  Serial.println("\n**************************************************");
  Serial.println("[BUTTON] 3-SECOND BUTTON HOLD DETECTED!");
  Serial.println("[SYSTEM] Suspending polling & entering AP Config Portal...");
  Serial.println("**************************************************\n");

  char apSSID[40];
  snprintf(apSSID, sizeof(apSSID), "EMS_CONFIG_%s", emsConfig.plant_id);

  bool saved = startEMSConfigPortal(emsConfig, apSSID, nullptr);

  if (saved) {
    Serial.println("\n[SYSTEM] Settings saved! Restarting ESP32 to apply all changes...");
    delay(1500);
    ESP.restart();
  } else {
    Serial.println("\n[SYSTEM] AP Portal closed without saving. Resuming normal operations.");
  }
}

// Check button with 3-second hold detection
void checkAPButton() {
  // Active LOW reading
  bool pressed = (digitalRead(AP_TRIGGER_PIN) == LOW);

  if (pressed) {
    if (!buttonIsPressed) {
      buttonIsPressed = true;
      buttonPressStartTime = millis();
      Serial.println("[BUTTON] Button pressed. Keep holding for 3 seconds to enter AP Mode...");
    } else {
      unsigned long heldDuration = millis() - buttonPressStartTime;
      if (heldDuration >= AP_HOLD_TIME_MS) {
        enterAPConfigMode();
        buttonIsPressed = false;
      }
    }
  } else {
    if (buttonIsPressed) {
      buttonIsPressed = false;
    }
  }
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=============================================");
  Serial.println("--- Starting EMS Multi-Meter Logger v2.0 ---");
  Serial.println("=============================================");

  // 1. Initialize AP Trigger Button Pin
  // GPIO 34, 35, 36, 39 are input only and lack internal pullups on ESP32
  #if (AP_TRIGGER_PIN == 34 || AP_TRIGGER_PIN == 35 || AP_TRIGGER_PIN == 36 || AP_TRIGGER_PIN == 39)
    pinMode(AP_TRIGGER_PIN, INPUT); // Requires external 10k pull-up resistor to 3.3V
  #else
    pinMode(AP_TRIGGER_PIN, INPUT_PULLUP);
  #endif

  // Check if button is held during boot
  if (digitalRead(AP_TRIGGER_PIN) == LOW) {
    Serial.println("[BUTTON] Button held at boot. Checking 3-second threshold...");
    unsigned long bootStart = millis();
    while (digitalRead(AP_TRIGGER_PIN) == LOW) {
      if (millis() - bootStart >= AP_HOLD_TIME_MS) {
        Serial.println("[BUTTON] 3-second hold reached at boot! Launching AP Portal.");
        loadConfig(emsConfig);
        enterAPConfigMode();
        break;
      }
      delay(50);
    }
  }

  // 2. Load Configuration from NVS flash
  bool hasSavedConfig = loadConfig(emsConfig);
  printConfig(emsConfig);

  // If device is not configured yet, keep AP Portal running until configured!
  while (!hasSavedConfig) {
    Serial.println("\n[SYSTEM] First boot / unconfigured device detected!");
    Serial.println("[SYSTEM] Launching AP Configuration Portal...");
    enterAPConfigMode();
    hasSavedConfig = loadConfig(emsConfig);
    if (!hasSavedConfig) {
      Serial.println("[SYSTEM] Portal exited without saving. Reopening AP Portal in 2s...");
      delay(2000);
    }
  }

  // 3. Initialize RS485 Serial with configured Baud Rate & Parity
  pinMode(MAX485_RE_DE, OUTPUT);
  digitalWrite(MAX485_RE_DE, LOW);
  
  uint32_t serialConfig = getSerialParityConfig(emsConfig.parity);
  Serial2.begin(emsConfig.baud_rate, serialConfig, RX2_PIN, TX2_PIN);
  Serial2.setTimeout(250); // Fast 250ms timeout so offline meters do not block button detection
  node.preTransmission(preTransmission);
  node.postTransmission(postTransmission);
  Serial.printf("[RS485] Initialized at %lu baud, %s parity.\n", emsConfig.baud_rate, emsConfig.parity);

  // 4. Initialize RTC DS3231
  Wire.begin(RTC_SDA, RTC_SCL);
  if (rtc.begin()) {
    rtcReady = true;
    Serial.printf("[RTC] DS3231 detected. Current time: %s\n", getTimestamp().c_str());
  } else {
    Serial.println("[RTC] WARNING: RTC DS3231 not detected!");
  }

  // 5. Initialize SD Card (HSPI)
  pinMode(SD_CS, OUTPUT);
  digitalWrite(SD_CS, HIGH);

  spiSD.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (SD.begin(SD_CS, spiSD, 4000000)) {
    sdReady = true;
    Serial.println("[SD] MicroSD card initialized successfully.");
  } else {
    Serial.println("[SD] WARNING: SD card initialization failed! Check wiring & CS pin.");
  }

  // 6. Initialize Network (Ethernet or WiFi) & Telemetry
  initNetwork();

  uint8_t startId = emsConfig.slave_start;
  uint8_t endId   = emsConfig.slave_start + emsConfig.slave_count - 1;
  Serial.printf("[SYSTEM] Setup complete. Scanning %d Modbus meters: IDs %d to %d\n", 
                emsConfig.slave_count, startId, endId);
  Serial.println("[SYSTEM] Hold button for 3 seconds at any time to reconfigure in AP Mode.\n");
}

// ================= MAIN LOOP =================
void loop() {
  unsigned long currentMillis = millis();

  // ---------------------------------------------------------
  // TASK 0: Monitor 3-Second Hold Button for AP Mode
  // ---------------------------------------------------------
  checkAPButton();

  // ---------------------------------------------------------
  // TASK 1: Immediate Backlog Flush on Network Restoration
  // ---------------------------------------------------------
  bool currentNetworkConnected = isNetworkAvailable();

  if (currentNetworkConnected && !wasNetworkConnected) {
    Serial.println("[NET] Network connection restored!");
    if (sdReady && SD.exists(offlineFileName)) {
      pushOfflineData();
    }
  }
  wasNetworkConnected = currentNetworkConnected;

  // Maintain MQTT loop if using MQTT
  if (strcmp(emsConfig.comm_proto, "MQTT") == 0 && currentNetworkConnected) {
    if (!mqttClient.connected()) {
      ensureMqttConnected();
    }
    mqttClient.loop();
  }

  // ---------------------------------------------------------
  // TASK 2: Scan Modbus Meters at Configured Interval
  // ---------------------------------------------------------
  unsigned long pollIntervalMs = (unsigned long)emsConfig.poll_interval_sec * 1000UL;
  if (pollIntervalMs == 0) pollIntervalMs = 60000;

  if (currentMillis - previousDataMillis >= pollIntervalMs || previousDataMillis == 0) {
    previousDataMillis = currentMillis;

    Serial.println("\n--- Starting Meter Scan Cycle ---");
    String timeStamp = getTimestamp();

    // Prepare JSON Document
    StaticJsonDocument<4096> doc;
    doc["device"]    = emsConfig.plant_id;
    doc["timestamp"] = timeStamp;

    JsonArray meterArray = doc.createNestedArray("meters");
    uint8_t respondingCount = 0;
    uint8_t offlineCount    = 0;

    uint8_t startId = emsConfig.slave_start;
    uint8_t endId   = emsConfig.slave_start + emsConfig.slave_count - 1;

    // Scan sequential Modbus meters (n+1 increment)
    for (uint8_t slave = startId; slave <= endId; slave++) {
      // Check button frequently even during scan
      checkAPButton();

      float kwh = 0;
      uint8_t result = readKwh(slave, emsConfig.reg_address, kwh);

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
        Serial.printf("CRC_ERR| Wiring noise on address %d\n", slave);
        if (knownConnected[slave]) {
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
      Serial.println("[NET] Network offline. Buffering readings to SD card.");
      logToSD(buffer);
    } else {
      // First flush backlog if any
      if (sdReady && SD.exists(offlineFileName)) {
        pushOfflineData();
      }

      Serial.printf("[%s] Transmitting live telemetry...\n", emsConfig.comm_proto);
      bool success = sendTelemetry(buffer, len);

      if (!success) {
        Serial.printf("[%s] Transmission failed! Buffering to SD card instead.\n", emsConfig.comm_proto);
        logToSD(buffer);
      } else {
        Serial.printf("[%s] Live telemetry successfully delivered.\n", emsConfig.comm_proto);
      }
    }
  }

  yield();
}