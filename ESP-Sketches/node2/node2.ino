#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <BH1750.h>
#include "secrets.h"

// --------------------------------------------------
// Network
// --------------------------------------------------

const char* MOTION_URL =
  GATEWAY_BASE_URL "/motion";

const char* LIGHT_URL =
  GATEWAY_BASE_URL "/light";

const char* DEVICE_NAME = "sensor_node_02";

// --------------------------------------------------
// Sensors
// --------------------------------------------------

const int PIR_PIN = 23;

const int SDA_PIN = 21;
const int SCL_PIN = 22;

BH1750 lightMeter;

// --------------------------------------------------
// Timing
// --------------------------------------------------

const unsigned long LIGHT_INTERVAL_MS = 10000;

unsigned long lastLightSend = 0;
int lastMotionState = -1;

// --------------------------------------------------
// Wi-Fi
// --------------------------------------------------

bool connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  Serial.print("Connecting to Wi-Fi");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startTime = millis();

  while (
    WiFi.status() != WL_CONNECTED &&
    millis() - startTime < 30000
  ) {
    Serial.print(".");
    delay(500);
  }

  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi connection failed");
    return false;
  }

  Serial.println("Wi-Fi connected");

  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

  return true;
}

// --------------------------------------------------
// HTTP helper
// --------------------------------------------------

bool postJson(
  const char* url,
  const String& payload
) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  WiFiClient client;
  HTTPClient http;

  http.setConnectTimeout(5000);
  http.setTimeout(5000);

  if (!http.begin(client, url)) {
    Serial.println("HTTP initialisation failed");
    return false;
  }

  http.addHeader(
    "Content-Type",
    "application/json"
  );

  int responseCode = http.POST(payload);

  Serial.print("Response code: ");
  Serial.println(responseCode);

  if (responseCode > 0) {
    Serial.println(http.getString());
  } else {
    Serial.println(
      http.errorToString(responseCode)
    );
  }

  http.end();

  return responseCode == 200;
}

// --------------------------------------------------
// Motion
// --------------------------------------------------

bool sendMotion(bool motionDetected) {
  String payload =
    "{\"device\":\"" +
    String(DEVICE_NAME) +
    "\",\"motion\":" +
    String(motionDetected ? "true" : "false") +
    "}";

  Serial.print("Sending motion: ");
  Serial.println(payload);

  return postJson(MOTION_URL, payload);
}

// --------------------------------------------------
// Light
// --------------------------------------------------

void sendLightReading() {
  float lux = lightMeter.readLightLevel();

  if (lux < 0) {
    Serial.println("Invalid BH1750 reading");
    return;
  }

  String payload =
    "{\"device\":\"" +
    String(DEVICE_NAME) +
    "\",\"lux\":" +
    String(lux, 2) +
    "}";

  Serial.print("Sending light: ");
  Serial.println(payload);

  postJson(LIGHT_URL, payload);
}

// --------------------------------------------------
// Setup
// --------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(2000);

  pinMode(PIR_PIN, INPUT);

  Wire.begin(SDA_PIN, SCL_PIN);

  if (!lightMeter.begin()) {
    Serial.println("BH1750 not detected");

    while (true) {
      delay(1000);
    }
  }

  Serial.println("BH1750 detected");

  WiFi.setAutoReconnect(true);

  connectToWiFi();

  Serial.println("Allowing PIR to stabilise...");
  delay(30000);

  lastMotionState = digitalRead(PIR_PIN);

  sendMotion(lastMotionState == HIGH);
  sendLightReading();

  lastLightSend = millis();
}

// --------------------------------------------------
// Loop
// --------------------------------------------------

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    if (!connectToWiFi()) {
      delay(5000);
      return;
    }
  }

  int currentMotionState = digitalRead(PIR_PIN);

  if (currentMotionState != lastMotionState) {
    bool sent = sendMotion(
      currentMotionState == HIGH
    );

    if (sent) {
      lastMotionState = currentMotionState;
    }
  }

  unsigned long now = millis();

  if (
    now - lastLightSend >= LIGHT_INTERVAL_MS
  ) {
    lastLightSend = now;
    sendLightReading();
  }

  delay(100);
}
