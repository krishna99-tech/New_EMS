#include <WiFi.h>
#include <SD.h>
#include <SPI.h>
#include <HTTPClient.h>
#include "RTClib.h"

// --- Custom SPI Configuration for SD Card (HSPI) ---
#define SD_MISO 19 
#define SD_MOSI 23 
#define SD_SCK  18 
#define SD_CS   5  

// --- Configuration ---
const char* ssid = "Eee";
const char* password = "PASSWORD";

// Updated to your latest IP address
const char* serverUrl = "http://10.16.81.150:5000/api/data"; 
const char* offlineFileName = "/offline_data.csv";
RTC_DS3231 rtc;

// Global Sensor Variable
int simulatedSensorValue = 0; 

// --- Non-Blocking Timer Variables ---
unsigned long previousDataMillis = 0;
const long dataInterval = 60000; // 60 seconds

unsigned long previousWiFiMillis = 0;
const long wifiInterval = 10000; // 10 seconds

// --- State Tracking Variable ---
bool wasWiFiConnected = false; 

SPIClass spiSD(HSPI);

void setup() {
  Serial.begin(115200);
  
  if (!rtc.begin()) {
    Serial.println("Couldn't find RTC");
    while (1);
  }

  spiSD.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);

  if (!SD.begin(SD_CS, spiSD)) {
    Serial.println("SD Card initialization failed! Check wiring.");
    return;
  }
  
  WiFi.begin(ssid, password);
  Serial.println("Setup Complete. Connecting to WiFi...");
}

void loop() {
  unsigned long currentMillis = millis();
  bool isWiFiConnected = (WiFi.status() == WL_CONNECTED);

  // ---------------------------------------------------------
  // TASK 1: Continuously Check and Manage WiFi
  // ---------------------------------------------------------
  if (!isWiFiConnected) {
    if (currentMillis - previousWiFiMillis >= wifiInterval) {
      Serial.println("WiFi disconnected. Attempting to reconnect...");
      WiFi.disconnect();
      WiFi.begin(ssid, password);
      previousWiFiMillis = currentMillis; 
    }
  }

  // ---------------------------------------------------------
  // TASK 1.5: Immediate SD Push on Reconnection
  // ---------------------------------------------------------
  if (isWiFiConnected && !wasWiFiConnected) {
    Serial.println("WiFi Connection Restored!");
    if (SD.exists(offlineFileName)) {
      Serial.println("Triggering immediate push of offline data...");
      pushOfflineData(); 
    }
  }

  wasWiFiConnected = isWiFiConnected; 

  // ---------------------------------------------------------
  // TASK 2: Send Live Data Every 60 Seconds
  // ---------------------------------------------------------
  if (currentMillis - previousDataMillis >= dataInterval) {
    previousDataMillis = currentMillis; 

    DateTime now = rtc.now();
    String timeStamp = String(now.year()) + "-" + String(now.month()) + "-" + String(now.day()) + " " + 
                       String(now.hour()) + ":" + String(now.minute()) + ":" + String(now.second());
    
    simulatedSensorValue += random(1, 6); 
    
    // Format: "Timestamp,Value" (Serial number removed)
    String dataString = timeStamp + "," + String(simulatedSensorValue);

    if (!isWiFiConnected) {
      Serial.println("Offline. Saving live data to SD: " + dataString);
      logToSD(dataString);
    } else {
      bool serverIsUp = true;

      if (SD.exists(offlineFileName)) {
        serverIsUp = pushOfflineData(); 
      }
      
      if (serverIsUp) {
        Serial.println("Sending live data: " + dataString);
        bool success = sendToDashboard(dataString);
        
        if (!success) {
          Serial.println("Live transmission failed! Saving to SD instead.");
          logToSD(dataString);
        }
      } else {
        Serial.println("Server is unreachable. Saving live data to SD.");
        logToSD(dataString);
      }
    }
  }
}

// --- Helper Functions ---

void logToSD(String data) {
  File dataFile = SD.open(offlineFileName, FILE_APPEND);
  if (dataFile) {
    dataFile.println(data);
    dataFile.close();
  } else {
    Serial.println("Error opening SD card for writing.");
  }
}

bool pushOfflineData() {
  File dataFile = SD.open(offlineFileName);
  if (dataFile) {
    while (dataFile.available()) {
      String line = dataFile.readStringUntil('\n');
      line.trim(); 
      
      if (line.length() > 0) {
        bool success = sendToDashboard(line);
        if (!success) {
          Serial.println("Transmission failed. Preserving SD data.");
          dataFile.close();
          return false; 
        }
      }
    }
    dataFile.close();
    SD.remove(offlineFileName); 
    Serial.println("SD card buffer cleared.");
    return true; 
  }
  return true;
}

bool sendToDashboard(String payload) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    // Parse the 2 values: "Timestamp,Value"
    int commaIndex = payload.indexOf(',');

    if (commaIndex > 0) {
      String timeStamp = payload.substring(0, commaIndex);
      String value = payload.substring(commaIndex + 1);

      // JSON payload without serial number
      String jsonPayload = "{\"time\": \"" + timeStamp + "\", \"value\": " + value + "}";

      int httpResponseCode = http.POST(jsonPayload);
      http.end(); 
      
      if (httpResponseCode == 200) {
        return true; 
      } else {
        Serial.print("HTTP Error Code: ");
        Serial.println(httpResponseCode);
        return false;
      }
    }
  }
  return false;
}