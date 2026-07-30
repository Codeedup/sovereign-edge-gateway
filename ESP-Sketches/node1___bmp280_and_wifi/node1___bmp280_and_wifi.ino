#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_BMP280.h>
#include "secrets.h"

// --------------------------------------------------
// Network configuration
// --------------------------------------------------

// Raspberry Pi FastAPI endpoint
const char* GATEWAY_URL = GATEWAY_BASE_URL "/sensor";

// --------------------------------------------------
// Sensor configuration
// --------------------------------------------------

const char* DEVICE_NAME = "environment_node_01";

const uint8_t BMP280_I2C_ADDRESS = 0x76;
const int SDA_PIN = 21;
const int SCL_PIN = 22;

Adafruit_BMP280 bmp;

// Send one reading every 10 seconds
const unsigned long SEND_INTERVAL_MS = 10000;
unsigned long lastSendTime = 0;

// --------------------------------------------------
// Wi-Fi diagnostics
// --------------------------------------------------

void onWiFiDisconnect(WiFiEvent_t event, WiFiEventInfo_t info) {
  Serial.println();
  Serial.println("Wi-Fi disconnected");

  Serial.print("Disconnect reason: ");
  Serial.println(info.wifi_sta_disconnected.reason);
}

// --------------------------------------------------
// Connect to Wi-Fi
// --------------------------------------------------

bool connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  Serial.println();
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long connectionStart = millis();
  const unsigned long connectionTimeout = 30000;

  while (
    WiFi.status() != WL_CONNECTED &&
    millis() - connectionStart < connectionTimeout
  ) {
    Serial.print(".");
    delay(500);
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Wi-Fi connected");

    Serial.print("ESP32 IP address: ");
    Serial.println(WiFi.localIP());

    Serial.print("Gateway address: ");
    Serial.println(WiFi.gatewayIP());

    Serial.print("Signal strength: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");

    return true;
  }

  Serial.println("Wi-Fi connection failed");
  return false;
}

// --------------------------------------------------
// Read BMP280 and POST JSON to Raspberry Pi
// --------------------------------------------------

void sendSensorReading() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Cannot send: Wi-Fi is disconnected");
    return;
  }

  float temperature = bmp.readTemperature();

  // BMP280 returns pressure in Pascals.
  // Divide by 100 to convert to hectopascals.
  float pressure = bmp.readPressure() / 100.0F;

  if (isnan(temperature) || isnan(pressure)) {
    Serial.println("BMP280 returned an invalid reading");
    return;
  }

  char jsonPayload[180];

  snprintf(
    jsonPayload,
    sizeof(jsonPayload),
    "{\"device\":\"%s\",\"temperature\":%.2f,\"pressure\":%.2f}",
    DEVICE_NAME,
    temperature,
    pressure
  );

  Serial.println();
  Serial.println("Sending sensor payload:");
  Serial.println(jsonPayload);

  WiFiClient client;
  HTTPClient http;

  http.setConnectTimeout(5000);
  http.setTimeout(5000);

  if (!http.begin(client, GATEWAY_URL)) {
    Serial.println("Failed to initialise HTTP connection");
    return;
  }

  http.addHeader("Content-Type", "application/json");

  int responseCode = http.POST(
    reinterpret_cast<uint8_t*>(jsonPayload),
    strlen(jsonPayload)
  );

  Serial.print("Gateway response code: ");
  Serial.println(responseCode);

  if (responseCode > 0) {
    String responseBody = http.getString();

    Serial.println("Gateway response:");
    Serial.println(responseBody);
  } else {
    Serial.print("HTTP request failed: ");
    Serial.println(http.errorToString(responseCode));
  }

  http.end();
}

// --------------------------------------------------
// Setup
// --------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println();
  Serial.println("=================================");
  Serial.println("Sovereign Edge Environment Node");
  Serial.println("=================================");

  // Start I2C on the ESP32's standard pins
  Wire.begin(SDA_PIN, SCL_PIN);

  Serial.println("Starting BMP280...");

  if (!bmp.begin(BMP280_I2C_ADDRESS)) {
    Serial.println("BMP280 not found at address 0x76");
    Serial.println("Check the sensor wiring.");

    while (true) {
      delay(1000);
    }
  }

  if (!bmp.begin(BMP280_I2C_ADDRESS)) {
  Serial.println("BMP280 not found at address 0x76");
  Serial.println("Check the sensor wiring.");

  while (true) {
    delay(1000);
  }
}

  Serial.println("BMP280 detected");

  WiFi.onEvent(
    onWiFiDisconnect,
    WiFiEvent_t::ARDUINO_EVENT_WIFI_STA_DISCONNECTED
  );

  WiFi.setAutoReconnect(true);

  connectToWiFi();

  // Send the first reading immediately
  if (WiFi.status() == WL_CONNECTED) {
    sendSensorReading();
    lastSendTime = millis();
  }
}

// --------------------------------------------------
// Main loop
// --------------------------------------------------

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();

    // Avoid repeatedly hammering the router
    if (WiFi.status() != WL_CONNECTED) {
      delay(5000);
      return;
    }
  }

  unsigned long currentTime = millis();

  if (currentTime - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = currentTime;
    sendSensorReading();
  }

  delay(50);
}
