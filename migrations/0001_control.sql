PRAGMA foreign_keys = ON;

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE CHECK (length(key_hash) = 64),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE daily_usage (
  key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
  comparisons INTEGER NOT NULL DEFAULT 0 CHECK (comparisons >= 0),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  unknown_token_requests INTEGER NOT NULL DEFAULT 0 CHECK (unknown_token_requests >= 0),
  PRIMARY KEY (key_id, day)
);

CREATE INDEX daily_usage_day_idx ON daily_usage(day);
