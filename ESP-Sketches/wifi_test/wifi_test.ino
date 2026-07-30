#include <WiFi.h>
#include "secrets.h"

void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println();
  Serial.println("==== Clean ESP32 Wi-Fi Debug ====");

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.disconnect(true, true);
  delay(2000);

  Serial.print("Connecting to SSID: ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;

  while (WiFi.status() != WL_CONNECTED && attempts < 60) {
    delay(500);
    Serial.print(".");
    Serial.print(" status=");
    Serial.println(WiFi.status());
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("Wi-Fi connected.");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    Serial.print("RSSI: ");
    Serial.println(WiFi.RSSI());
  } else {
    Serial.println();
    Serial.println("Wi-Fi failed.");
    Serial.print("Final status: ");
    Serial.println(WiFi.status());
  }
}

void loop() {
}
