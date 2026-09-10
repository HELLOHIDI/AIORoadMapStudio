import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedCategoriesForTier,
  buildRoadmapLayout,
  exchangeProgramWithLanePair,
  moveProgramToTargetLane,
  moveProgramToLane,
  MAX_LANES_PER_CATEGORY,
  PREMIUM_DEFAULT_LANE_COUNTS,
  PREMIUM_TOTAL_LANES,
  ROADMAP_CATEGORIES,
  resolveRoadmapLaneCounts,
  roadmapProgramLabel,
  shiftProgramByMonths,
  STANDARD_DEFAULT_LANE_COUNTS,
  transferRoadmapLane,
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
    laneCounts: { ...PREMIUM_DEFAULT_LANE_COUNTS },
    clientName: "  클라이언트   명  ",
    programs: [program("p1", 0, 13, { title: "  초기\n창업  패키지 ", amountKrw: 0 })],
  });

  assert.equal(document.clientName, "클라이언트 명");
  assert.equal(document.programs[0].title, "초기 창업 패키지");
  assert.deepEqual(new Set(errors.map(({ code }) => code)), new Set(["E_MONTH_RANGE", "E_AMOUNT_INVALID"]));
});

test("uses fixed category order and explicit tier defaults", () => {
  assert.deepEqual(ROADMAP_CATEGORIES.map(({ key, defaultLaneCount }) => [key, defaultLaneCount]), [
    ["consulting", 2], ["business", 4], ["voucher", 2], ["ip", 2], ["certification", 1],
  ]);
  assert.equal(MAX_LANES_PER_CATEGORY, 4);
  assert.equal(PREMIUM_TOTAL_LANES, 11);
  assert.deepEqual(PREMIUM_DEFAULT_LANE_COUNTS, { consulting: 2, business: 4, voucher: 2, ip: 2, certification: 1 });
  assert.deepEqual(STANDARD_DEFAULT_LANE_COUNTS, { consulting: 2, business: 4, voucher: 2, ip: 2 });
});

const premiumDocument = (programs, extra = {}) => ({
  tier: "premium",
  clientName: "ANP",
  laneCounts: { ...PREMIUM_DEFAULT_LANE_COUNTS },
  programs,
  ...extra,
});

test("validates and copies lane counts without defaulting malformed present values", () => {
  const counts = { consulting: 2, business: 4, voucher: 2, ip: 1, certification: 2 };
  const valid = resolveRoadmapLaneCounts({ tier: "premium", laneCounts: counts });
  assert.deepEqual(valid, { laneCounts: counts, errors: [] });
  assert.notEqual(valid.laneCounts, counts);

  for (const laneCounts of [null, [], "bad", { ...counts, extra: 1 }, { ...counts, ip: 0 }, { ...counts, ip: 1.5 }, { ...counts, ip: "1" }, { ...counts, certification: 1 }]) {
    const result = resolveRoadmapLaneCounts({ tier: "premium", laneCounts });
    assert.equal(result.laneCounts, null);
    assert.equal(result.errors.length, 1);
  }
  assert.equal(resolveRoadmapLaneCounts({ tier: "premium" }, { requireExplicit: true }).errors[0].code, "E_LANE_COUNTS_REQUIRED");
  assert.equal(resolveRoadmapLaneCounts({ tier: "standard", laneCounts: counts }).errors[0].code, "E_LANE_COUNTS_FORBIDDEN");
});

test("fails closed when an active Premium document omits lane counts", () => {
  const input = { tier: "premium", clientName: "ANP", programs: [] };
  const validated = validateRoadmapDocument(input);
  const layout = buildRoadmapLayout(input);

  assert.equal(validated.errors.some(({ code }) => code === "E_LANE_COUNTS_REQUIRED"), true);
  assert.equal(layout.errors.some(({ code }) => code === "E_LANE_COUNTS_REQUIRED"), true);
  assert.equal(layout.sections.flatMap(({ lanes }) => lanes).length, 0);
});

