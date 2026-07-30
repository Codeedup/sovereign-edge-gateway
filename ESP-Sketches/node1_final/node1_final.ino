#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_BMP280.h>
#include <DHT.h>
#include "secrets.h"

// --------------------------------------------------
// Wi-Fi and gateway
// --------------------------------------------------

const char* GATEWAY_URL =
  GATEWAY_BASE_URL "/sensor";

const char* DEVICE_NAME = "environment_node_01";

// --------------------------------------------------
// BMP280
// --------------------------------------------------

const uint8_t BMP_I2C_ADDRESS = 0x76;

const int I2C_SDA_PIN = 21;
const int I2C_SCL_PIN = 22;

Adafruit_BMP280 bmp;

// --------------------------------------------------
// DHT11
// --------------------------------------------------

const int DHT_PIN = 4;

#define DHT_TYPE DHT11

DHT dht(DHT_PIN, DHT_TYPE);

// --------------------------------------------------
// Timing
// --------------------------------------------------

const unsigned long SEND_INTERVAL_MS = 10000;

unsigned long lastSendTime = 0;

// --------------------------------------------------
// Wi-Fi diagnostics
// --------------------------------------------------

void onWiFiDisconnect(
  WiFiEvent_t event,
  WiFiEventInfo_t info
) {
  Serial.println();
  Serial.print("Wi-Fi disconnected. Reason: ");
  Serial.println(
    info.wifi_sta_disconnected.reason
  );
}

bool connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  Serial.print("Connecting to ");
  Serial.println(WIFI_SSID);

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

  Serial.print("Signal strength: ");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");

  return true;
}

// --------------------------------------------------
// Read and send sensor data
// --------------------------------------------------

void sendSensorReading() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Cannot send: Wi-Fi disconnected");
    return;
  }

  // BMP280 supplies temperature and pressure.
  float temperature = bmp.readTemperature();
  float pressure = bmp.readPressure() / 100.0F;

  // DHT11 supplies humidity.
  float humidity = dht.readHumidity();

  if (isnan(temperature) || isnan(pressure)) {
    Serial.println("Invalid BMP280 reading");
    return;
  }

  char payload[220];

  if (isnan(humidity)) {
    Serial.println(
      "DHT11 reading failed; sending null humidity"
    );

    snprintf(
      payload,
      sizeof(payload),
      "{\"device\":\"%s\","
      "\"temperature\":%.2f,"
      "\"pressure\":%.2f,"
      "\"humidity\":null}",
      DEVICE_NAME,
      temperature,
      pressure
    );
  } else {
    snprintf(
      payload,
      sizeof(payload),
      "{\"device\":\"%s\","
      "\"temperature\":%.2f,"
      "\"pressure\":%.2f,"
      "\"humidity\":%.2f}",
      DEVICE_NAME,
      temperature,
      pressure,
      humidity
    );
  }

  Serial.println();
  Serial.println("Sending sensor payload:");
  Serial.println(payload);

  WiFiClient client;
  HTTPClient http;

  http.setConnectTimeout(5000);
  http.setTimeout(5000);

  if (!http.begin(client, GATEWAY_URL)) {
    Serial.println(
      "Could not initialise HTTP connection"
    );
    return;
  }

  http.addHeader(
    "Content-Type",
    "application/json"
  );

  int responseCode = http.POST(
    reinterpret_cast<uint8_t*>(payload),
    strlen(payload)
  );

  Serial.print("Gateway response code: ");
  Serial.println(responseCode);

  if (responseCode > 0) {
    Serial.println("Gateway response:");
    Serial.println(http.getString());
  } else {
    Serial.print("HTTP request failed: ");
    Serial.println(
      http.errorToString(responseCode)
    );
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
  Serial.println(
    "Sovereign Edge Environment Node"
  );

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  if (!bmp.begin(BMP_I2C_ADDRESS)) {
    Serial.println(
      "BMP280 not found at address 0x76"
    );

    while (true) {
      delay(1000);
    }
  }

  Serial.println("BMP280 detected");

  dht.begin();

  // Allow the DHT11 to initialise.
  delay(2000);

  WiFi.onEvent(
    onWiFiDisconnect,
    WiFiEvent_t::
      ARDUINO_EVENT_WIFI_STA_DISCONNECTED
  );

  WiFi.setAutoReconnect(true);

  if (connectToWiFi()) {
    sendSensorReading();
    lastSendTime = millis();
  }
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

  unsigned long now = millis();

  if (
    now - lastSendTime >= SEND_INTERVAL_MS
  ) {
    lastSendTime = now;
    sendSensorReading();
  }

  delay(50);
}
