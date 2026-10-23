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
#include "WiFiManager.h"

#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>

#include "ConfigManager.h"

// ================= GLOBAL CONFIGURATION OBJECT =================
EMSConfig emsConfig;

// ================= AP MODE TRIGGER BUTTON =================
// External Push Button / ESP32 BOOT button (GPIO 0).
#define AP_TRIGGER_PIN      0
#define AP_HOLD_TIME_MS     3000 // Must be held for 3 seconds to enter AP mode

// ================= W5500 ETHERNET PINS (VSPI) =================
#define W5500_MISO 12
#define W5500_MOSI 13
#define W5500_SCK  14
#define W5500_CS   15
#define W5500_RST  25

// ================= SD CARD (HSPI) PINS =================
#define SD_MISO 19 
#define SD_MOSI 23 
#define SD_SCK  18 
#define SD_CS   27

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
const char* offlineFileName  = "/offline_data.json";

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

// ================= CONSECUTIVE FAIL TRACKING =================
#define MAX_SUPPORTED_SLAVES 248
#define OFFLINE_CONFIRM_COUNT 3
uint8_t failCount[MAX_SUPPORTED_SLAVES]      = {0};
bool    knownConnected[MAX_SUPPORTED_SLAVES] = {false};

// ================= FREERTOS HANDLES & QUEUES =================
struct TelemetryMessage {
  char payload[3500];
};

QueueHandle_t     telemetryQueue = NULL;
SemaphoreHandle_t sdMutex        = NULL;
SemaphoreHandle_t modbusMutex    = NULL;

TaskHandle_t hTaskButton    = NULL;
TaskHandle_t hTaskModbus    = NULL;
TaskHandle_t hTaskTelemetry = NULL;

volatile bool isAPPortalActive = false;
volatile bool requestAPMode      = false;

// ================= RS485 DIRECTION CONTROL =================
void preTransmission() {
  digitalWrite(MAX485_RE_DE, HIGH);
}

void postTransmission() {
  digitalWrite(MAX485_RE_DE, LOW);
}

uint32_t getSerialParityConfig(const char* parityStr) {
  if (strcmp(parityStr, "8N1") == 0) return SERIAL_8N1;
  if (strcmp(parityStr, "8O1") == 0) return SERIAL_8O1;
  return SERIAL_8E1; // Default: 8E1 Even
}

// ================= 32-BIT MODBUS FLOAT DECODING (4 ENDIAN FORMATS) =================
float decodeFloat(uint16_t r1, uint16_t r2, const char* endian) {
  uint32_t val = 0;
  if (strcmp(endian, "CDAB") == 0) {
    // Word Swapped (Little-Endian Word)
    val = ((uint32_t)r2 << 16) | r1;
  } else if (strcmp(endian, "BADC") == 0) {
    // Byte Swapped (Mid-Endian)
    uint16_t s1 = ((r1 & 0xFF) << 8) | ((r1 >> 8) & 0xFF);
    uint16_t s2 = ((r2 & 0xFF) << 8) | ((r2 >> 8) & 0xFF);
    val = ((uint32_t)s1 << 16) | s2;
  } else if (strcmp(endian, "DCBA") == 0) {
    // True Little-Endian (Intel: Byte & Word Swapped)
    uint16_t s1 = ((r1 & 0xFF) << 8) | ((r1 >> 8) & 0xFF);
    uint16_t s2 = ((r2 & 0xFF) << 8) | ((r2 >> 8) & 0xFF);
    val = ((uint32_t)s2 << 16) | s1;
  } else {
    // Default ABCD: Big-Endian (Normal / Motorola)
    val = ((uint32_t)r1 << 16) | r2;
  }
  float f;
  memcpy(&f, &val, 4);
  return f;
}

