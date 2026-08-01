#include <ModbusMaster.h>
#include <ArduinoJson.h>

// ================= DEVICE =================
#define DEVICE_ID "LaminationPlant"

// ================= RS485 =================
#define MAX485_RE_DE 4
#define RX2_PIN 32
#define TX2_PIN 33

ModbusMaster node;

// ================= METERS =================
#define TOTAL_METERS 1

// Elmeasure kWh Register (Wh Received)
// Offset: 158
uint16_t ELM_KWH_REG = 158;

uint8_t slaveIds[TOTAL_METERS] = {
  1
};

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
bool readKwh(uint8_t slave, float &value) {
  node.begin(slave, Serial2);

  // Flush stale bytes before transmitting
  while (Serial2.available()) {
    Serial2.read();
  }

  uint8_t res = node.readHoldingRegisters(ELM_KWH_REG, 2);

  if (res == node.ku8MBSuccess) {
    uint16_t r1 = node.getResponseBuffer(0);
    uint16_t r2 = node.getResponseBuffer(1);
    value = round(decodeSwapped(r1, r2) * 100) / 100.0;
    return true;
  }

  value = -1;
  Serial.print("Failed Meter ID: ");
  Serial.println(slave);
  return false;
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);

  // RS485
  pinMode(MAX485_RE_DE, OUTPUT);
  digitalWrite(MAX485_RE_DE, LOW);

  Serial2.begin(9600, SERIAL_8E1, RX2_PIN, TX2_PIN);

  node.preTransmission(preTransmission);
  node.postTransmission(postTransmission);

  Serial.println("\n--- Serial Only Lamination Plant (No Network) ---");
}

// ================= LOOP =================
void loop() {
  unsigned long startTime = millis();

  StaticJsonDocument<2048> doc;
  doc["device"] = DEVICE_ID;
  JsonArray meterArray = doc.createNestedArray("meters");

  // ======================================================
  // READ ALL ELMEASURE METERS
  // ======================================================
  for (int i = 0; i < TOTAL_METERS; i++) {
    uint8_t slave = slaveIds[i];
    float kwh = 0;

    bool status = readKwh(slave, kwh);

    // Serial debug
    Serial.print("Meter ID: ");
    Serial.print(slave);
    Serial.print(" | Status: ");

    if (status) {
      Serial.print("OK | KWH: ");
      Serial.println(kwh);
    } else {
      Serial.println("OFFLINE");
    }

    // Build JSON object for this meter
    JsonObject meter = meterArray.createNestedObject();
    meter["id"]     = slave;
    meter["status"] = status ? "OK" : "OFFLINE";
    if (status) {
      meter["kwh"] = kwh;
    }

    delay(100);
  }

  // ======================================================
  // SERIALIZE & PRINT JSON
  // ======================================================
  char buffer[2048];
  serializeJson(doc, buffer);

  Serial.println("\n========== JSON ==========");
  Serial.println(buffer);
  Serial.println("==========================\n");

  // ======================================================
  // WAIT UNTIL EXACTLY 60 SECONDS HAVE PASSED
  // ======================================================
  unsigned long elapsed = millis() - startTime;
  if (elapsed < 60000) {
    delay(60000 - elapsed);
  }
}
