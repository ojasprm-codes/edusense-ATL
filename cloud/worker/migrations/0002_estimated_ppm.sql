ALTER TABLE readings ADD COLUMN measurement_unit TEXT NOT NULL DEFAULT 'ADC';
ALTER TABLE readings ADD COLUMN mq2_adc REAL;
ALTER TABLE readings ADD COLUMN mq3_adc REAL;
ALTER TABLE readings ADD COLUMN mq4_adc REAL;
ALTER TABLE readings ADD COLUMN mq5_adc REAL;
ALTER TABLE readings ADD COLUMN mq7_adc REAL;
ALTER TABLE readings ADD COLUMN mq8_adc REAL;

CREATE INDEX IF NOT EXISTS idx_readings_device_unit_time
  ON readings(device_id, measurement_unit, captured_at DESC);
