CREATE TABLE catalog_programs_next (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('consulting', 'business', 'voucher', 'ip', 'certification')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  link TEXT NOT NULL CHECK (length(link) BETWEEN 1 AND 2048 AND (link LIKE 'http://%' OR link LIKE 'https://%')),
  amount_krw INTEGER CHECK (amount_krw IS NULL OR amount_krw >= 1),
  start_month INTEGER NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  end_month INTEGER NOT NULL CHECK (end_month BETWEEN 1 AND 12 AND start_month <= end_month),
  target TEXT NOT NULL CHECK (length(target) BETWEEN 1 AND 1000),
  details TEXT NOT NULL CHECK (length(details) BETWEEN 1 AND 4000),
  industries_json TEXT NOT NULL DEFAULT '[]',
  regions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint

INSERT INTO catalog_programs_next (
  id, category, title, link, amount_krw, start_month, end_month,
  target, details, industries_json, regions_json, created_at, updated_at
)
SELECT
  id, category, title, link, amount_krw, start_month, end_month,
  target, details, industries_json, regions_json, created_at, updated_at
FROM catalog_programs;
--> statement-breakpoint

DROP TABLE catalog_programs;
--> statement-breakpoint

ALTER TABLE catalog_programs_next RENAME TO catalog_programs;
--> statement-breakpoint

CREATE INDEX idx_catalog_programs_updated_at
ON catalog_programs(updated_at DESC, id DESC);
--> statement-breakpoint

PRAGMA optimize;
