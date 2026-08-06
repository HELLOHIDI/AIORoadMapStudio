import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDF_RUNTIME } from "../src/pdf-runtime.js";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const fixture = JSON.parse(readFileSync(new URL("./fixtures/pdf-runtime.json", import.meta.url), "utf8"));

test("locks the approved PDF typography and spacing tokens", () => {
  assert.match(styles, /\.roadmap-sheet\s*\{[^}]*letter-spacing:\s*0;/s);
  assert.match(styles, /\.roadmap-event__copy\s*\{[^}]*height:\s*8\.6pt;/s);
  assert.match(styles, /\.roadmap-event__copy sup\s*\{[^}]*top:\s*-8pt;/s);
  assert.match(styles, /\.roadmap-event__bar\s*\{[^}]*height:\s*0\.21cm;/s);
  assert.match(styles, /@media print\s*\{[\s\S]*\.no-print\s*\{[^}]*display:\s*none !important;/s);
});

test("keeps fixed copy and the managed PDF runtime synchronized", () => {
  assert.ok(app.includes("올인원 컨설팅 서비스 연간 로드맵_"));
  assert.ok(app.includes("주식회사 ANP컨설팅"));
  assert.equal(fixture.family, PDF_RUNTIME.family);
  assert.equal(fixture.major, PDF_RUNTIME.major);
  assert.deepEqual(fixture.profile, PDF_RUNTIME.profile);
});

test("keeps creation text-first while leaving catalog editing field-based", () => {
  assert.ok(app.includes("parseCatalogText(importText)"));
  assert.ok(app.includes("catalog-import__errors"));
  assert.ok(!app.includes("내용 불러오기"));
  assert.match(app, /form\.mode === "edit" \? <div className="catalog-form__grid">/);
  assert.match(app, /if \(!editing\) \{\s*setCatalogSearch\(""\);\s*setCatalogQuery\(""\);\s*setCatalogOffset\(0\);\s*\}/);
});

test("renders the roadmap before its editing controls", () => {
  assert.ok(app.indexOf('<main className="preview-stage"') < app.indexOf('<section className="authoring-panel no-print"'));
});
