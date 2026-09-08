-- Keep legacy catalog rows intact; writes use an atomic NOT EXISTS guard.
CREATE INDEX IF NOT EXISTS idx_catalog_programs_link
ON catalog_programs(link);
