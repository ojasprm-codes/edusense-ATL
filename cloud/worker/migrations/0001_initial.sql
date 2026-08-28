PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

CREATE TABLE oauth_accounts (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  provider_subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_subject)
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent TEXT
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);

CREATE TABLE memberships (
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'staff', 'parent')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (school_id, user_id)
);

CREATE INDEX idx_memberships_user ON memberships(user_id);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  hardware_serial TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
  secret_hash TEXT NOT NULL,
  pairing_code_hash TEXT,
  pairing_expires_at INTEGER,
  claimed_at INTEGER,
  firmware_version TEXT,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_devices_school ON devices(school_id);
CREATE INDEX idx_devices_pairing ON devices(pairing_code_hash, pairing_expires_at);

CREATE TABLE enrollment_tokens (
  token_hash TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX idx_enrollment_expiry ON enrollment_tokens(expires_at);

CREATE TABLE device_access (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL CHECK (access_level IN ('manage', 'view')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, user_id)
);

CREATE INDEX idx_device_access_user ON device_access(user_id);

CREATE TABLE readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  captured_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  temperature REAL,
  humidity REAL,
  mq2 REAL NOT NULL,
  mq3 REAL NOT NULL,
  mq4 REAL NOT NULL,
  mq5 REAL NOT NULL,
  mq7 REAL NOT NULL,
  mq8 REAL NOT NULL,
  overall_aqi REAL,
  ai_status TEXT NOT NULL CHECK (ai_status IN ('CALIBRATING', 'SAFE', 'ELEVATED', 'WARNING', 'DANGER', 'OFFLINE')),
  confidence REAL,
  reason TEXT,
  pi_cpu_temp REAL,
  cpu_usage REAL,
  ram_usage REAL,
  disk_usage REAL,
  arduino_connected INTEGER NOT NULL DEFAULT 0,
  serial_status TEXT,
  UNIQUE (device_id, captured_at)
);

CREATE INDEX idx_readings_device_time ON readings(device_id, captured_at DESC);
CREATE INDEX idx_readings_time ON readings(captured_at DESC);

CREATE TABLE latest_readings (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  captured_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'staff', 'parent')),
  device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER
);

CREATE INDEX idx_invitations_email ON invitations(email, expires_at);