test("transfers a specific empty Premium lane atomically and normalizes explicit indexes", () => {
  const document = {
    tier: "premium",
    clientName: "ANP",
    laneCounts: { ...PREMIUM_DEFAULT_LANE_COUNTS },
    programs: [
      program("below", 1, 2, { category: "ip", laneIndex: 0 }),
      program("legacy", 3, 4, { category: "ip", laneIndex: 99 }),
      program("implicit", 5, 6, { category: "ip" }),
      program("certification", 1, 2, { category: "certification", laneIndex: 0 }),
    ],
  };
  const snapshot = structuredClone(document);
  const result = transferRoadmapLane({ document, sourceCategory: "ip", sourceLaneIndex: 1, targetCategory: "certification" });

  assert.equal(result.ok, true);
  assert.notEqual(result.document, document);
  assert.deepEqual(document, snapshot);
  assert.deepEqual(result.document.laneCounts, { consulting: 2, business: 4, voucher: 2, ip: 1, certification: 2 });
  assert.equal(result.document.programs.find(({ id }) => id === "below").laneIndex, 0);
  assert.equal(result.document.programs.find(({ id }) => id === "legacy").laneIndex, 0);
  assert.equal(Object.hasOwn(result.document.programs.find(({ id }) => id === "implicit"), "laneIndex"), false);
  const moved = moveProgramToLane({ document: result.document, programId: "certification", targetLaneIndex: 1 });
  assert.equal(moved.ok, true);
  assert.equal(moved.programs.find(({ id }) => id === "certification").laneIndex, 1);

  const negative = transferRoadmapLane({
    document: { ...document, programs: [program("negative", 1, 2, { category: "ip", laneIndex: -1 })] },
    sourceCategory: "ip",
    sourceLaneIndex: 1,
    targetCategory: "certification",
  });
  assert.equal(negative.ok, true);
  assert.equal(negative.document.programs[0].laneIndex, 0);
});

test("rejects an invalid source sequence atomically instead of repairing it", () => {
  const document = premiumDocument([program("invalid-sequence", 1, 2, { category: "ip", sequence: -1 })]);
  const snapshot = structuredClone(document);
  const result = transferRoadmapLane({ document, sourceCategory: "ip", sourceLaneIndex: 1, targetCategory: "certification" });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "E_LANE_TRANSFER_SOURCE_UNRESOLVED");
  assert.equal(result.document, document);
  assert.deepEqual(document, snapshot);
});

test("rejects a lane transfer when programs is not an array without mutation", () => {
  const document = { tier: "premium", clientName: "ANP", laneCounts: { ...PREMIUM_DEFAULT_LANE_COUNTS }, programs: null };
  const snapshot = structuredClone(document);
  const result = transferRoadmapLane({ document, sourceCategory: "ip", sourceLaneIndex: 1, targetCategory: "certification" });

  assert.deepEqual(result, { ok: false, document, reason: "E_LANE_TRANSFER_SOURCE_UNRESOLVED" });
  assert.deepEqual(document, snapshot);
});

test("rejects unsafe lane transfers without mutation", () => {
  const base = { tier: "premium", clientName: "ANP", laneCounts: { ...PREMIUM_DEFAULT_LANE_COUNTS }, programs: [] };
  const cases = [
    [{ tier: "premium", clientName: "ANP", programs: [] }, "ip", 1, "certification", "E_LANE_COUNTS_REQUIRED"],
    [{ ...base, laneCounts: undefined }, "ip", 1, "certification", "E_LANE_COUNTS_TYPE"],
    [base, "certification", 0, "ip", "E_LANE_TRANSFER_SOURCE_MINIMUM"],
    [base, "ip", 1, "business", "E_LANE_TRANSFER_TARGET_MAXIMUM"],
    [base, "ip", 1, "ip", "E_LANE_TRANSFER_SAME_CATEGORY"],
    [base, "ip", 2, "certification", "E_LANE_TRANSFER_SOURCE_INDEX"],
    [{ ...base, tier: "standard", laneCounts: undefined }, "ip", 1, "consulting", "E_LANE_TRANSFER_TIER"],
    [{ ...base, programs: [program("occupied", 1, 2, { category: "ip", laneIndex: 1 })] }, "ip", 1, "certification", "E_LANE_TRANSFER_SOURCE_OCCUPIED"],
    [{ ...base, programs: [program("implicit", 1, 2, { category: "ip" }), program("other", 1, 2, { category: "ip", laneIndex: 0 })] }, "ip", 1, "certification", "E_LANE_TRANSFER_SOURCE_OCCUPIED"],
  ];
  for (const [document, sourceCategory, sourceLaneIndex, targetCategory, reason] of cases) {
    const snapshot = structuredClone(document);
    const result = transferRoadmapLane({ document, sourceCategory, sourceLaneIndex, targetCategory });
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.document, document);
    assert.deepEqual(document, snapshot);
  }
});

