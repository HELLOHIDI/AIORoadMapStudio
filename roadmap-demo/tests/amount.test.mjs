import assert from "node:assert/strict";
import test from "node:test";
import { formatAmount } from "../src/amount.js";

test("formats the agreed KRW display units", () => {
  assert.equal(formatAmount(null), "");
  assert.equal(formatAmount(10_000_000), "10백만 원");
  assert.equal(formatAmount(95_000_000), "95백만 원");
  assert.equal(formatAmount(99_600_000), "100백만 원");
  assert.equal(formatAmount(100_000_000), "1억원");
  assert.equal(formatAmount(105_000_000), "1.1억원");
  assert.equal(formatAmount(150_000_000), "1.5억원");
  assert.equal(formatAmount(1_234_000_000), "12.3억원");
});

test("rejects amounts the PDF policy cannot display", () => {
  for (const value of [0, -1, 999_999, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => formatAmount(value), RangeError);
  }
});
