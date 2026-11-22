CREATE TABLE contact_messages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (acknowledged IN (0, 1)),
  acknowledged_at TEXT
);

CREATE INDEX contact_messages_created_at ON contact_messages(created_at DESC);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  bucket INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
