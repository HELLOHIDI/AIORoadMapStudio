import test from "node:test";
import assert from "node:assert/strict";
import { checkPdfRuntime, detectPdfRuntime } from "../src/pdf-runtime.js";

test("accepts Chromium browsers regardless of major version", () => {
  const chrome = { userAgent: "Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36" };
  const currentChrome = { userAgent: "Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36" };
  assert.deepEqual(detectPdfRuntime(chrome), { family: "Chromium", major: 150 });
  assert.equal(checkPdfRuntime(chrome).supported, true);
  assert.equal(checkPdfRuntime(currentChrome).supported, true);
  assert.equal(checkPdfRuntime({ userAgent: "Mozilla/5.0 Firefox/150.0" }).supported, false);
});

test("prefers Chromium userAgentData when it is available", () => {
  const navigatorLike = {
    userAgent: "Mozilla/5.0 Firefox/1.0",
    userAgentData: { brands: [{ brand: "Chromium", version: "151" }] },
  };
  assert.equal(checkPdfRuntime(navigatorLike).supported, true);
});
