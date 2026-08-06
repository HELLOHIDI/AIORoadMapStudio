import test from "node:test";
import assert from "node:assert/strict";
import { inspectRoadmapGeometry, runPdfPreflight } from "../src/pdf-preflight.js";
import { PDF_RUNTIME } from "../src/pdf-runtime.js";

const sheetRect = { left: 0, right: 297 / 25.4 * 96, top: 0, bottom: 210 / 25.4 * 96 };
const validDocument = {
  clientName: "클라이언트명",
  programs: [{ id: "one", category: "consulting", title: "지원사업", startMonth: 1, endMonth: 2, amountKrw: null, sequence: 0 }],
};

function fakeRoot({ fontReady = true, logoReady = true, labelRect } = {}) {
  const copy = { left: 100, right: 180, top: 100, bottom: 110 };
  const bar = { left: 100, right: 200, top: 112, bottom: 120 };
  const event = {
    dataset: { programId: "one" },
    querySelector: (selector) => {
      if (selector.endsWith("> span")) return { getBoundingClientRect: () => labelRect ?? copy };
      if (selector.endsWith("> sup")) return null;
      return { getBoundingClientRect: () => bar };
    },
  };
  const lane = { querySelectorAll: () => [event] };
  const sheet = {
    clientWidth: Math.round(sheetRect.right),
    clientHeight: Math.round(sheetRect.bottom),
    scrollWidth: Math.round(sheetRect.right),
    scrollHeight: Math.round(sheetRect.bottom),
    getBoundingClientRect: () => sheetRect,
  };
  const logo = { complete: logoReady, naturalWidth: logoReady ? 200 : 0 };
  return {
    fonts: { ready: Promise.resolve(), check: () => fontReady },
    defaultView: { requestAnimationFrame: (callback) => callback() },
    querySelector: (selector) => selector === ".brand-logo" ? logo : sheet,
    querySelectorAll: () => [lane],
  };
}

const supportedNavigator = { userAgent: `Mozilla/5.0 Chrome/${PDF_RUNTIME.major}.0.0.0 Safari/537.36` };

test("passes a valid document only in the pinned PDF runtime", async () => {
  const result = await runPdfPreflight({ roadmapDocument: validDocument, root: fakeRoot(), navigatorLike: supportedNavigator });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);

  const blocked = await runPdfPreflight({ roadmapDocument: validDocument, root: fakeRoot(), navigatorLike: { userAgent: "Firefox/150" } });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.errors.some(({ code }) => code === "E_PDF_RUNTIME"));
});

test("blocks missing fonts, assets, page overflow, and visual collision", async () => {
  const resourceErrors = await runPdfPreflight({ roadmapDocument: validDocument, root: fakeRoot({ fontReady: false, logoReady: false }), navigatorLike: supportedNavigator });
  assert.ok(resourceErrors.errors.some(({ code }) => code === "E_FONT_NOT_READY"));
  assert.ok(resourceErrors.errors.some(({ code }) => code === "E_ASSET_MISSING"));

  const geometryErrors = inspectRoadmapGeometry({
    sheet: { rect: sheetRect, clientWidth: 100, clientHeight: 100, scrollWidth: 101.1, scrollHeight: 100 },
    lanes: [[
      { id: "a", copy: { left: 10, right: 40, top: 10, bottom: 20 }, bar: { left: 10, right: 40, top: 22, bottom: 30 } },
      { id: "b", copy: { left: 35, right: 60, top: 10, bottom: 20 }, bar: { left: 35, right: 60, top: 22, bottom: 30 } },
    ]],
  });
  assert.ok(geometryErrors.some(({ code }) => code === "E_PAGE_OVERFLOW"));
  assert.ok(geometryErrors.some(({ code }) => code === "E_VISUAL_COLLISION"));
});

test("uses rendered text bounds for overflow and collision checks", async () => {
  const overflow = await runPdfPreflight({
    roadmapDocument: validDocument,
    root: fakeRoot({ labelRect: { left: 100, right: sheetRect.right + 10, top: 100, bottom: 110 } }),
    navigatorLike: supportedNavigator,
  });
  assert.ok(overflow.errors.some(({ code }) => code === "E_LABEL_OVERFLOW"));

  const collisions = inspectRoadmapGeometry({
    sheet: { rect: sheetRect, clientWidth: Math.round(sheetRect.right), clientHeight: Math.round(sheetRect.bottom), scrollWidth: Math.round(sheetRect.right), scrollHeight: Math.round(sheetRect.bottom) },
    lanes: [[
      { id: "a", label: { left: 10, right: 70, top: 10, bottom: 20 }, bar: { left: 10, right: 30, top: 22, bottom: 30 } },
      { id: "b", label: { left: 60, right: 90, top: 10, bottom: 20 }, bar: { left: 60, right: 90, top: 22, bottom: 30 } },
    ]],
  });
  assert.ok(collisions.some(({ code }) => code === "E_VISUAL_COLLISION"));
});
