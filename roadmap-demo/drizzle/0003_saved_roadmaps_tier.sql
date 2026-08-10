ALTER TABLE roadmaps
ADD COLUMN tier TEXT NOT NULL DEFAULT 'premium' CHECK (tier IN ('premium', 'standard'));
--> statement-breakpoint

PRAGMA optimize;
