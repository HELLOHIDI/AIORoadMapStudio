import assert from "node:assert/strict";
import test from "node:test";
import { formatAmount, formatRawAmount, parseRawAmount } from "../src/amount.js";

test("formats the agreed KRW display units", () => {
  assert.equal(formatAmount(null), "");
  assert.equal(formatAmount(300_000), "30만 원");
  assert.equal(formatAmount(780_000), "78만 원");
  assert.equal(formatAmount(123_456), "123,456원");
  assert.equal(formatAmount(10_000_000), "10백만 원");
  assert.equal(formatAmount(95_000_000), "95백만 원");
  assert.equal(formatAmount(99_600_000), "100백만 원");
  assert.equal(formatAmount(100_000_000), "1억원");
  assert.equal(formatAmount(105_000_000), "1.1억원");
  assert.equal(formatAmount(150_000_000), "1.5억원");
  assert.equal(formatAmount(1_234_000_000), "12.3억원");
});

test("rejects non-positive or unsafe amounts", () => {
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => formatAmount(value), RangeError);
  }
});

test("formats raw won input without changing the stored integer", () => {
  assert.equal(formatRawAmount(30_000_000), "30,000,000");
  assert.equal(formatRawAmount("30000000"), "30,000,000");
  assert.equal(formatRawAmount(""), "");
  assert.equal(parseRawAmount("30,000,000"), 30_000_000);
  assert.equal(parseRawAmount(""), null);
});
