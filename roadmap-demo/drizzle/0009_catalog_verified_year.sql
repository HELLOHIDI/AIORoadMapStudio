ALTER TABLE catalog_programs
  ADD COLUMN verified_year INTEGER CHECK (verified_year IS NULL OR verified_year BETWEEN 2000 AND 2100);
