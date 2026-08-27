PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inbox_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  message_type TEXT,
  source_type TEXT,
  source_hash TEXT CHECK (source_hash IS NULL OR length(source_hash) = 64),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL CHECK (payload_bytes >= 0),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  body_ref TEXT CHECK (body_ref IS NULL),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_inbox_event_status_received
  ON inbox_event (status, received_at);

CREATE TABLE IF NOT EXISTS job_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_run_at TEXT NOT NULL,
  idem_key TEXT NOT NULL UNIQUE,
  event_occurred_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (event_id) REFERENCES inbox_event (event_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_job_queue_pick
  ON job_queue (status, next_run_at);

CREATE TABLE IF NOT EXISTS person (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_code TEXT NOT NULL UNIQUE,
  department TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS person_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_code TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_hash TEXT NOT NULL UNIQUE CHECK (length(source_hash) = 64),
  linked_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (person_code) REFERENCES person (person_code) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reference_id TEXT,
  actor_code TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (actor_code) REFERENCES person (person_code) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_occurred_at
  ON ledger (occurred_at);

CREATE TABLE IF NOT EXISTS sync_state (
  source_key TEXT PRIMARY KEY,
  checkpoint TEXT,
  source_occurred_at TEXT,
  synced_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

