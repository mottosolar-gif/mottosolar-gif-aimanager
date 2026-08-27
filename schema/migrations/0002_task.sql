CREATE TABLE IF NOT EXISTS task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_ref TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','assigned','accepted','rejected','en_route','arrived','in_progress','blocked','completed','cancelled')),
  assignee_person_code TEXT,
  creator_person_code TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  scheduled_at TEXT,
  due_at TEXT,
  location_text TEXT,
  location_lat REAL,
  location_lng REAL,
  accepted_at TEXT,
  started_at TEXT,
  arrived_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  completion_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (assignee_person_code) REFERENCES person (person_code) ON DELETE SET NULL,
  FOREIGN KEY (creator_person_code) REFERENCES person (person_code) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_task_status_due ON task (status, due_at);
CREATE INDEX IF NOT EXISTS idx_task_assignee ON task (assignee_person_code, status);

CREATE TABLE IF NOT EXISTS task_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_ref TEXT NOT NULL,
  actor_person_code TEXT,
  old_status TEXT,
  new_status TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('line','web','ai','system')),
  note TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (task_ref) REFERENCES task (task_ref) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_task_event_ref ON task_event (task_ref, occurred_at);

CREATE TABLE IF NOT EXISTS outbound_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  task_ref TEXT NOT NULL,
  target_person_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT NOT NULL,
  idem_key TEXT NOT NULL UNIQUE,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (task_ref) REFERENCES task (task_ref) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_outbound_pick ON outbound_queue (status, next_run_at);