// Backward compatibility helper
inline float decodeNormal(uint16_t r1, uint16_t r2) {
  return decodeFloat(r1, r2, "ABCD");
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
    value = round(decodeFloat(r1, r2, emsConfig.float_endian) * 100) / 100.0;
    return 0; // SUCCESS
  }

  value = -1;
  if (res == node.ku8MBResponseTimedOut) return 1; // TIMEOUT
  if (res == node.ku8MBInvalidCRC)       return 2; // CRC ERROR
  return 3;                                       // OTHER ERROR
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
    // Ethernet Mode
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

  // --- UDP PROTOCOL ---
  if (strcmp(emsConfig.comm_proto, "UDP") == 0) {
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

  // --- MQTT PROTOCOL ---
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

// ================= SD CARD STORE AND FORWARD (MUTEX PROTECTED) =================
void logToSD(const char* jsonPayload) {
  if (!sdReady) {
    Serial.println("[SD] Cannot log: SD card unavailable.");
    return;
  }

  if (xSemaphoreTake(sdMutex, pdMS_TO_TICKS(3000)) == pdTRUE) {
    digitalWrite(W5500_CS, HIGH); // Deselect Ethernet during SD transaction

    File dataFile = SD.open(offlineFileName, FILE_APPEND);
    if (dataFile) {
      dataFile.println(jsonPayload);
      dataFile.flush();
      dataFile.close();
      Serial.println("[SD] Offline record appended successfully.");
    } else {
      Serial.println("[SD] Error opening file for writing!");
    }
    xSemaphoreGive(sdMutex);
  } else {
    Serial.println("[SD] Warning: SD mutex busy, dropped log.");
  }
}

bool pushOfflineData() {
  if (!sdReady || !isNetworkAvailable()) {
    return false;
  }

  if (xSemaphoreTake(sdMutex, pdMS_TO_TICKS(2000)) != pdTRUE) {
    return false;
  }

  digitalWrite(W5500_CS, HIGH);

  if (!SD.exists(offlineFileName)) {
    xSemaphoreGive(sdMutex);
    return true; // Nothing to push
  }

  File dataFile = SD.open(offlineFileName, FILE_READ);
  if (!dataFile) {
    Serial.println("[SD] Failed to open offline data for reading.");
    xSemaphoreGive(sdMutex);
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
      vTaskDelay(pdMS_TO_TICKS(25)); // Prevent socket congestion
    }
  }

  dataFile.close();

  if (allSent) {
    SD.remove(offlineFileName);
    Serial.println("[SD] All offline data sent. SD buffer cleared.");
  }

  xSemaphoreGive(sdMutex);
  return allSent;
}

