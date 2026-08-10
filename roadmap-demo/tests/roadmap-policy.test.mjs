import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedCategoriesForTier,
  buildRoadmapLayout,
  moveProgramToLane,
  ROADMAP_CATEGORIES,
  validateRoadmapDocument,
} from "../src/roadmap-policy.js";

const program = (id, startMonth, endMonth, extra = {}) => ({
  id,
  category: "consulting",
  title: id,
  startMonth,
  endMonth,
  amountKrw: null,
  sequence: Number(id.replace(/\D/g, "")) || 0,
  ...extra,
});

test("normalizes text and reports invalid document fields", () => {
  const { document, errors } = validateRoadmapDocument({
    clientName: "  클라이언트   명  ",
    programs: [program("p1", 0, 13, { title: "  초기\n창업  패키지 ", amountKrw: 0 })],
  });

  assert.equal(document.clientName, "클라이언트 명");
  assert.equal(document.programs[0].title, "초기 창업 패키지");
  assert.deepEqual(new Set(errors.map(({ code }) => code)), new Set(["E_MONTH_RANGE", "E_AMOUNT_INVALID"]));
});

test("uses fixed category order and fixed row ceilings", () => {
  assert.deepEqual(ROADMAP_CATEGORIES.map(({ key, maxRows }) => [key, maxRows]), [
    ["consulting", 2], ["business", 4], ["voucher", 2], ["ip", 2], ["certification", 1],
  ]);
});

test("normalizes missing roadmap tier to premium", () => {
  const { document, errors } = validateRoadmapDocument({ clientName: "ANP", programs: [] });

  assert.equal(document.tier, "premium");
  assert.deepEqual(errors, []);
});

test("exposes premium and standard category subsets in canonical order", () => {
  assert.deepEqual(allowedCategoriesForTier("premium").map(({ key }) => key), [
    "consulting", "business", "voucher", "ip", "certification",
  ]);
  assert.deepEqual(allowedCategoriesForTier("standard").map(({ key }) => key), [
    "consulting", "business", "voucher", "ip",
  ]);
});

test("resolves premium and standard layout lane counts from tier", () => {
  const premium = buildRoadmapLayout({ tier: "premium", clientName: "ANP", programs: [] });
  const standard = buildRoadmapLayout({ tier: "standard", clientName: "ANP", programs: [] });

  assert.equal(premium.sections.length, 5);
  assert.equal(premium.sections.flatMap((section) => section.lanes).length, 11);
  assert.equal(standard.sections.length, 4);
  assert.equal(standard.sections.flatMap((section) => section.lanes).length, 10);
});

test("rejects unsupported tiers and standard certification programs", () => {
  const unsupported = validateRoadmapDocument({ tier: "enterprise", clientName: "ANP", programs: [] });
  assert.deepEqual(unsupported.errors.map(({ code }) => code), ["E_TIER_UNSUPPORTED"]);

  const standard = buildRoadmapLayout({
    tier: "standard",
    clientName: "ANP",
    programs: [program("cert-1", 1, 1, { category: "certification" })],
  });
  assert.deepEqual(standard.sections.map(({ key }) => key), ["consulting", "business", "voucher", "ip"]);
  assert.equal(standard.errors.some(({ code, programId }) => code === "E_CATEGORY_FORBIDDEN_FOR_TIER" && programId === "cert-1"), true);
  assert.equal(standard.sections.some((section) => section.lanes.flat().some((item) => item.id === "cert-1")), false);
});

test("places inclusive month ranges with deterministic first-fit", () => {
  const input = { clientName: "ANP", programs: [program("p3", 3, 4), program("p1", 1, 2), program("p2", 2, 3)] };
  const first = buildRoadmapLayout(input);
  const second = buildRoadmapLayout({ ...input, programs: [...input.programs].reverse() });
  const rows = (result) => result.sections[0].lanes.map((lane) => lane.map(({ id, rowIndex, startOffset, span }) => ({ id, rowIndex, startOffset, span })));

  assert.deepEqual(rows(first), rows(second));
  assert.deepEqual(rows(first), [
    [{ id: "p1", rowIndex: 0, startOffset: 0, span: 2 }, { id: "p3", rowIndex: 0, startOffset: 2, span: 2 }],
    [{ id: "p2", rowIndex: 1, startOffset: 1, span: 2 }],
  ]);
});

