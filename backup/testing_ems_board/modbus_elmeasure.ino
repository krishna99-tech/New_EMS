#include <ModbusMaster.h>
#include <math.h>

#define MAX485_RE_DE 4
#define RX2_PIN 32
#define TX2_PIN 33

ModbusMaster node;

const uint8_t SLAVE_ID = 1;
const uint32_t POLL_INTERVAL_MS = 5000;

class ModbusDebugStream : public Stream {
public:
  explicit ModbusDebugStream(HardwareSerial& serial) : serial_(serial) {}

  void beginTransaction() {
    txLength_ = 0;
    rxLength_ = 0;
    txOverflow_ = false;
    rxOverflow_ = false;
  }

  void printTransaction() const {
    printFrame("TX", txBytes_, txLength_, txOverflow_);
    printFrame("RX", rxBytes_, rxLength_, rxOverflow_);
  }

  int available() override {
    return serial_.available();
  }

  int read() override {
    const int value = serial_.read();
    if (value >= 0) {
      recordByte(rxBytes_, rxLength_, rxOverflow_, static_cast<uint8_t>(value));
    }
    return value;
  }

  int peek() override {
    return serial_.peek();
  }

  void flush() override {
    serial_.flush();
  }

  size_t write(uint8_t value) override {
    const size_t written = serial_.write(value);
    if (written > 0) {
      recordByte(txBytes_, txLength_, txOverflow_, value);
    }
    return written;
  }

  size_t write(const uint8_t* buffer, size_t size) override {
    const size_t written = serial_.write(buffer, size);
    for (size_t i = 0; i < written; ++i) {
      recordByte(txBytes_, txLength_, txOverflow_, buffer[i]);
    }
    return written;
  }

private:
  static const size_t FRAME_BUFFER_SIZE = 64;
  HardwareSerial& serial_;
  uint8_t txBytes_[FRAME_BUFFER_SIZE];
  uint8_t rxBytes_[FRAME_BUFFER_SIZE];
  size_t txLength_ = 0;
  size_t rxLength_ = 0;
  bool txOverflow_ = false;
  bool rxOverflow_ = false;

  static void recordByte(uint8_t* buffer, size_t& length, bool& overflow, uint8_t value) {
    if (length < FRAME_BUFFER_SIZE) {
      buffer[length++] = value;
    } else {
      overflow = true;
    }
  }

  static void printFrame(const char* label, const uint8_t* bytes, size_t length, bool overflow) {
    Serial.print(label);
    Serial.print(" frame (");
    Serial.print(length);
    Serial.print(" bytes");
    if (overflow) {
      Serial.print(", truncated");
    }
    Serial.print("):");

    if (length == 0) {
      Serial.print(" <none>");
    } else {
      for (size_t i = 0; i < length; ++i) {
        Serial.print(' ');
        if (bytes[i] < 0x10) {
          Serial.print('0');
        }
        Serial.print(bytes[i], HEX);
      }
    }
    Serial.println();
  }
};

ModbusDebugStream modbusStream(Serial2);

struct RegisterInfo {
  const char* name;
  uint16_t address;
};

const RegisterInfo REGISTERS[] = {
  {"Freq_Hz", 156}
};

void preTransmission() {
  digitalWrite(MAX485_RE_DE, HIGH);
}

void postTransmission() {
  digitalWrite(MAX485_RE_DE, LOW);
}

float registersToFloat(uint16_t firstWord, uint16_t secondWord) {
  union {
    uint32_t bits;
    float value;
  } decoded;

  // Elmeasure uses the low word first; bytes within each register are big-endian.
  decoded.bits = ((uint32_t)secondWord << 16) | firstWord;
  return decoded.value;
}

void readAndPrint(const RegisterInfo& reg) {
  modbusStream.beginTransaction();
  const uint8_t result = node.readHoldingRegisters(reg.address, 2);

  Serial.print(reg.name);
  Serial.print(" (register ");
  Serial.print(reg.address);
  Serial.print("): ");
  modbusStream.printTransaction();

  if (result != node.ku8MBSuccess) {
    Serial.print("read failed (Modbus error 0x");
    Serial.print(result, HEX);
    Serial.println(")");
    if (result == node.ku8MBInvalidSlaveID) {
      Serial.println("The response slave ID did not match the requested slave ID.");
    } else if (result == node.ku8MBResponseTimedOut) {
      Serial.println("No valid Modbus response was received before timeout.");
    }
    return;
  }

  Serial.print("raw registers: 0x");
  Serial.print(node.getResponseBuffer(0), HEX);
  Serial.print(" 0x");
  Serial.println(node.getResponseBuffer(1), HEX);

  const float value = registersToFloat(
    node.getResponseBuffer(0),
    node.getResponseBuffer(1)
  );

  if (isnan(value) || isinf(value)) {
    Serial.println("invalid float");
    return;
  }

  Serial.println(value, 3);
}

void setup() {
  pinMode(MAX485_RE_DE, OUTPUT);
  postTransmission();

  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8E1, RX2_PIN, TX2_PIN);

  node.begin(SLAVE_ID, modbusStream);
  node.preTransmission(preTransmission);
  node.postTransmission(postTransmission);

  Serial.println("Modbus reader started for slave 1");
}

void loop() {
  Serial.println("--- Slave 1 readings ---");

  for (const RegisterInfo& reg : REGISTERS) {
    readAndPrint(reg);
    delay(100);
  }

  Serial.println();
  delay(POLL_INTERVAL_MS);
}