// ================= INITIALIZE NETWORK =================
void initNetwork() {
  if (strcmp(emsConfig.net_interface, "WIFI") == 0) {
    Serial.println("[NET] Configuring WiFi mode...");
    WiFi.mode(WIFI_STA);
    WiFi.begin();

    Serial.print("[WiFi] Connecting to WiFi");
    unsigned long startAttempt = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) {
      vTaskDelay(pdMS_TO_TICKS(400));
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
    vTaskDelay(pdMS_TO_TICKS(150));
    digitalWrite(W5500_RST, HIGH);
    vTaskDelay(pdMS_TO_TICKS(200));

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

    vTaskDelay(pdMS_TO_TICKS(500));
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
  isAPPortalActive = true;
  Serial.println("\n**************************************************");
  Serial.println("[SYSTEM] Launching AP Configuration Portal...");
  Serial.println("**************************************************\n");

  // Suspend polling and network tasks while running captive portal
  if (hTaskModbus != NULL)    vTaskSuspend(hTaskModbus);
  if (hTaskTelemetry != NULL) vTaskSuspend(hTaskTelemetry);

  char apSSID[40];
  snprintf(apSSID, sizeof(apSSID), "EMS_CONFIG_%s", emsConfig.plant_id);

  bool saved = startEMSConfigPortal(emsConfig, apSSID, nullptr);

  if (saved) {
    Serial.println("\n[SYSTEM] Settings saved! Restarting ESP32 to apply all changes...");
    vTaskDelay(pdMS_TO_TICKS(1500));
    ESP.restart();
  } else {
    Serial.println("\n[SYSTEM] AP Portal closed without saving. Resuming RTOS tasks...");
    isAPPortalActive = false;
    if (hTaskModbus != NULL)    vTaskResume(hTaskModbus);
    if (hTaskTelemetry != NULL) vTaskResume(hTaskTelemetry);
  }
}

// ===================================================================
// FREERTOS TASK 1: BUTTON & AP TRIGGER MONITOR (CORE 1)
// ===================================================================
void TaskButton(void *pvParameters) {
  unsigned long pressStart = 0;
  bool isPressed = false;

  while (1) {
    if (!isAPPortalActive) {
      bool currentPressed = (digitalRead(AP_TRIGGER_PIN) == LOW);

      if (currentPressed) {
        if (!isPressed) {
          isPressed = true;
          pressStart = millis();
          Serial.println("[BUTTON] Button pressed. Hold 3s to enter AP Mode...");
        } else {
          if (millis() - pressStart >= AP_HOLD_TIME_MS) {
            Serial.println("[BUTTON] 3-second hold detected! Requesting AP Configuration Mode...");
            requestAPMode = true;
            isPressed = false;
            // Wait for user to release button so it does not immediately trigger again
            while (digitalRead(AP_TRIGGER_PIN) == LOW) {
              vTaskDelay(pdMS_TO_TICKS(50));
            }
          }
        }
      } else {
        if (isPressed) {
          isPressed = false;
        }
      }
    }

    // Check button every 50ms without blocking any other operations
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

// ===================================================================
// FREERTOS TASK 2: MODBUS RS485 POLLING (CORE 1)
// ===================================================================
void TaskModbus(void *pvParameters) {
  while (1) {
    Serial.println("\n--- [RTOS TaskModbus] Starting Meter Scan Cycle ---");
    String timeStamp = getTimestamp();

    StaticJsonDocument<4096> doc;
    doc["device"]    = emsConfig.plant_id;
    doc["timestamp"] = timeStamp;

    JsonArray meterArray = doc.createNestedArray("meters");
    uint8_t respondingCount = 0;
    uint8_t offlineCount    = 0;

    for (uint8_t i = 0; i < emsConfig.slave_count; i++) {
      // If portal was activated, abort scan immediately
      if (isAPPortalActive) break;
      

      SlaveDevice &dev = emsConfig.slaves[i];

      // Dynamically adapt Serial2 if this slave has a different baud or parity
      static uint32_t currentBaud = 0;
      static uint32_t currentParity = 0;
      uint32_t neededParity = getSerialParityConfig(dev.parity);

      if (currentBaud != dev.baud_rate || currentParity != neededParity) {
        Serial2.begin(dev.baud_rate, neededParity, RX2_PIN, TX2_PIN);
        Serial2.setTimeout(250);
        currentBaud = dev.baud_rate;
        currentParity = neededParity;
      }

      float val = 0;
      uint8_t result = readKwh(dev.id, dev.reg_address, val);
      const char* keyName = (strlen(dev.reg_name) > 0) ? dev.reg_name : "kwh";

      Serial.printf("Meter #%02d [ID: %3d, %s: %5d, %6lu %s, %s] | ", 
                    i + 1, dev.id, keyName, dev.reg_address, dev.baud_rate, dev.parity, emsConfig.float_endian);

      if (result == 0) {
        Serial.printf("OK     | %s: %.2f\n", keyName, val);
        knownConnected[dev.id] = true;
        failCount[dev.id]      = 0;

        JsonObject meter = meterArray.createNestedObject();
        meter["id"]     = dev.id;
        meter["status"] = "OK";
        meter[keyName]  = val;
        respondingCount++;

      } else if (result == 1) {
        failCount[dev.id]++;
        if (!knownConnected[dev.id]) {
          Serial.println("EMPTY  | (never connected, skip)");
        } else {
          Serial.printf("FAIL %d/%d | Was connected, now no response\n",
                        failCount[dev.id], OFFLINE_CONFIRM_COUNT);

          if (failCount[dev.id] >= OFFLINE_CONFIRM_COUNT) {
            Serial.println("         -> CONFIRMED OFFLINE");
            JsonObject meter = meterArray.createNestedObject();
            meter["id"]     = dev.id;
            meter["status"] = "OFFLINE";
            offlineCount++;
          }
        }

      } else if (result == 2) {
        failCount[dev.id]++;
        Serial.printf("CRC_ERR| Wiring noise on address %d\n", dev.id);
        if (knownConnected[dev.id]) {
          JsonObject meter = meterArray.createNestedObject();
          meter["id"]     = dev.id;
          meter["status"] = "CRC_ERROR";
          offlineCount++;
        }

      } else {
        Serial.printf("ERR 0x%02X| Modbus error on address %d\n", result, dev.id);
      }

      vTaskDelay(pdMS_TO_TICKS(50)); // Yield 50ms between meter reads
    }

    if (!isAPPortalActive) {
      TelemetryMessage msg;
      size_t len = serializeJson(doc, msg.payload, sizeof(msg.payload));

      Serial.println("\n========== JSON PAYLOAD (Modbus Task) ==========");
      Serial.println(msg.payload);
      Serial.printf("Responding: %d | Offline: %d\n", respondingCount, offlineCount);

      // Send payload to Telemetry Task Queue
      if (xQueueSend(telemetryQueue, &msg, pdMS_TO_TICKS(500)) != pdTRUE) {
        Serial.println("[MODBUS] Warning: Telemetry queue full, dropping frame.");
      }
    }

    // Delay until next configured scan cycle
    unsigned long pollIntervalMs = (unsigned long)emsConfig.poll_interval_sec * 1000UL;
    if (pollIntervalMs < 5000) pollIntervalMs = 5000;
    vTaskDelay(pdMS_TO_TICKS(pollIntervalMs));
  }
}

// ===================================================================
// FREERTOS TASK 3: NETWORK & TELEMETRY DISPATCH (CORE 0)
// ===================================================================
void TaskTelemetry(void *pvParameters) {
  while (1) {
    // 1. Maintain MQTT loop on network core
    if (strcmp(emsConfig.comm_proto, "MQTT") == 0 && isNetworkAvailable()) {
      if (!mqttClient.connected()) {
        ensureMqttConnected();
      }
      mqttClient.loop();
    }

    // 2. Receive and process telemetry messages from queue
    TelemetryMessage msg;
    if (xQueueReceive(telemetryQueue, &msg, pdMS_TO_TICKS(200)) == pdTRUE) {
      bool currentNetConnected = isNetworkAvailable();

      if (!currentNetConnected) {
        Serial.println("[NET] Network offline. Buffering to SD card...");
        logToSD(msg.payload);
      } else {
        // Flush SD backlog on link availability
        if (sdReady && SD.exists(offlineFileName)) {
          pushOfflineData();
        }

        Serial.printf("[%s] Transmitting live telemetry on Core %d...\n", 
                      emsConfig.comm_proto, xPortGetCoreID());
        bool success = sendTelemetry(msg.payload, strlen(msg.payload));

        if (!success) {
          Serial.printf("[%s] Transmission failed! Buffering to SD card.\n", emsConfig.comm_proto);
          logToSD(msg.payload);
        } else {
          Serial.printf("[%s] Live telemetry delivered successfully.\n", emsConfig.comm_proto);
        }
      }
    } else {
      // Idle timeout: Check if network just reconnected to flush backlog
      bool currentNetConnected = isNetworkAvailable();
      if (currentNetConnected && !wasNetworkConnected) {
        Serial.println("[NET] Connection restored! Flushing offline SD backlog...");
        if (sdReady && SD.exists(offlineFileName)) {
          pushOfflineData();
        }
      }
      wasNetworkConnected = currentNetConnected;
    }
  }
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  vTaskDelay(pdMS_TO_TICKS(500));
  Serial.println("\n=============================================");
  Serial.println("--- Starting EMS Multi-Meter Logger (FreeRTOS) ---");
  Serial.println("=============================================");

  // 1. Initialize AP Trigger Button Pin
  #if (AP_TRIGGER_PIN == 34 || AP_TRIGGER_PIN == 35 || AP_TRIGGER_PIN == 36 || AP_TRIGGER_PIN == 39)
    pinMode(AP_TRIGGER_PIN, INPUT);
  #else
    pinMode(AP_TRIGGER_PIN, INPUT_PULLUP);
  #endif

  // 2. Create FreeRTOS Synchronization Primitives
  telemetryQueue = xQueueCreate(4, sizeof(TelemetryMessage));
  sdMutex        = xSemaphoreCreateMutex();
  modbusMutex    = xSemaphoreCreateMutex();

  // 3. Load Configuration from NVS flash
  bool hasSavedConfig = loadConfig(emsConfig);
  printConfig(emsConfig);

  // If device is not configured yet, loop in AP Portal until saved!
  while (!hasSavedConfig) {
    Serial.println("\n[SYSTEM] First boot / unconfigured device detected!");
    Serial.println("[SYSTEM] Launching AP Configuration Portal...");
    enterAPConfigMode();
    hasSavedConfig = loadConfig(emsConfig);
    if (!hasSavedConfig) {
      Serial.println("[SYSTEM] Portal exited without saving. Reopening in 2s...");
      vTaskDelay(pdMS_TO_TICKS(2000));
    }
  }

  // 4. Initialize RS485 Serial with initial slave Baud Rate & Parity
  pinMode(MAX485_RE_DE, OUTPUT);
  digitalWrite(MAX485_RE_DE, LOW);
  
  uint32_t initBaud = (emsConfig.slave_count > 0) ? emsConfig.slaves[0].baud_rate : 9600;
  const char* initParity = (emsConfig.slave_count > 0) ? emsConfig.slaves[0].parity : "8E1";
  uint32_t serialConfig = getSerialParityConfig(initParity);
  Serial2.begin(initBaud, serialConfig, RX2_PIN, TX2_PIN);
  Serial2.setTimeout(250); // Fast timeout so offline meters do not hang the bus
  node.preTransmission(preTransmission);
  node.postTransmission(postTransmission);
  Serial.printf("[RS485] Initialized at %lu baud, %s parity.\n", initBaud, initParity);

  // 5. Initialize RTC DS3231
  Wire.begin(RTC_SDA, RTC_SCL);
  if (rtc.begin()) {
    rtcReady = true;
    Serial.printf("[RTC] DS3231 detected. Current time: %s\n", getTimestamp().c_str());
  } else {
    Serial.println("[RTC] WARNING: RTC DS3231 not detected!");
  }

  // 6. Initialize SD Card (HSPI)
  pinMode(SD_CS, OUTPUT);
  digitalWrite(SD_CS, HIGH);
  spiSD.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);

  if (SD.begin(SD_CS, spiSD)) {
    sdReady = true;
    Serial.println("[SD] SD card initialized successfully on HSPI.");
  } else {
    Serial.println("[SD] WARNING: SD card initialization failed! Check wiring & CS pin.");
  }

  // 7. Initialize Network (W5500 / WiFi)
  initNetwork();

  // 8. Launch Dedicated FreeRTOS Tasks
  Serial.println("\n[RTOS] Creating FreeRTOS Tasks...");

  // Task 1: Button Monitor (Core 1, Priority 3 - High responsiveness)
  xTaskCreatePinnedToCore(
    TaskButton, "TaskButton", 4096, NULL, 3, &hTaskButton, 1
  );

  // Task 2: Modbus Meter Poller (Core 1, Priority 2)
  xTaskCreatePinnedToCore(
    TaskModbus, "TaskModbus", 6144, NULL, 2, &hTaskModbus, 1
  );

  // Task 3: Network & Telemetry Manager (Core 0 - Dedicated Network Core, Priority 2)
  xTaskCreatePinnedToCore(
    TaskTelemetry, "TaskTelemetry", 8192, NULL, 2, &hTaskTelemetry, 0
  );

  Serial.printf("[SYSTEM] FreeRTOS initialized. Polling %d configured Modbus meter(s).\n", 
                emsConfig.slave_count);
  Serial.println("[SYSTEM] Hold BOOT button for 3 seconds at any time to reconfigure in AP Mode.\n");
}

// ================= MAIN LOOP =================
void loop() {
  // If AP Mode was requested via button hold, launch portal safely from main Arduino task
  if (requestAPMode && !isAPPortalActive) {
    requestAPMode = false;
    enterAPConfigMode();
  }

  vTaskDelay(pdMS_TO_TICKS(100));
}