CREATE TABLE tenant_daily_usage (
  tenant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('api', 'dashboard')),
  profile TEXT NOT NULL,
  engine_release TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  admitted INTEGER NOT NULL DEFAULT 0,
  dispatches INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  comparisons INTEGER NOT NULL DEFAULT 0,
  body_bytes INTEGER NOT NULL DEFAULT 0,
  compiled_bytes INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  known_input_tokens INTEGER NOT NULL DEFAULT 0,
  unknown_token_attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day, channel, profile, engine_release)
);
CREATE INDEX tenant_daily_usage_day_idx ON tenant_daily_usage(day);
CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX admin_audit_created_at_idx ON admin_audit(created_at);
CREATE TABLE ops_state (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