test("keeps marketing as a business-lane display label", () => {
  const business = program("p1", 1, 1, { category: "business", title: "사업화 지원" });
  const marketing = program("p2", 2, 2, { category: "business", displayCategory: "marketing", title: "홍보 지원" });
  const layout = buildRoadmapLayout(premiumDocument([business, marketing]));
  const section = layout.sections.find(({ key }) => key === "business");

  assert.equal(roadmapProgramLabel(business), "사업화");
  assert.equal(roadmapProgramLabel(marketing), "마케팅");
  assert.equal(section.lanes.length, 4);
  assert.deepEqual(section.lanes.flat().map(({ id }) => id), ["p1", "p2"]);
  assert.equal(layout.errors.length, 0);

  const invalid = validateRoadmapDocument({
    laneCounts: { ...PREMIUM_DEFAULT_LANE_COUNTS },
    clientName: "ANP",
    programs: [program("p3", 1, 1, { category: "voucher", displayCategory: "marketing" })],
  });
  assert.equal(invalid.errors.some(({ code }) => code === "E_DISPLAY_CATEGORY_INVALID"), true);
});

test("normalizes missing roadmap tier to premium while requiring its lane counts", () => {
  const { document, errors } = validateRoadmapDocument({ clientName: "ANP", laneCounts: { ...PREMIUM_DEFAULT_LANE_COUNTS }, programs: [] });

  assert.equal(document.tier, "premium");
  assert.equal(Object.hasOwn(document, "clientProfile"), false);
  assert.deepEqual(errors, []);
});

test("normalizes optional client profile without changing lane assignments", () => {
  const { document, errors } = validateRoadmapDocument({
    laneCounts: { ...PREMIUM_DEFAULT_LANE_COUNTS },
    clientName: "ANP",
    clientProfile: {
      industries: [" AI ", "AI"],
      regions: [" Seoul\nMetro "],
      isWomenOwned: true,
      tenure: " prelaunch ",
    },
    programs: [program("p1", 1, 2, { laneIndex: 1 })],
  });

  assert.deepEqual(document.clientProfile, {
    industries: ["AI"],
    regions: ["Seoul Metro"],
    isWomenOwned: true,
    tenure: "prelaunch",
  });
  assert.equal(document.programs[0].laneIndex, 1);
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
  const premium = buildRoadmapLayout(premiumDocument([]));
  const standard = buildRoadmapLayout({ tier: "standard", clientName: "ANP", programs: [] });

  assert.equal(premium.sections.length, 5);
  assert.equal(premium.sections.flatMap((section) => section.lanes).length, 11);
  assert.equal(standard.sections.length, 4);
  assert.equal(standard.sections.flatMap((section) => section.lanes).length, 10);
});

test("rejects unsupported tiers and standard certification programs", () => {
  const unsupported = validateRoadmapDocument({ tier: "enterprise", clientName: "ANP", laneCounts: { ...PREMIUM_DEFAULT_LANE_COUNTS }, programs: [] });
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
  const input = premiumDocument([program("p3", 3, 4), program("p1", 1, 2), program("p2", 2, 3)]);
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
  const result = buildRoadmapLayout(premiumDocument([
      program("p1", 1, 2, { laneIndex: 1 }),
      program("p2", 1, 2),
      program("p3", 3, 4),
  ]));
  const rows = result.sections[0].lanes.map((lane) => lane.map(({ id, rowIndex }) => ({ id, rowIndex })));

  assert.deepEqual(rows, [
    [{ id: "p2", rowIndex: 0 }, { id: "p3", rowIndex: 0 }],
    [{ id: "p1", rowIndex: 1 }],
  ]);
});

test("blocks instead of creating rows above the category ceiling", () => {
  const result = buildRoadmapLayout(premiumDocument([program("p1", 1, 2), program("p2", 1, 2), program("p3", 1, 2)]));
  assert.equal(result.sections[0].lanes.length, 2);
  assert.equal(result.errors.at(-1).code, "E_ROW_CAPACITY");
  assert.equal(result.errors.at(-1).programId, "p3");
  assert.match(result.errors.at(-1).message, /“p3”.*배치되지 않았습니다/);
});

