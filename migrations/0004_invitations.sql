CREATE TABLE account_invitations (
  email TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  accepted_at TEXT
);
