#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <ModbusMaster.h>
#include <ArduinoJson.h>

// ================= PLANT ID =================
// Set this once when flashing. Each device gets a unique number or string.
// Register this ID in the Admin Dashboard → assign it to a plant name.
#define PLANT_ID "20246"

// ================= W5500 =================
#define W5500_MISO 12
#define W5500_MOSI 13
#define W5500_SCK  14
#define W5500_CS   15
#define W5500_RST  25

// ================= RS485 =================
#define MAX485_RE_DE 4
#define RX2_PIN 32
#define TX2_PIN 33

// ================= NETWORK =================
byte mac[] = {0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED};

IPAddress ip(192, 168, 0, 228);
IPAddress gateway(192, 168, 0, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress dns(8, 8, 8, 8);

IPAddress remoteIP(192, 168, 0, 159);
unsigned int remotePort = 10011;

EthernetUDP Udp;
ModbusMaster node;

// ================= METERS =================
// Scan ALL Modbus addresses from MIN to MAX.
// No need to change firmware when adding new meters —
// just plug in the meter and add its name in the Admin Dashboard.
#define MIN_SLAVE_ID  1
#define MAX_SLAVE_ID  32

// Elmeasure kWh Register
// Datasheet: 40167
// Zero-based offset for ModbusMaster: 166
// Adjusted to 158 per your config
uint16_t ELM_KWH_REG = 158;

// ================= CONSECUTIVE FAIL TRACKING =================
// Track how many consecutive failures each address has had.
// After OFFLINE_CONFIRM_COUNT failures in a row, mark as confirmed offline.
// This prevents false "offline" from a single missed poll (noise/glitch).
#define OFFLINE_CONFIRM_COUNT 3
uint8_t failCount[MAX_SLAVE_ID + 1] = {0};   // index = slave ID
bool    knownConnected[MAX_SLAVE_ID + 1] = {false}; // true once a meter responds at least once

// ================= RS485 CONTROL =================
void preTransmission() {
  digitalWrite(MAX485_RE_DE, HIGH);
}

void postTransmission() {
  digitalWrite(MAX485_RE_DE, LOW);
}

// ================= FLOAT DECODING =================
// Elmeasure uses swapped word order
float decodeSwapped(uint16_t r1, uint16_t r2) {
  uint32_t val = ((uint32_t)r2 << 16) | r1;
  float f;
  memcpy(&f, &val, 4);
  return f;
}

// ================= READ KWH =================
// Returns:
//   0  → Success
//   1  → Timeout (no response)
//   2  → CRC/noise error
//   3  → Other Modbus error
uint8_t readKwh(uint8_t slave, float &value) {

  node.begin(slave, Serial2);

  // Flush any stale bytes before transmitting
  while (Serial2.available()) {
    Serial2.read();
  }

  uint8_t res = node.readHoldingRegisters(ELM_KWH_REG, 2);

  if (res == node.ku8MBSuccess) {
    uint16_t r1 = node.getResponseBuffer(0);
    uint16_t r2 = node.getResponseBuffer(1);
    value = round(decodeSwapped(r1, r2) * 100) / 100.0;
    return 0; // SUCCESS
  }

  value = -1;

  if (res == node.ku8MBResponseTimedOut) {
    return 1; // TIMEOUT — not connected or powered off
  }
  if (res == node.ku8MBInvalidCRC) {
    return 2; // CRC ERROR — wiring noise
  }
  return 3;   // OTHER ERROR
}

// ================= SETUP =================
void setup() {

  Serial.begin(115200);

  // RS485
  pinMode(MAX485_RE_DE, OUTPUT);
  digitalWrite(MAX485_RE_DE, LOW);

  // Elmeasure default baud: 9600, 8E1
  Serial2.begin(9600, SERIAL_8E1, RX2_PIN, TX2_PIN);

  node.preTransmission(preTransmission);
  node.postTransmission(postTransmission);

  // W5500 hardware reset
  pinMode(W5500_RST, OUTPUT);
  digitalWrite(W5500_RST, LOW);
  delay(200);
  digitalWrite(W5500_RST, HIGH);
  delay(200);

  // SPI + Ethernet
  SPI.begin(W5500_SCK, W5500_MISO, W5500_MOSI, W5500_CS);
  Ethernet.init(W5500_CS);
  Ethernet.begin(mac, ip, dns, gateway, subnet);

  Serial.println();
  Serial.print("ESP32 IP: ");
  Serial.println(Ethernet.localIP());
  Serial.print("Plant ID: ");
  Serial.println(PLANT_ID);

  Udp.begin(8888);
  Serial.println("UDP Started");
  Serial.printf("Scanning Modbus addresses %d to %d\n", MIN_SLAVE_ID, MAX_SLAVE_ID);
}

// ================= LOOP =================
void loop() {

  unsigned long startTime = millis();

  // Increased buffer: 32 meters × ~60 bytes each = ~1920 + overhead
  StaticJsonDocument<4096> doc;
  doc["device"] = PLANT_ID;
  JsonArray meterArray = doc.createNestedArray("meters");

  uint8_t respondingCount = 0;
  uint8_t offlineCount    = 0;

  // ======================================================
  // SCAN ALL MODBUS ADDRESSES 1 → 32
  // ======================================================
  for (uint8_t slave = MIN_SLAVE_ID; slave <= MAX_SLAVE_ID; slave++) {

    float kwh = 0;
    uint8_t result = readKwh(slave, kwh);

    Serial.printf("Meter ID: %2d | ", slave);

    if (result == 0) {
      // ── SUCCESS ──────────────────────────────────────────
      Serial.printf("OK     | KWH: %.2f\n", kwh);

      knownConnected[slave] = true;   // Mark as ever-seen
      failCount[slave]      = 0;      // Reset consecutive fails

      JsonObject meter = meterArray.createNestedObject();
      meter["id"]     = slave;
      meter["status"] = "OK";
      meter["kwh"]    = kwh;
      respondingCount++;

    } else if (result == 1) {
      // ── TIMEOUT ──────────────────────────────────────────
      failCount[slave]++;

      if (!knownConnected[slave]) {
        // Never responded before → treat as empty slot, skip entirely
        Serial.printf("EMPTY  | (never connected, skip)\n");
        // Do NOT add to JSON — saves packet size
        continue;
      }

      // Was working before — now not responding
      Serial.printf("FAIL %d/%d | Was connected, now no response\n",
                    failCount[slave], OFFLINE_CONFIRM_COUNT);

      if (failCount[slave] >= OFFLINE_CONFIRM_COUNT) {
        // Confirmed offline after N consecutive failures
        Serial.printf("         → CONFIRMED OFFLINE\n");
        JsonObject meter = meterArray.createNestedObject();
        meter["id"]     = slave;
        meter["status"] = "OFFLINE";
        offlineCount++;
      }
      // If failCount < OFFLINE_CONFIRM_COUNT, don't send yet (could be glitch)

    } else if (result == 2) {
      // ── CRC / WIRING NOISE ───────────────────────────────
      failCount[slave]++;
      Serial.printf("CRC_ERR| Wiring noise on address %d\n", slave);

      if (knownConnected[slave]) {
        // Report to server so dashboard shows the issue
        JsonObject meter = meterArray.createNestedObject();
        meter["id"]     = slave;
        meter["status"] = "CRC_ERROR";
        offlineCount++;
      }

    } else {
      // ── OTHER MODBUS ERROR ───────────────────────────────
      Serial.printf("ERR 0x%02X| Modbus error on address %d\n", result, slave);
    }

    delay(80); // Gap between polls (reduces bus collisions)
  }

  // ======================================================
  // SERIALIZE & SEND UDP
  // ======================================================
  char buffer[4096];
  size_t len = serializeJson(doc, buffer);

  Serial.println("\n========== JSON ==========");
  Serial.println(buffer);
  Serial.printf("Responding: %d | Offline: %d\n\n", respondingCount, offlineCount);

  Udp.beginPacket(remoteIP, remotePort);
  Udp.write((uint8_t*)buffer, len);
  Udp.endPacket();

  Serial.println("UDP Sent\n");

  // ======================================================
  // WAIT UNTIL EXACTLY 60 SECONDS HAVE PASSED
  // ======================================================
  unsigned long elapsed = millis() - startTime;
  if (elapsed < 60000) {
    delay(60000 - elapsed);
  }
}