test("keeps valid explicit lanes and first-fits unassigned programs", () => {
  const result = buildRoadmapLayout({
    clientName: "ANP",
    programs: [
      program("p1", 1, 2, { laneIndex: 1 }),
      program("p2", 1, 2),
      program("p3", 3, 4),
    ],
  });
  const rows = result.sections[0].lanes.map((lane) => lane.map(({ id, rowIndex }) => ({ id, rowIndex })));

  assert.deepEqual(rows, [
    [{ id: "p2", rowIndex: 0 }, { id: "p3", rowIndex: 0 }],
    [{ id: "p1", rowIndex: 1 }],
  ]);
});

test("blocks instead of creating rows above the category ceiling", () => {
  const result = buildRoadmapLayout({ clientName: "ANP", programs: [program("p1", 1, 2), program("p2", 1, 2), program("p3", 1, 2)] });
  assert.equal(result.sections[0].lanes.length, 2);
  assert.equal(result.errors.at(-1).code, "E_ROW_CAPACITY");
  assert.equal(result.errors.at(-1).programId, "p3");
});

test("rejects duplicate ids, unknown categories, missing titles, and invalid sequence", () => {
  const { errors } = validateRoadmapDocument({
    clientName: "ANP",
    programs: [program("p1", 1, 1), program("p1", 2, 2, { category: "other", title: "", sequence: -1 })],
  });
  assert.deepEqual(new Set(errors.map(({ code }) => code)), new Set([
    "E_PROGRAM_ID_DUPLICATE", "E_CATEGORY_UNKNOWN", "E_TITLE_REQUIRED", "E_SEQUENCE_INVALID",
  ]));
});

test("moves a program to an empty valid lane without mutating the input", () => {
  const programs = [program("p1", 1, 2), program("p2", 3, 4)];
  const result = moveProgramToLane({ programs, programId: "p1", targetLaneIndex: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, "moved");
  assert.notEqual(result.programs, programs);
  assert.equal(programs[0].laneIndex, undefined);
  assert.equal(result.programs.find((item) => item.id === "p1").laneIndex, 1);
});

test("moves standard programs inside allowed categories only", () => {
  const programs = [
    program("p1", 1, 2, { category: "business" }),
    program("p2", 3, 4, { category: "business" }),
    program("cert-1", 1, 1, { category: "certification" }),
  ];

  const moved = moveProgramToLane({ tier: "standard", programs, programId: "p1", targetLaneIndex: 1 });
  assert.equal(moved.ok, true);
  assert.equal(moved.programs.find((item) => item.id === "p1").laneIndex, 1);

  assert.deepEqual(
    moveProgramToLane({ tier: "standard", programs, programId: "cert-1", targetLaneIndex: 0 }),
    { ok: false, programs, outcome: "rejected" },
  );
});

test("moves a valid program despite incomplete rows elsewhere in the document", () => {
  const programs = [
    program("p1", 1, 2, { title: "" }),
    program("p2", 3, 4, { category: "voucher", startMonth: 0 }),
  ];
  const result = moveProgramToLane({ programs, programId: "p1", targetLaneIndex: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.programs.find((item) => item.id === "p1").laneIndex, 1);
});

test("swaps exactly one conflict when both resulting lanes stay valid", () => {
  const programs = [
    program("p1", 1, 2, { laneIndex: 0 }),
    program("p2", 1, 2, { laneIndex: 1 }),
  ];
  const result = moveProgramToLane({ programs, programId: "p1", targetLaneIndex: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, "swapped");
  assert.equal(result.programs.find((item) => item.id === "p1").laneIndex, 1);
  assert.equal(result.programs.find((item) => item.id === "p2").laneIndex, 0);
});

test("rejects invalid lanes and multiple conflicts without mutation", () => {
  const programs = [
    program("p1", 1, 2, { laneIndex: 0 }),
    program("p2", 1, 1, { laneIndex: 1 }),
    program("p3", 2, 2, { laneIndex: 1 }),
  ];

  assert.deepEqual(moveProgramToLane({ programs, programId: "p1", targetLaneIndex: 2 }), { ok: false, programs, outcome: "rejected" });
  assert.deepEqual(moveProgramToLane({ programs, programId: "p1", targetLaneIndex: 1 }), { ok: false, programs, outcome: "rejected" });
});

test("rejects one-conflict swaps that create a second conflict in the source lane", () => {
  const programs = [
    program("p1", 1, 1, { laneIndex: 0 }),
    program("p2", 1, 2, { laneIndex: 1 }),
    program("p3", 2, 2, { laneIndex: 0 }),
  ];
  const result = moveProgramToLane({ programs, programId: "p1", targetLaneIndex: 1 });

  assert.deepEqual(result, { ok: false, programs, outcome: "rejected" });
});
