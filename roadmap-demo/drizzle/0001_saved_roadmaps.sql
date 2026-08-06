CREATE TABLE IF NOT EXISTS roadmaps (
  id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL DEFAULT '' CHECK (length(client_name) <= 240),
  document_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_roadmaps_updated_at
ON roadmaps(updated_at DESC, id DESC);
--> statement-breakpoint

PRAGMA optimize;

