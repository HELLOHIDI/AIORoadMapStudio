import assert from "node:assert/strict";
import test from "node:test";
import { selectRoadmapPrograms as selectPrograms } from "../src/roadmap-auto-selection.js";
import { PREMIUM_DEFAULT_LANE_COUNTS, STANDARD_DEFAULT_LANE_COUNTS } from "../src/roadmap-policy.js";

const selectRoadmapPrograms = (options = {}) => selectPrograms({
  ...options,
  laneCounts: options.laneCounts ?? (options.tier === "standard" ? STANDARD_DEFAULT_LANE_COUNTS : PREMIUM_DEFAULT_LANE_COUNTS),
});

test("requires explicit lane counts for draft selection", () => {
  assert.throws(() => selectPrograms(), (error) => error instanceof TypeError
    && error.name === "RoadmapLaneCountsTypeError"
    && /Invalid laneCounts/.test(error.message));
});

test("rejects malformed lane counts at the selector boundary", () => {
  for (const options of [
    { tier: "premium", laneCounts: { consulting: 2, business: 4, voucher: 2, ip: 1, certification: 1 } },
    { tier: "premium", laneCounts: { consulting: 2, business: 4, voucher: 2, ip: 1.5, certification: 1.5 } },
    { tier: "standard", laneCounts: { consulting: 2, business: 4, voucher: 2, ip: 1 } },
    { tier: "standard", laneCounts: { consulting: 2, business: 4, voucher: 2, ip: 2, certification: 1 } },
  ]) {
    assert.throws(() => selectPrograms(options), (error) => error instanceof TypeError
      && error.name === "RoadmapLaneCountsTypeError");
  }
});

const program = (id, extra = {}) => ({
  id,
  category: "business",
  title: id,
  amountKrw: 1_000_000,
  startMonth: 1,
  endMonth: 2,
  target: "general SME",
  industries: ["AI"],
  regions: ["Seoul"],
  mainPackage: false,
  ...extra,
});

test("uses representative transferred Premium counts for selector capacity", () => {
  const result = selectRoadmapPrograms({
    laneCounts: { consulting: 2, business: 4, voucher: 2, ip: 1, certification: 2 },
    client: { industries: ["AI"], regions: ["Seoul"], tenureYears: 1 },
    programs: [program("ip-1", { category: "ip" }), program("ip-2", { category: "ip" })],
  });

  assert.equal(result.categories.find(({ key }) => key === "ip").placedCount, 1);
  assert.equal(result.programs.filter(({ category }) => category === "ip").length, 1);
});

test("scores exact tag intersections above mismatches without discarding lower-score candidates", () => {
  const result = selectRoadmapPrograms({
    client: { industries: ["AI"], regions: ["Busan"], tenureYears: 1 },
    programs: [
      program("matching", { regions: ["Seoul", "Busan"] }),
      program("empty-tags", { industries: [], regions: [] }),
      program("wrong-industry", { industries: ["Bio"], regions: ["Busan"] }),
      program("wrong-region", { regions: ["Daegu"] }),
    ],
  });

  assert.deepEqual(result.recommendations.map(({ id }) => id), ["matching", "wrong-region", "wrong-industry", "empty-tags"]);
  assert.equal(result.recommendations[0].matchScore, 70);
  assert.deepEqual(result.recommendations[0].matchReasons, ["업종 정확 일치 +40", "지역 정확 일치 +30"]);
  assert.equal(result.categories.find(({ key }) => key === "business").eligibleCount, 4);
});

test("treats nationwide (전국) programs as matching every client region", () => {
  const result = selectRoadmapPrograms({
    client: { industries: ["AI"], regions: ["충남", "당진"], tenureYears: 1 },
    programs: [
      program("nationwide-voucher", { category: "voucher", regions: ["전국"] }),
      program("regional-voucher", { category: "voucher", regions: ["충남"] }),
      program("other-region-voucher", { category: "voucher", regions: ["부산"] }),
    ],
  });

  assert.deepEqual(
    new Set(result.programs.map(({ id }) => id)),
    new Set(["nationwide-voucher", "regional-voucher"]),
  );
});

test("scores all-industries (모든 영역) above an unrelated industry", () => {
  const result = selectRoadmapPrograms({
    client: { industries: ["바이오·헬스케어"], regions: ["Seoul"], tenureYears: 1 },
    programs: [
      program("all-industries", { industries: ["모든 영역"] }),
      program("matching-industry", { industries: ["바이오·헬스케어"] }),
      program("other-industry", { industries: ["AI·디지털"] }),
    ],
  });

  assert.deepEqual(result.programs.map(({ id }) => id), ["matching-industry", "all-industries", "other-industry"]);
  assert.deepEqual(result.recommendations.map(({ id, matchScore }) => [id, matchScore]), [
    ["matching-industry", 70],
    ["all-industries", 40],
    ["other-industry", 30],
  ]);
});

