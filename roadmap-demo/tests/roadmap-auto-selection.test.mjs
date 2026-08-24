import assert from "node:assert/strict";
import test from "node:test";
import { selectRoadmapPrograms } from "../src/roadmap-auto-selection.js";

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

test("matches industry and region by intersection while empty program tags stay eligible", () => {
  const result = selectRoadmapPrograms({
    client: { industries: ["AI"], regions: ["Busan"], tenureYears: 1 },
    programs: [
      program("matching", { regions: ["Seoul", "Busan"] }),
      program("empty-tags", { industries: [], regions: [] }),
      program("wrong-industry", { industries: ["Bio"], regions: ["Busan"] }),
      program("wrong-region", { regions: ["Daegu"] }),
    ],
  });

  assert.deepEqual(new Set(result.programs.map(({ id }) => id)), new Set(["matching", "empty-tags"]));
  assert.equal(result.categories.find(({ key }) => key === "business").eligibleCount, 2);
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

test("treats all-industries (모든 영역) programs as matching every client industry", () => {
  const result = selectRoadmapPrograms({
    client: { industries: ["바이오·헬스케어"], regions: ["Seoul"], tenureYears: 1 },
    programs: [
      program("all-industries", { industries: ["모든 영역"] }),
      program("matching-industry", { industries: ["바이오·헬스케어"] }),
      program("other-industry", { industries: ["AI·디지털"] }),
    ],
  });

  assert.deepEqual(
    new Set(result.programs.map(({ id }) => id)),
    new Set(["all-industries", "matching-industry"]),
  );
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

test("prioritizes the matching main package before amount and preserves months", () => {
  const result = selectRoadmapPrograms({
    client: { industries: ["AI"], regions: ["Seoul"], tenureYears: 2 },
    programs: [
      program("high-amount", { amountKrw: 50_000_000, startMonth: 8, endMonth: 9 }),
      program("main-package", { mainPackage: true, target: "창업 후 3년 미만 기업", amountKrw: 1_000_000, startMonth: 3, endMonth: 6 }),
      program("tenure-specific", { target: "창업 후 3년 미만 기업", amountKrw: 2_000_000, startMonth: 5, endMonth: 7 }),
    ],
  });

  assert.deepEqual(result.programs.map(({ id }) => id), ["main-package", "high-amount", "tenure-specific"]);
  assert.deepEqual(
    result.programs.map(({ id, startMonth, endMonth }) => [id, startMonth, endMonth]),
    [["main-package", 3, 6], ["high-amount", 8, 9], ["tenure-specific", 5, 7]],
  );
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
