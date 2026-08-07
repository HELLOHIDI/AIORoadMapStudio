CREATE TABLE IF NOT EXISTS catalog_options (
  kind TEXT NOT NULL CHECK (kind IN ('industry', 'region')),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 100),
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, value)
);
--> statement-breakpoint

PRAGMA optimize;
