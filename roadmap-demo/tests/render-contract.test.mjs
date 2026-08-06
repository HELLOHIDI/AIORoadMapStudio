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

test("starts in the shared saved-roadmap library and requires explicit saves", () => {
  assert.ok(app.includes('useState("library")'));
  assert.ok(app.includes('fetch("/api/roadmaps?limit=50&offset=0"'));
  assert.ok(app.includes('method: editing ? "PUT" : "POST"'));
  assert.ok(app.includes('method: "DELETE"'));
  assert.ok(app.includes('window.addEventListener("beforeunload"'));
  assert.ok(app.includes("isDirty || catalogFormDirty"));
  assert.ok(app.includes('className="catalog-form__fields" disabled={state.status === "saving"}'));
  assert.ok(app.includes('disabled={roadmapMutation.status === "saving" || catalogMutation.status === "saving"}>로드맵 목록'));
  assert.ok(app.includes("setRoadmapRefresh((current) => current + 1)"));
  assert.ok(app.includes("모든 방문자가 보고 수정하거나 삭제할 수 있습니다"));
  assert.ok(app.includes("로드맵 저장"));
  assert.ok(!app.includes("localStorage"));
  assert.ok(!app.includes("sessionStorage"));
});

test("keeps category tabs and direct roadmap moves outside print", () => {
  assert.ok(app.includes('className="category-tabs"'));
  assert.ok(app.includes('const activePrograms = document.programs.filter'));
  assert.ok(app.includes('category: activeCategory'));
  assert.ok(app.includes('draggable'));
  assert.ok(app.includes('onDrop={(event) =>'));
  assert.ok(!app.includes('roadmap-event__handle'));
  assert.ok(app.includes('params.set("category", catalogCategory)'));
  assert.ok(app.includes('사업 상세보기'));
  assert.ok(app.includes('지원대상:'));
  assert.ok(app.includes('지원 내용:'));
  assert.ok(app.includes('공고 링크:'));
  assert.match(styles, /\.category-tabs\s*\{/);
  assert.match(styles, /\.roadmap-lane\[data-drop-state="valid"\]/);
  assert.match(styles, /\.roadmap-lane\[data-drop-state="valid"\][\s\S]*outline:\s*0\.6pt dashed/s);
  assert.match(styles, /@media print\s*\{[\s\S]*\.roadmap-lane\[data-drop-state\]\s*\{[^}]*outline:\s*0;/s);
});
