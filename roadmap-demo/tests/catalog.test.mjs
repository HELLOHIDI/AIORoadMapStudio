import assert from "node:assert/strict";
import test from "node:test";
import { INDUSTRY_OPTIONS, REGION_OPTIONS } from "../catalog-options.js";
import { catalogPayload, copyCatalogProgram, parseCatalogText } from "../src/catalog.js";

test("normalizes a catalog form into the API payload", () => {
  assert.deepEqual(catalogPayload({
    category: "business",
    title: "  해양수산 사업  ",
    link: " https://example.test/notice ",
    amountKrw: "",
    startMonth: "6",
    endMonth: "7",
    target: " 스타트업 ",
    details: " 실증 지원 ",
    industries: ["해양", "해양", " 해양수산 "],
    regions: [" 서울 ", "부산"],
  }), {
    category: "business",
    title: "해양수산 사업",
    link: "https://example.test/notice",
    amountKrw: null,
    startMonth: 6,
    endMonth: 7,
    target: "스타트업",
    details: "실증 지원",
    industries: ["해양", "해양수산"],
    regions: ["서울", "부산"],
  });
});

test("parses the agreed support-program text format without saving it", () => {
  const parsed = parseCatalogText(`[사업화] 2026년 해양수산 오픈이노베이션 사업
- 링크: https://example.test/notice
- 지원기간: 6~7월
- 지원금액: 최대 3,000만원
- 지원대상: 해양 분야 스타트업
- 지원내용: 테스트 베드 지원
  후속 투자 검토`);

  assert.deepEqual(parsed, {
    values: {
      category: "business",
      title: "2026년 해양수산 오픈이노베이션 사업",
      link: "https://example.test/notice",
      startMonth: 6,
      endMonth: 7,
      amountKrw: 30_000_000,
      target: "해양 분야 스타트업",
      details: "테스트 베드 지원\n후속 투자 검토",
    },
    warnings: [],
  });
  assert.equal(parseCatalogText("[사업화] 테스트\n- 지원금액: 1.5억원").values.amountKrw, 150_000_000);
});

test("keeps incomplete source text in the source-correction path", () => {
  const parsed = parseCatalogText(`[사업화] 테스트 사업
- 링크: example.test
- 지원기간: 8~7월`);

  assert.equal(parsed.values.title, "테스트 사업");
  assert.deepEqual(parsed.warnings, [
    "링크에 http 또는 https 주소를 입력해 주세요.",
    "지원대상을 입력해 주세요.",
    "지원내용을 입력해 주세요.",
    "지원기간을 n~n월 형식으로 확인해 주세요.",
    "지원금액을 n백만원 또는 n억원 형식으로 입력해 주세요.",
  ]);
});

test("keeps the workbook tag lists complete and unique", () => {
  assert.equal(INDUSTRY_OPTIONS.length, 239);
  assert.equal(new Set(INDUSTRY_OPTIONS).size, 239);
  assert.ok(INDUSTRY_OPTIONS.includes("해양수산"));
  assert.equal(REGION_OPTIONS.length, 42);
  assert.equal(new Set(REGION_OPTIONS).size, 42);
  assert.ok(REGION_OPTIONS.includes("전국"));
});

test("copies a catalog master into an independent roadmap program", () => {
  const master = {
    id: "master-1",
    category: "business",
    title: "원본 사업",
    link: "https://example.test",
    amountKrw: 30_000_000,
    startMonth: 6,
    endMonth: 7,
    target: "스타트업",
    details: "실증 지원",
  };
  const copy = copyCatalogProgram(master, 4, () => "roadmap-copy-1");

  assert.equal(copy.id, "roadmap-copy-1");
  assert.notEqual(copy.id, master.id);
  assert.equal(copy.sequence, 4);
  copy.title = "클라이언트용 수정";
  assert.equal(master.title, "원본 사업");
});
