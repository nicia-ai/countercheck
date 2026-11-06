CREATE TABLE access_requests (
  email TEXT PRIMARY KEY NOT NULL,
  note TEXT CHECK(note IS NULL OR length(note) <= 2000),
  requested_at TEXT NOT NULL,
  reviewed_at TEXT,
  dismissed_at TEXT
);
CREATE INDEX access_requests_pending ON access_requests(reviewed_at, dismissed_at, requested_at);
