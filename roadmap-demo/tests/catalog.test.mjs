import assert from "node:assert/strict";
import test from "node:test";
import {
  BUSINESS_SUBCATEGORY_OPTIONS,
  INDUSTRY_OPTIONS,
  NON_INDUSTRY_OPTIONS,
  REGION_OPTIONS,
  inferBusinessSubcategories,
} from "../catalog-options.js";
import { ADMINISTRATIVE_REGION_GROUPS, groupAdministrativeRegionOptions, inferIndustries, inferRegions } from "../catalog-tag-policy.js";
import { CATALOG_CATEGORIES, catalogPayload, copyCatalogProgram, formatCatalogBulletText, parseCatalogText } from "../src/catalog.js";

test("keeps consulting out of the shared catalog categories", () => {
  assert.deepEqual(CATALOG_CATEGORIES.map(({ key }) => key), ["business", "voucher", "ip", "certification"]);
  const parsed = parseCatalogText(`[컨설팅] 직접 작성 항목
- 링크: https://example.test/notice
- 지원기간: 6~7월
- 지원금액: 3백만원
- 지원대상: 스타트업
- 지원내용: 자문`);
  assert.equal(parsed.values.category, undefined);
  assert.ok(parsed.warnings.includes("구분 “컨설팅”을 확인해 주세요."));
});

test("breaks catalog targets and details at spaced bullet hyphens", () => {
  assert.equal(
    formatCatalogBulletText("통합 지원 - 진단 및 컨설팅 - 시제품 제작"),
    "통합 지원\n- 진단 및 컨설팅\n- 시제품 제작",
  );
  assert.equal(
    formatCatalogBulletText("- 첫 번째 항목\n - 두 번째 항목"),
    "- 첫 번째 항목\n- 두 번째 항목",
  );
  assert.equal(formatCatalogBulletText("온-오프라인 및 6-7월"), "온-오프라인 및 6-7월");
});

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
    mainPackage: false,
  });
});

test("classifies business subcategories independently in display order", () => {
  assert.deepEqual(inferBusinessSubcategories({
    category: "business",
    title: "미국 진출 데모데이 마케팅 사업",
    details: "수출 컨설팅을 함께 지원",
    mainPackage: true,
  }), BUSINESS_SUBCATEGORY_OPTIONS);
  assert.deepEqual(
    inferBusinessSubcategories({ category: "business", title: "대한민국 창업 지원", details: "국내 판로 지원" }),
    [],
  );
  assert.deepEqual(
    inferBusinessSubcategories({ category: "voucher", title: "일본 수출 공모전", details: "마케팅 컨설팅" }),
    [],
  );
  for (const title of ["창업 경진대회", "창업 공모전", "창업 콘테스트", "창업 데모데이", "창업 피칭대회"]) {
    assert.deepEqual(inferBusinessSubcategories({ category: "business", title, details: "" }), ["경진대회"]);
  }
  assert.deepEqual(
    inferBusinessSubcategories({ category: "business", title: "일반 사업", details: "데모데이 참가 지원" }),
    [],
  );
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
  assert.equal(parseCatalogText("[사업화] 테스트\n- 지원금액: 30만원").values.amountKrw, 300_000);
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
    "지원기간을 MM~MM 형식으로 확인해 주세요.",
    "지원금액을 n만원, n백만원 또는 n억원 형식으로 입력해 주세요.",
  ]);
});

test("keeps the upper-industry tag list compact and unique", () => {
  assert.equal(INDUSTRY_OPTIONS.length, 12);
  assert.equal(new Set(INDUSTRY_OPTIONS).size, INDUSTRY_OPTIONS.length);
  assert.ok(INDUSTRY_OPTIONS.includes("농림·수산·해양"));
  for (const tag of NON_INDUSTRY_OPTIONS) assert.equal(INDUSTRY_OPTIONS.includes(tag), false);
  assert.equal(REGION_OPTIONS.length, 42);
  assert.equal(new Set(REGION_OPTIONS).size, 42);
  assert.ok(REGION_OPTIONS.includes("전국"));
});

test("classifies support programs into one upper-industry tag", () => {
  const industries = inferIndustries({
    title: "2026년 AI 영상분석 시스템 사업화 지원",
    target: "정보통신 소프트웨어 중소기업",
    details: "기술 고도화와 마케팅 비용 지원",
    industries: ["기술", "마케팅"],
  });
  assert.equal(industries.length, 1);
  assert.ok(industries.includes("AI·디지털"));
  assert.equal(industries.some((tag) => NON_INDUSTRY_OPTIONS.includes(tag)), false);
});

test("adds unregistered city and county tags from the title and eligibility", () => {
  assert.deepEqual(
    inferRegions({ title: "[충남] 부여군 2026년 기업지원사업", target: "부여군 소재 기업", regions: ["충남"] }),
    ["충남", "부여"],
  );
  assert.deepEqual(
    inferRegions({ title: "2026년 김해시 기업지원사업", target: "김해시 소재 기업", regions: ["전국"] }),
    ["경남", "김해"],
  );
  assert.deepEqual(
    inferRegions({ title: "[전남광주] 통합 지원사업", target: "전남 또는 광주 소재 기업", regions: ["전국"] }),
    ["광주", "전남"],
  );
  assert.deepEqual(
    inferRegions({ title: "[광주] 동구 기업지원사업", target: "광주광역시 동구 소재 기업", regions: ["광주"] }),
    ["광주", "광주 동구"],
  );
});

test("groups region filters under the 17 first-level administrative divisions", () => {
  assert.equal(ADMINISTRATIVE_REGION_GROUPS.length, 17);
  assert.deepEqual(ADMINISTRATIVE_REGION_GROUPS.map(({ key }) => key), [
    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기",
    "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
  ]);
  const grouped = groupAdministrativeRegionOptions([
    "전국", "경기", "경기 광주", "충남", "부여", "경남", "김해", "호남", "서해",
  ]);
  assert.equal(grouped.nationwide, true);
  assert.deepEqual(grouped.groups.find(({ key }) => key === "경기")?.options, ["경기", "경기 광주"]);
  assert.deepEqual(grouped.groups.find(({ key }) => key === "충남")?.options, ["충남", "부여"]);
  assert.deepEqual(grouped.groups.find(({ key }) => key === "경남")?.options, ["경남", "김해"]);
  assert.deepEqual(grouped.ungrouped, ["호남", "서해"]);
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
  assert.equal("supportYear" in copy, false);
  copy.title = "클라이언트용 수정";
  assert.equal(master.title, "원본 사업");
});
