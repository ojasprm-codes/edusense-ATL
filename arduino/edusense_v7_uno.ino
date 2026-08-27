#include <DHT.h>

// EDUSENSE AI V7 - Arduino Uno R3 sensor and actuator firmware.
// The Raspberry Pi owns all environmental classification decisions.

constexpr uint8_t DHT_PIN = 2;
constexpr uint8_t DHT_TYPE = DHT22;

constexpr uint8_t MQ2_PIN = A0;
constexpr uint8_t MQ3_PIN = A4;
constexpr uint8_t MQ4_PIN = A5;
constexpr uint8_t MQ5_PIN = A1;
constexpr uint8_t MQ7_PIN = A2;
constexpr uint8_t MQ8_PIN = A3;

// Common-cathode RGB LED. Change RGB_COMMON_ANODE to true if required.
constexpr uint8_t RED_PIN = 9;
constexpr uint8_t GREEN_PIN = 10;
constexpr uint8_t BLUE_PIN = 11;
constexpr bool RGB_COMMON_ANODE = false;

constexpr uint8_t BUZZER_PIN = 8;
constexpr unsigned long SENSOR_INTERVAL_MS = 1000UL;
constexpr unsigned long CALIBRATION_TIME_MS = 200000UL;
constexpr size_t COMMAND_BUFFER_SIZE = 32;

DHT dht(DHT_PIN, DHT_TYPE);

enum class SystemStatus : uint8_t {
  OUTPUTS_OFF,
  SAFE,
  ELEVATED,
  WARNING,
  DANGER
};

char commandBuffer[COMMAND_BUFFER_SIZE];
size_t commandLength = 0;
unsigned long bootTimeMs = 0;
unsigned long lastSensorReadMs = 0;
unsigned long lastWarningToggleMs = 0;
bool warningBuzzerOn = false;
SystemStatus activeStatus = SystemStatus::OUTPUTS_OFF;

void writeLedChannel(uint8_t pin, uint8_t value) {
  analogWrite(pin, RGB_COMMON_ANODE ? 255 - value : value);
}

void setRgb(uint8_t red, uint8_t green, uint8_t blue) {
  writeLedChannel(RED_PIN, red);
  writeLedChannel(GREEN_PIN, green);
  writeLedChannel(BLUE_PIN, blue);
}

void outputsOff() {
  setRgb(0, 0, 0);
  noTone(BUZZER_PIN);
  digitalWrite(BUZZER_PIN, LOW);
  warningBuzzerOn = false;
}

bool calibrationActive() {
  return millis() - bootTimeMs < CALIBRATION_TIME_MS;
}

void applyStatusOutputs() {
  // Ignore every status command during MQ warm-up. Sensor packets continue.
  if (calibrationActive() || activeStatus == SystemStatus::OUTPUTS_OFF) {
    outputsOff();
    return;
  }

  switch (activeStatus) {
    case SystemStatus::SAFE:
      setRgb(0, 255, 0);
      noTone(BUZZER_PIN);
      break;

    case SystemStatus::ELEVATED:
      setRgb(0, 150, 255);
      noTone(BUZZER_PIN);
      break;

    case SystemStatus::WARNING:
      setRgb(255, 105, 0);
      if (millis() - lastWarningToggleMs >= 500UL) {
        lastWarningToggleMs = millis();
        warningBuzzerOn = !warningBuzzerOn;
        if (warningBuzzerOn) {
          tone(BUZZER_PIN, 1800);
        } else {
          noTone(BUZZER_PIN);
        }
      }
      break;

    case SystemStatus::DANGER:
      setRgb(255, 0, 0);
      tone(BUZZER_PIN, 2400);
      break;

    default:
      outputsOff();
      break;
  }
}

void processCommand(const char* command) {
  if (strcmp(command, "STATUS:SAFE") == 0) {
    activeStatus = SystemStatus::SAFE;
  } else if (strcmp(command, "STATUS:ELEVATED") == 0) {
    activeStatus = SystemStatus::ELEVATED;
  } else if (strcmp(command, "STATUS:WARNING") == 0) {
    activeStatus = SystemStatus::WARNING;
  } else if (strcmp(command, "STATUS:DANGER") == 0) {
    activeStatus = SystemStatus::DANGER;
  } else if (strcmp(command, "OUTPUTS:OFF") == 0) {
    activeStatus = SystemStatus::OUTPUTS_OFF;
  } else {
    return;
  }

  applyStatusOutputs();
}

void receiveCommands() {
  while (Serial.available() > 0) {
    const char incoming = static_cast<char>(Serial.read());

    if (incoming == '\n' || incoming == '\r') {
      if (commandLength > 0) {
        commandBuffer[commandLength] = '\0';
        processCommand(commandBuffer);
        commandLength = 0;
      }
      continue;
    }

    if (commandLength < COMMAND_BUFFER_SIZE - 1) {
      commandBuffer[commandLength++] = incoming;
    } else {
      commandLength = 0;
    }
  }
}

void transmitSensorPacket() {
  const float temperature = dht.readTemperature();
  const float humidity = dht.readHumidity();

  // Do not emit partial or invalid packets; the Pi accepts complete packets only.
  if (isnan(temperature) || isnan(humidity)) {
    return;
  }

  const int mq2 = analogRead(MQ2_PIN);
  const int mq3 = analogRead(MQ3_PIN);
  const int mq4 = analogRead(MQ4_PIN);
  const int mq5 = analogRead(MQ5_PIN);
  const int mq7 = analogRead(MQ7_PIN);
  const int mq8 = analogRead(MQ8_PIN);

  Serial.print(F("TEMP:"));
  Serial.print(temperature, 1);
  Serial.print(F(",HUM:"));
  Serial.print(humidity, 1);
  Serial.print(F(",MQ2:"));
  Serial.print(mq2);
  Serial.print(F(",MQ3:"));
  Serial.print(mq3);
  Serial.print(F(",MQ4:"));
  Serial.print(mq4);
  Serial.print(F(",MQ5:"));
  Serial.print(mq5);
  Serial.print(F(",MQ7:"));
  Serial.print(mq7);
  Serial.print(F(",MQ8:"));
  Serial.println(mq8);
}

void setup() {
  pinMode(RED_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
  pinMode(BLUE_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  outputsOff();
  dht.begin();
  Serial.begin(9600);

  bootTimeMs = millis();
  lastSensorReadMs = bootTimeMs - SENSOR_INTERVAL_MS;
  Serial.println(F("EDUSENSE_READY"));
}

void loop() {
  receiveCommands();

  const unsigned long now = millis();
  if (now - lastSensorReadMs >= SENSOR_INTERVAL_MS) {
    lastSensorReadMs = now;
    transmitSensorPacket();
  }

  applyStatusOutputs();
}
