#include <WiFi.h>
#include <WiFiUdp.h>

// Enter the Wi-Fi network credentials.
const char* ssid = "YOUR_WIFI_NAME";
const char* password = "YOUR_WIFI_PASSWORD";

// Static network settings
IPAddress localIP(192, 168, 0, 229);
IPAddress gateway(192, 168, 0, 254);
IPAddress subnet(255, 255, 255, 0);
IPAddress dns(8, 8, 8, 8);

// UDP target
IPAddress remoteIP(192, 168, 0, 41); // Change to your PC/server IP
const unsigned int udpPort = 10011;

WiFiUDP Udp;

void connectToWiFi() {
  if (!WiFi.config(localIP, gateway, subnet, dns)) {
    Serial.println("Failed to configure static IP");
  }

  Serial.print("Connecting to Wi-Fi");
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("Connected. IP address: ");
  Serial.println(WiFi.localIP());

  if (!Udp.begin(udpPort)) {
    Serial.println("Failed to start UDP");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  WiFi.mode(WIFI_STA);
  connectToWiFi();

  randomSeed(analogRead(34));
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi disconnected; reconnecting...");
    connectToWiFi();
  }

  int randNumber = random(0, 1000);

  Serial.print("Sending: ");
  Serial.println(randNumber);

  if (Udp.beginPacket(remoteIP, udpPort)) {
    Udp.print("Random: ");
    Udp.print(randNumber);

    if (Udp.endPacket() == 0) {
      Serial.println("UDP send failed");
    }
  } else {
    Serial.println("Could not start UDP packet");
  }

  delay(2000);
}
