CREATE TABLE IF NOT EXISTS catalog_programs (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('consulting', 'business', 'voucher', 'ip', 'certification')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  link TEXT NOT NULL CHECK (length(link) BETWEEN 1 AND 2048 AND (link LIKE 'http://%' OR link LIKE 'https://%')),
  amount_krw INTEGER CHECK (amount_krw IS NULL OR amount_krw >= 1000000),
  start_month INTEGER NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  end_month INTEGER NOT NULL CHECK (end_month BETWEEN 1 AND 12 AND start_month <= end_month),
  target TEXT NOT NULL CHECK (length(target) BETWEEN 1 AND 1000),
  details TEXT NOT NULL CHECK (length(details) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_programs_updated_at
ON catalog_programs(updated_at DESC, id DESC);

INSERT OR IGNORE INTO catalog_programs (
  id, category, title, link, amount_krw, start_month, end_month,
  target, details, created_at, updated_at
) VALUES (
  'seed-kimst-sccei-2026',
  'business',
  '2026년 해양수산과학기술진흥원 x 서울창조경제혁신센터 해양수산분야 오픈이노베이션 사업',
  'https://scceioi.kr/2026/kimst/index.php#mEnter',
  30000000,
  6,
  7,
  '해양 분야 스타트업 중 대기업과의 협업을 원하는 기업',
  '실증을 위한 테스트 베드 지원, 오픈이노베이션 펀드를 통해 최종후속협력 스타트업에 투자 검토',
  '2026-08-05T00:00:00.000Z',
  '2026-08-05T00:00:00.000Z'
);
