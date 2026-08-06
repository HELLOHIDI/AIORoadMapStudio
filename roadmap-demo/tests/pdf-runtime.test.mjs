import test from "node:test";
import assert from "node:assert/strict";
import { checkPdfRuntime, detectPdfRuntime, PDF_RUNTIME } from "../src/pdf-runtime.js";

test("accepts only the pinned Chromium major", () => {
  const chrome = { userAgent: `Mozilla/5.0 Chrome/${PDF_RUNTIME.major}.0.0.0 Safari/537.36` };
  const previous = { userAgent: `Mozilla/5.0 Chrome/${PDF_RUNTIME.major - 1}.0.0.0 Safari/537.36` };
  assert.deepEqual(detectPdfRuntime(chrome), { family: "Chromium", major: PDF_RUNTIME.major });
  assert.equal(checkPdfRuntime(chrome).supported, true);
  assert.equal(checkPdfRuntime(previous).supported, false);
  assert.equal(checkPdfRuntime({ userAgent: "Mozilla/5.0 Firefox/150.0" }).supported, false);
});

test("prefers Chromium userAgentData when it is available", () => {
  const navigatorLike = {
    userAgent: "Mozilla/5.0 Firefox/1.0",
    userAgentData: { brands: [{ brand: "Chromium", version: String(PDF_RUNTIME.major) }] },
  };
  assert.equal(checkPdfRuntime(navigatorLike).supported, true);
});
