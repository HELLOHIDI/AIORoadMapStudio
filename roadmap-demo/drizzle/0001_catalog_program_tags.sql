ALTER TABLE catalog_programs ADD COLUMN industries_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE catalog_programs ADD COLUMN regions_json TEXT NOT NULL DEFAULT '[]';