test("rejects duplicate ids, unknown categories, missing titles, and invalid sequence", () => {
  const { errors } = validateRoadmapDocument({
    laneCounts: { ...PREMIUM_DEFAULT_LANE_COUNTS },
    clientName: "ANP",
    programs: [program("p1", 1, 1), program("p1", 2, 2, { category: "other", title: "", sequence: -1 })],
  });
  assert.deepEqual(new Set(errors.map(({ code }) => code)), new Set([
    "E_PROGRAM_ID_DUPLICATE", "E_CATEGORY_UNKNOWN", "E_TITLE_REQUIRED", "E_SEQUENCE_INVALID",
  ]));
});

test("moves a program to an empty valid lane without mutating the input", () => {
  const programs = [program("p1", 1, 2), program("p2", 3, 4)];
  const result = moveProgramToLane({ document: premiumDocument(programs), programId: "p1", targetLaneIndex: 1 });

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

  const standardDocument = { tier: "standard", clientName: "ANP", programs };
  const moved = moveProgramToLane({ document: standardDocument, programId: "p1", targetLaneIndex: 1 });
  assert.equal(moved.ok, true);
  assert.equal(moved.programs.find((item) => item.id === "p1").laneIndex, 1);

  assert.deepEqual(
    moveProgramToLane({ document: standardDocument, programId: "cert-1", targetLaneIndex: 0 }),
    { ok: false, document: standardDocument, outcome: "rejected" },
  );
});

test("moves a valid program despite incomplete rows elsewhere in the document", () => {
  const programs = [
    program("p1", 1, 2, { title: "" }),
    program("p2", 3, 4, { category: "voucher", startMonth: 0 }),
  ];
  const result = moveProgramToLane({ document: premiumDocument(programs), programId: "p1", targetLaneIndex: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.programs.find((item) => item.id === "p1").laneIndex, 1);
});

test("swaps exactly one conflict when both resulting lanes stay valid", () => {
  const programs = [
    program("p1", 1, 2, { laneIndex: 0 }),
    program("p2", 1, 2, { laneIndex: 1 }),
  ];
  const result = moveProgramToLane({ document: premiumDocument(programs), programId: "p1", targetLaneIndex: 1 });

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

  const document = premiumDocument(programs);
  assert.deepEqual(moveProgramToLane({ document, programId: "p1", targetLaneIndex: 2 }), { ok: false, document, outcome: "rejected" });
  assert.deepEqual(moveProgramToLane({ document, programId: "p1", targetLaneIndex: 1 }), { ok: false, document, outcome: "rejected" });
});

test("rejects one-conflict swaps that create a second conflict in the source lane", () => {
  const programs = [
    program("p1", 1, 1, { laneIndex: 0 }),
    program("p2", 1, 2, { laneIndex: 1 }),
    program("p3", 2, 2, { laneIndex: 0 }),
  ];
  const document = premiumDocument(programs);
  const result = moveProgramToLane({ document, programId: "p1", targetLaneIndex: 1 });

  assert.deepEqual(result, { ok: false, document, outcome: "rejected" });
});

test("shifts a program one month while preserving its lane and duration", () => {
  const programs = [program("p1", 3, 4, { laneIndex: 1 }), program("p2", 6, 6, { laneIndex: 1 })];
  const result = shiftProgramByMonths({ document: premiumDocument(programs), programId: "p1", deltaMonths: -1 });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, "shifted");
  assert.deepEqual(result.programs.find((item) => item.id === "p1"), { ...programs[0], startMonth: 2, endMonth: 3, laneIndex: 1 });
  assert.equal(programs[0].startMonth, 3);
  const placed = buildRoadmapLayout(premiumDocument(result.programs)).sections[0].lanes[1][0];
  assert.deepEqual([placed.startOffset, placed.span, placed.rowIndex], [1, 2, 1]);
});

test("rejects horizontal shifts beyond bounds or into an occupied lane", () => {
  const boundary = [program("p1", 1, 2, { laneIndex: 0 })];
  const boundaryDocument = premiumDocument(boundary);
  assert.deepEqual(shiftProgramByMonths({ document: boundaryDocument, programId: "p1", deltaMonths: -1 }), { ok: false, document: boundaryDocument, outcome: "rejected" });
  const collision = [program("p1", 3, 4, { laneIndex: 0 }), program("p2", 2, 2, { laneIndex: 0 })];
  const collisionDocument = premiumDocument(collision);
  assert.deepEqual(shiftProgramByMonths({ document: collisionDocument, programId: "p1", deltaMonths: -1 }), { ok: false, document: collisionDocument, outcome: "rejected" });
  const malformed = [program("p1", 3, 4, { laneIndex: 0 }), program("p2", 4, 4, { laneIndex: 0 })];
  const malformedDocument = premiumDocument(malformed);
  assert.deepEqual(shiftProgramByMonths({ document: malformedDocument, programId: "p1", deltaMonths: 1 }), { ok: false, document: malformedDocument, outcome: "rejected" });
});

