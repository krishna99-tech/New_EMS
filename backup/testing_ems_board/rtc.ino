
#include <Wire.h>
#include <RTClib.h>

RTC_DS3231 rtc;

void setup() {
  Serial.begin(115200);

  // ESP32 I2C pins
  Wire.begin(21, 5);

  if (!rtc.begin()) {
    Serial.println("DS3231 not detected!");
    Serial.println("Check VCC, GND, SDA and SCL.");
    while (true) {
      delay(1000);
    }
  }

  Serial.println("DS3231 RTC detected!");

  if (rtc.lostPower()) {
    Serial.println("RTC lost power. Setting initial time.");

    // Uses the date and time when this code was compiled.
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }
}

void loop() {
  DateTime now = rtc.now();

  Serial.printf("Date: %04d-%02d-%02d\n",
                now.year(), now.month(), now.day());

  Serial.printf("Time: %02d:%02d:%02d\n",
                now.hour(), now.minute(), now.second());

  Serial.printf("Temperature: %.2f C\n",
                rtc.getTemperature());

  Serial.println("------------------------");

  delay(1000);
}
