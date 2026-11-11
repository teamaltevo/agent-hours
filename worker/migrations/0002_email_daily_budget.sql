CREATE TABLE email_daily_budget (
  day TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts >= 0)
);