test("ranks exact matches above partial and full wildcard matches regardless of amount", () => {
  const result = selectRoadmapPrograms({
    client: { industries: ["AI·디지털"], regions: ["충남"], tenureYears: 1 },
    programs: [
      program("full-wildcard", { industries: ["모든 영역"], regions: ["전국"], amountKrw: 90_000_000 }),
      program("partial-wildcard", { industries: ["AI·디지털"], regions: ["전국"], amountKrw: 50_000_000 }),
      program("exact", { industries: ["AI·디지털"], regions: ["충남"], amountKrw: 1_000_000 }),
      program("exact-bigger", { industries: ["AI·디지털"], regions: ["충남"], amountKrw: 2_000_000 }),
    ],
  });

  assert.deepEqual(
    result.programs.map(({ id }) => id),
    ["exact-bigger", "exact", "partial-wildcard", "full-wildcard"],
  );
});

test("uses main package as score instead of overriding a stronger exact match", () => {
  const result = selectRoadmapPrograms({
    client: { industries: ["AI·디지털"], regions: ["충남"], tenureYears: 1 },
    programs: [
      program("exact", { industries: ["AI·디지털"], regions: ["충남"], amountKrw: 90_000_000 }),
      program("main-package-wildcard", { mainPackage: true, target: "창업 후 3년 미만 기업", industries: ["모든 영역"], regions: ["전국"], amountKrw: 1_000_000 }),
    ],
  });

  assert.deepEqual(result.programs.map(({ id }) => id), ["exact", "main-package-wildcard"]);
  assert.deepEqual(result.recommendations.map(({ id, matchScore }) => [id, matchScore]), [
    ["exact", 70],
    ["main-package-wildcard", 60],
  ]);
});

test("excludes clearly women-only targets for non-women clients but keeps women-preferred programs", () => {
  const programs = [
    program("women-only", { target: "women-only founders", amountKrw: 3_000_000 }),
    program("women-preferred", { target: "women-preferred exporters", amountKrw: 2_000_000 }),
    program("general", { target: "women eligible inclusive program", amountKrw: 1_000_000 }),
  ];

  const nonWomen = selectRoadmapPrograms({ client: { industries: ["AI"], regions: ["Seoul"], isWomenOwned: false }, programs });
  const women = selectRoadmapPrograms({ client: { industries: ["AI"], regions: ["Seoul"], isWomenOwned: true }, programs });

  assert.deepEqual(nonWomen.programs.map(({ id }) => id), ["women-preferred", "general"]);
  assert.deepEqual(women.programs.map(({ id }) => id), ["women-only", "women-preferred", "general"]);
});

test("infers tenure from target text and falls back to inclusive when it cannot infer", () => {
  const result = selectRoadmapPrograms({
    client: { industries: ["AI"], regions: ["Seoul"], tenureYears: 5 },
    programs: [
      program("under-three", { target: "창업 후 3년 미만 기업" }),
      program("over-three", { target: "창업 후 3년 이상 기업" }),
      program("unknown-tenure", { target: "growth stage companies" }),
    ],
  });

  assert.deepEqual(result.programs.map(({ id }) => id), ["over-three", "unknown-tenure"]);
});

test("orders by total score before amount and preserves months", () => {
  const result = selectRoadmapPrograms({
    client: { industries: ["AI"], regions: ["Seoul"], tenureYears: 2 },
    programs: [
      program("high-amount", { amountKrw: 50_000_000, startMonth: 8, endMonth: 9 }),
      program("main-package", { mainPackage: true, target: "창업 후 3년 미만 기업", amountKrw: 1_000_000, startMonth: 3, endMonth: 6 }),
      program("tenure-specific", { target: "창업 후 3년 미만 기업", amountKrw: 2_000_000, startMonth: 5, endMonth: 7 }),
    ],
  });

  assert.deepEqual(result.programs.map(({ id }) => id), ["main-package", "tenure-specific", "high-amount"]);
  assert.deepEqual(
    result.programs.map(({ id, startMonth, endMonth }) => [id, startMonth, endMonth]),
    [["main-package", 3, 6], ["tenure-specific", 5, 7], ["high-amount", 8, 9]],
  );
});

test("scores a client locality against its parent province", () => {
  const result = selectRoadmapPrograms({
    client: { industries: ["AI"], regions: ["부산진"], tenureYears: 1 },
    programs: [
      program("province", { regions: ["부산"] }),
      program("nationwide", { regions: ["전국"] }),
      program("other", { regions: ["서울"] }),
    ],
  });

  assert.deepEqual(result.recommendations.map(({ id, matchScore }) => [id, matchScore]), [
    ["province", 60],
    ["nationwide", 55],
    ["other", 40],
  ]);
  assert.ok(result.recommendations[0].matchReasons.includes("상위 시·도 일치 +20"));
});

