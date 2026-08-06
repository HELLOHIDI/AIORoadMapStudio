import assert from "node:assert/strict";
import test from "node:test";
import { buildRoadmapLayout, ROADMAP_CATEGORIES, validateRoadmapDocument } from "../src/roadmap-policy.js";

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
