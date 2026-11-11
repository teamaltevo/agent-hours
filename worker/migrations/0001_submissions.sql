CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('sending', 'sent', 'uncertain')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
