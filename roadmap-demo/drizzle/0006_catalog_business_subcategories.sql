ALTER TABLE catalog_programs
ADD COLUMN main_package INTEGER NOT NULL DEFAULT 0 CHECK (main_package IN (0, 1));
--> statement-breakpoint

PRAGMA optimize;