test("recommends up to 35 scored candidates with business and voucher minimums, IP cap, and no certification", () => {
  const programs = [
    ...Array.from({ length: 25 }, (_, index) => program(`business-${String(index).padStart(2, "0")}`, { amountKrw: 25_000_000 - index })),
    ...Array.from({ length: 12 }, (_, index) => program(`voucher-${String(index).padStart(2, "0")}`, { category: "voucher", amountKrw: 12_000_000 - index })),
    ...Array.from({ length: 8 }, (_, index) => program(`ip-${String(index).padStart(2, "0")}`, { category: "ip", amountKrw: 8_000_000 - index })),
    ...Array.from({ length: 3 }, (_, index) => program(`cert-${index}`, { category: "certification" })),
  ];
  const result = selectRoadmapPrograms({
    client: { industries: ["AI"], regions: ["Seoul"], tenureYears: 1 },
    programs,
  });
  const counts = result.recommendations.reduce((current, item) => ({
    ...current,
    [item.category]: (current[item.category] ?? 0) + 1,
  }), {});

  assert.equal(result.recommendations.length, 35);
  assert.equal(counts.business, 20);
  assert.equal(counts.voucher, 10);
  assert.equal(counts.ip, 5);
  assert.equal(counts.certification, undefined);
  assert.ok(result.recommendations.every((item, index, items) => index === 0 || items[index - 1].matchScore >= item.matchScore));
  assert.deepEqual(result.programs.reduce((current, item) => ({
    ...current,
    [item.category]: (current[item.category] ?? 0) + 1,
  }), {}), { business: 4, voucher: 2, ip: 2 });
});

test("fills unused IP capacity with additional business or voucher candidates", () => {
  const result = selectRoadmapPrograms({
    client: { industries: ["AI"], regions: ["Seoul"], tenureYears: 1 },
    programs: [
      ...Array.from({ length: 30 }, (_, index) => program(`business-${index}`)),
      ...Array.from({ length: 12 }, (_, index) => program(`voucher-${index}`, { category: "voucher" })),
      program("only-ip", { category: "ip" }),
    ],
  });
  const counts = result.recommendations.reduce((current, item) => ({
    ...current,
    [item.category]: (current[item.category] ?? 0) + 1,
  }), {});

  assert.equal(result.recommendations.length, 35);
  assert.equal(counts.ip, 1);
  assert.ok(counts.business >= 20);
  assert.ok(counts.voucher >= 10);
});

test("applies category caps and deterministic amount, id, title tie-breaks", () => {
  const result = selectRoadmapPrograms({
    client: { industries: ["AI"], regions: ["Seoul"], tenureYears: 1 },
    programs: [
      program("d", { amountKrw: 2_000_000, title: "Zulu" }),
      program("b", { amountKrw: 3_000_000, title: "Beta" }),
      program("a", { amountKrw: 3_000_000, title: "Alpha" }),
      program("c", { amountKrw: 2_000_000, title: "Alpha" }),
      program("e", { amountKrw: 1_000_000, title: "Echo" }),
    ],
  });
  const business = result.categories.find(({ key }) => key === "business");

  assert.deepEqual(result.programs.map(({ id }) => id), ["a", "b", "c", "d"]);
  assert.equal(business.eligibleCount, 5);
  assert.equal(business.placedCount, 4);
});

test("uses standard tier category caps without placing premium-only categories", () => {
  const result = selectRoadmapPrograms({
    tier: "standard",
    client: { industries: ["AI"], regions: ["Seoul"], tenureYears: 1 },
    programs: [
      program("business"),
      program("cert", { category: "certification" }),
    ],
  });

  assert.deepEqual(result.categories.map(({ key }) => key), ["consulting", "business", "voucher", "ip"]);
  assert.deepEqual(result.programs.map(({ id }) => id), ["business"]);
});

test("reserves category rows for generated roadmap summary programs", () => {
  const result = selectRoadmapPrograms({
    client: { industries: ["AI"], regions: ["Seoul"], tenureYears: 1 },
    reservedRowsByCategory: { consulting: 1 },
    programs: [
      program("consulting-a", { category: "consulting" }),
      program("consulting-b", { category: "consulting", amountKrw: 2_000_000 }),
    ],
  });

  const consulting = result.categories.find(({ key }) => key === "consulting");
  assert.equal(consulting.eligibleCount, 2);
  assert.equal(consulting.placedCount, 1);
  assert.deepEqual(result.programs.map(({ id }) => id), ["consulting-b"]);
});
