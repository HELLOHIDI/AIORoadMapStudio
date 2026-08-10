CREATE TABLE IF NOT EXISTS roadmap_feedback (
  id TEXT PRIMARY KEY,
  roadmap_id TEXT NOT NULL,
  program_id TEXT NOT NULL CHECK (length(program_id) BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK (status IN ('needs_changes', 'completed', 'resolved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (roadmap_id) REFERENCES roadmaps(id) ON DELETE CASCADE,
  UNIQUE (roadmap_id, program_id)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS roadmap_feedback_events (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('comment', 'completed', 'resolved', 'rework')),
  role TEXT NOT NULL CHECK (role IN ('lead', 'assignee')),
  text TEXT NOT NULL CHECK (length(text) <= 4000),
  created_at TEXT NOT NULL,
  FOREIGN KEY (feedback_id) REFERENCES roadmap_feedback(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_roadmap_feedback_roadmap
ON roadmap_feedback(roadmap_id, updated_at DESC, id DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_roadmap_feedback_events_feedback
ON roadmap_feedback_events(feedback_id, created_at ASC, id ASC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS feedback_auth_sessions (
  token_hash TEXT PRIMARY KEY,
  secret_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_feedback_auth_sessions_expires
ON feedback_auth_sessions(expires_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS feedback_auth_attempts (
  attempt_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint

PRAGMA optimize;
