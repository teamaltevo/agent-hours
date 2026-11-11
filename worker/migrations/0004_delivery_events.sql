CREATE TABLE delivery_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  receipt TEXT,
  stage TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  input_bytes INTEGER,
  zip_bytes INTEGER,
  http_status INTEGER,
  code TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX delivery_events_request ON delivery_events(request_id,created_at);
CREATE INDEX delivery_events_receipt ON delivery_events(receipt,created_at);
CREATE INDEX delivery_events_age ON delivery_events(created_at);
