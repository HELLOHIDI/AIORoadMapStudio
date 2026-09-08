-- Keep legacy catalog rows intact; enforce uniqueness for all future writes.
CREATE TRIGGER IF NOT EXISTS catalog_programs_link_unique_insert
BEFORE INSERT ON catalog_programs
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM catalog_programs WHERE link = NEW.link)
BEGIN
  SELECT RAISE(ABORT, 'CATALOG_LINK_DUPLICATE');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS catalog_programs_link_unique_update
BEFORE UPDATE OF link ON catalog_programs
FOR EACH ROW
WHEN NEW.link <> OLD.link AND EXISTS (SELECT 1 FROM catalog_programs WHERE link = NEW.link)
BEGIN
  SELECT RAISE(ABORT, 'CATALOG_LINK_DUPLICATE');
END;
