#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <RTClib.h>

// ================ SD CARD ================
#define SD_CS_PIN    27
#define SD_SCK_PIN   18
#define SD_MISO_PIN  19
#define SD_MOSI_PIN  23

const char *LOG_FILE = "/modbus_log.csv";

// ================ RTC ====================
#define RTC_SDA_PIN 21
#define RTC_SCL_PIN 22

RTC_DS3231 rtc;
SPIClass sdSPI(VSPI);

bool sdReady = false;
bool rtcReady = false;

unsigned long lastLogTime = 0;
const unsigned long LOG_INTERVAL_MS = 5000;

// ================ RTC TIME ===============
String getTimestamp() {
  DateTime now = rtc.now();

  char buffer[25];

  snprintf(
    buffer, sizeof(buffer),
    "%04d-%02d-%02d %02d:%02d:%02d",
    now.year(), now.month(), now.day(),
    now.hour(), now.minute(), now.second()
  );

  return String(buffer);
}

// ================ SD INITIALIZATION =====
bool initializeSD() {
  Serial.println("\nInitializing SD card...");

  sdSPI.begin(
    SD_SCK_PIN,
    SD_MISO_PIN,
    SD_MOSI_PIN,
    SD_CS_PIN
  );

  if (!SD.begin(SD_CS_PIN, sdSPI, 400000)) {
    Serial.println("ERROR: SD initialization failed");
    return false;
  }

  Serial.println("SD card initialized successfully");

  Serial.print("Card capacity: ");
  Serial.print(
    (unsigned long)(
      SD.cardSize() / (1024ULL * 1024ULL)
    )
  );
  Serial.println(" MB");

  return true;
}

// ================ RTC INITIALIZATION =====
bool initializeRTC() {
  Serial.println("\nInitializing DS3231...");

  Wire.begin(RTC_SDA_PIN, RTC_SCL_PIN);

  if (!rtc.begin()) {
    Serial.println("ERROR: DS3231 not detected");
    return false;
  }

  if (rtc.lostPower()) {
    Serial.println("RTC lost power; setting compile time");

    // Uses the sketch compilation date/time.
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }

  Serial.println("DS3231 initialized successfully");
  Serial.print("RTC time: ");
  Serial.println(getTimestamp());

  return true;
}

// ================ CSV HEADER =============
void createCSVHeader() {
  if (!sdReady) return;

  if (!SD.exists(LOG_FILE)) {
    File file = SD.open(LOG_FILE, FILE_WRITE);

    if (file) {
      file.println("Timestamp,Event,Value,Status");
      file.close();
      Serial.println("CSV header created");
    } else {
      Serial.println("ERROR: Cannot create CSV file");
    }
  }
}

// ================ LOG DATA ===============
void logData() {
  if (!sdReady || !rtcReady) {
    Serial.println("Logging skipped: SD or RTC unavailable");
    return;
  }

  String timestamp = getTimestamp();

  File file = SD.open(LOG_FILE, FILE_APPEND);

  if (!file) {
    Serial.println("ERROR: Cannot open log file");
    return;
  }

  file.print(timestamp);
  file.println(",SD_RTC_TEST,1,OK");
  file.close();

  Serial.print("Logged: ");
  Serial.println(timestamp);
}

// ================ READ CSV ===============
void readLogFile() {
  if (!sdReady) return;

  File file = SD.open(LOG_FILE, FILE_READ);

  if (!file) {
    Serial.println("ERROR: Cannot read log file");
    return;
  }

  Serial.println("\n========== CSV CONTENT ==========");

  while (file.available()) {
    Serial.write(file.read());
  }

  file.close();

  Serial.println("\n=================================");
}

// ================ SETUP ==================
void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println("\n================================");
  Serial.println(" ESP32 + DS3231 + SD LOGGER");
  Serial.println("================================");

  rtcReady = initializeRTC();
  sdReady = initializeSD();

  if (sdReady) {
    createCSVHeader();
  }

  if (!rtcReady) {
    Serial.println("RTC unavailable; check SDA/SCL and power");
  }

  if (!sdReady) {
    Serial.println("SD unavailable; check SPI wiring and power");
  }

  if (sdReady && rtcReady) {
    Serial.println("\nBoth devices are ready");
    logData();
    readLogFile();
    lastLogTime = millis();
  }
}

// ================ LOOP ===================
void loop() {
  if (sdReady && rtcReady &&
      millis() - lastLogTime >= LOG_INTERVAL_MS) {

    lastLogTime = millis();
    logData();
  }
}