test("exchanges one program with two non-overlapping target-lane occupants", () => {
  const programs = [
    program("lower", 3, 4, { laneIndex: 1 }),
    program("left", 2, 2, { laneIndex: 0 }),
    program("right", 5, 5, { laneIndex: 0 }),
  ];
  const result = exchangeProgramWithLanePair({ document: premiumDocument(programs), programId: "lower", targetLaneIndex: 0 });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, "swapped-pair");
  assert.equal(result.programs.find((item) => item.id === "lower").laneIndex, 0);
  assert.equal(result.programs.find((item) => item.id === "left").laneIndex, 1);
  assert.equal(result.programs.find((item) => item.id === "right").laneIndex, 1);
  assert.deepEqual(result.programs.map(({ id, startMonth, endMonth }) => ({ id, startMonth, endMonth })), programs.map(({ id, startMonth, endMonth }) => ({ id, startMonth, endMonth })));
  assert.deepEqual(result.programs.map(({ startMonth, endMonth }) => [startMonth, endMonth]), [[3, 4], [2, 2], [5, 5]]);
});

test("exchanges one program with a lane pair when its source lane remains collision-free", () => {
  const programs = [
    program("deeptech", 2, 3, { category: "business", laneIndex: 3 }),
    program("source-rest", 5, 6, { category: "business", laneIndex: 3 }),
    program("support-1", 1, 2, { category: "business", laneIndex: 2 }),
    program("support-2", 3, 4, { category: "business", laneIndex: 2 }),
  ];
  const result = moveProgramToTargetLane({ document: premiumDocument(programs), programId: "deeptech", targetLaneIndex: 2 });

  assert.equal(result.ok, true);
  assert.equal(result.programs.find((item) => item.id === "deeptech").laneIndex, 2);
  assert.equal(result.programs.find((item) => item.id === "support-1").laneIndex, 3);
  assert.equal(result.programs.find((item) => item.id === "support-2").laneIndex, 3);
  assert.equal(result.programs.find((item) => item.id === "source-rest").laneIndex, 3);
  assert.deepEqual(result.programs.map(({ id, startMonth, endMonth }) => ({ id, startMonth, endMonth })), programs.map(({ id, startMonth, endMonth }) => ({ id, startMonth, endMonth })));
});

test("exchanges a dragged lane-pair member with the one target-lane program", () => {
  const programs = [
    program("left", 2, 2, { laneIndex: 0 }),
    program("right", 5, 5, { laneIndex: 0 }),
    program("lower", 3, 4, { laneIndex: 1 }),
  ];
  const result = moveProgramToTargetLane({ document: premiumDocument(programs), programId: "left", targetLaneIndex: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, "swapped-pair");
  assert.equal(result.programs.find((item) => item.id === "left").laneIndex, 1);
  assert.equal(result.programs.find((item) => item.id === "right").laneIndex, 1);
  assert.equal(result.programs.find((item) => item.id === "lower").laneIndex, 0);
  assert.deepEqual(result.programs.map(({ id, startMonth, endMonth }) => ({ id, startMonth, endMonth })), programs.map(({ id, startMonth, endMonth }) => ({ id, startMonth, endMonth })));
});

test("routes an invalid pair exchange through the existing lane move policy", () => {
  const programs = [
    program("lower", 3, 3, { laneIndex: 1 }),
    program("source-rest", 5, 5, { laneIndex: 1 }),
    program("conflict", 3, 3, { laneIndex: 0 }),
    program("other", 5, 5, { laneIndex: 0 }),
  ];
  const result = moveProgramToTargetLane({ document: premiumDocument(programs), programId: "lower", targetLaneIndex: 0 });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, "swapped");
  assert.equal(result.programs.find((item) => item.id === "lower").laneIndex, 0);
  assert.equal(result.programs.find((item) => item.id === "conflict").laneIndex, 1);
  assert.equal(result.programs.find((item) => item.id === "other").laneIndex, 0);
});
