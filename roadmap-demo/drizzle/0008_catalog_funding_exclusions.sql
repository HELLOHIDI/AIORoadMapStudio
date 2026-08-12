DELETE FROM catalog_programs
WHERE instr(replace(replace(replace(replace(title, ' ', ''), char(9), ''), char(10), ''), char(13), ''), '육성자금') > 0
   OR instr(replace(replace(replace(replace(title, ' ', ''), char(9), ''), char(10), ''), char(13), ''), '운전자금') > 0
   OR instr(replace(replace(replace(replace(details, ' ', ''), char(9), ''), char(10), ''), char(13), ''), '육성자금') > 0
   OR instr(replace(replace(replace(replace(details, ' ', ''), char(9), ''), char(10), ''), char(13), ''), '운전자금') > 0;
--> statement-breakpoint

PRAGMA optimize;
