ALTER TABLE catalog_programs
  ADD COLUMN support_year INTEGER CHECK (support_year BETWEEN 2000 AND 2100);
--> statement-breakpoint

UPDATE catalog_programs
SET support_year = 2026
WHERE id = 'seed-kimst-sccei-2026';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_catalog_programs_support_year
ON catalog_programs(support_year DESC, updated_at DESC, id DESC);
