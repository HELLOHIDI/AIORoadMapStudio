import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDF_RUNTIME } from "../src/pdf-runtime.js";
import { PPTX_LAYOUT } from "../src/pptx-export.js";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const pptxExport = readFileSync(new URL("../src/pptx-export.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const pdfVerifier = readFileSync(new URL("../scripts/verify-roadmap-pdf.mjs", import.meta.url), "utf8");
const pptxVerifier = readFileSync(new URL("../scripts/verify-roadmap-pptx.mjs", import.meta.url), "utf8");
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const fixture = JSON.parse(readFileSync(new URL("./fixtures/pdf-runtime.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("locks the approved PDF typography and spacing tokens", () => {
  assert.match(styles, /\.roadmap-sheet\s*\{[^}]*letter-spacing:\s*0;/s);
  assert.match(styles, /\.roadmap-event__copy\s*\{[^}]*height:\s*8\.6pt;/s);
  assert.match(styles, /\.roadmap-event__copy sup\s*\{[^}]*top:\s*-8pt;/s);
  assert.match(styles, /\.roadmap-event__bar\s*\{[^}]*height:\s*0\.21cm;/s);
  assert.match(styles, /@media print\s*\{[\s\S]*\.no-print\s*\{[^}]*display:\s*none !important;/s);
});

test("keeps native PPTX geometry synchronized with the approved PDF sheet", () => {
  assert.deepEqual(PPTX_LAYOUT.page, { widthMm: 297, heightMm: 210 });
  assert.deepEqual(PPTX_LAYOUT.content, { leftMm: 11.7, rightMm: 6.7 });
  assert.equal(PPTX_LAYOUT.headerHeightMm, 37.8);
  assert.equal(PPTX_LAYOUT.categoryWidthMm, 21);
  assert.equal(PPTX_LAYOUT.monthHeightMm, 10.2);
  assert.equal(PPTX_LAYOUT.laneHeightMm, 10.287);
  assert.equal(PPTX_LAYOUT.notesHeightMm, 18.9);
  assert.equal(PPTX_LAYOUT.footerHeightMm, 16.7);

  assert.match(styles, /\.roadmap-sheet\s*\{[^}]*width:\s*297mm;[^}]*height:\s*210mm;[^}]*padding:\s*0 6\.7mm 0 11\.7mm;/s);
  assert.match(styles, /\.sheet-header\s*\{[^}]*height:\s*37\.8mm;/s);
  assert.match(styles, /\.month-row\s*\{[^}]*grid-template-columns:\s*21mm 1fr;[^}]*height:\s*10\.2mm;/s);
  assert.match(styles, /\.roadmap-lane\s*\{[^}]*height:\s*10\.287mm;/s);
  assert.match(styles, /\.roadmap-event\s*\{[^}]*bottom:\s*0\.8mm;[^}]*left:\s*calc\(var\(--start\) \* \(100% \/ 12\) \+ 0\.7mm\);[^}]*width:\s*calc\(var\(--span\) \* \(100% \/ 12\) - 1\.4mm\);/s);
  assert.match(styles, /\.roadmap-event__bar\s*\{[^}]*height:\s*0\.21cm;/s);
  assert.match(styles, /\.sheet-notes\s*\{[^}]*height:\s*18\.9mm;/s);
  assert.match(styles, /\.sheet-footer\s*\{[^}]*height:\s*16\.7mm;/s);
});

test("keeps fixed copy and the Chromium PDF profile synchronized", () => {
  assert.ok(app.includes("올인원 컨설팅 서비스 연간 로드맵_"));
  assert.ok(app.includes("주식회사 ANP컨설팅"));
  assert.equal(fixture.family, PDF_RUNTIME.family);
  assert.deepEqual(fixture.profile, PDF_RUNTIME.profile);
});

test("keeps AIO branding in product chrome and ANP branding in the client PDF", () => {
  assert.ok(index.includes('href="/assets/aio-roadmap-studio-icon.png"'));
  assert.ok(index.includes("<title>AIO Roadmap Studio</title>"));
  assert.ok(app.includes('className="preview-toolbar no-print"'));
  assert.ok(app.includes('className="product-brand-icon" src="/assets/aio-roadmap-studio-icon.png"'));
  assert.ok(app.includes("<strong>AIO Roadmap Studio</strong>"));
  assert.ok(app.includes('className="brand-logo" src="/assets/anp-consulting-logo.png"'));
  assert.ok(!app.includes('className="brand-logo" src="/assets/aio-roadmap-studio'));
});

test("adds native PPTX export without coupling it to the PDF runtime gate", () => {
  assert.ok(app.includes('await import("./pptx-export.js")'));
  assert.ok(app.includes("PPTX 다운로드"));
  assert.ok(app.includes('disabled={pptxState.status === "exporting" || layout.errors.length > 0}'));
  assert.match(app, /const handlePptxExport = async \(\) => \{[\s\S]*if \(layout\.errors\.length\)[\s\S]*exportRoadmapPptx\(\{ layout \}\)[\s\S]*\n  \};/);
  assert.doesNotMatch(app.match(/const handlePptxExport = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || "", /pdfState|runPdfPreflight|currentRuntime/);
  assert.ok(pptxExport.includes('presentation.writeFile({ fileName, compression: true })'));
  assert.ok(pptxExport.includes('objectName: objectName("program", item.id, "bar")'));
  assert.ok(pptxExport.includes('objectName: objectName("program", item.id, "amount")'));
  assert.ok(pptxExport.includes("amountTopFromBarMm: 5.42"));
  assert.equal(pptxExport.includes("superscript: true"), false);
  assert.equal(pptxExport.includes("AIO Roadmap Studio"), false);
});

test("requires an authoring-only tier choice before blank roadmap creation", () => {
  assert.ok(app.includes('useState("library")'));
  assert.ok(app.includes('setScreen("tier")'));
  assert.ok(app.includes('ref={tierHeading}'));
  assert.ok(app.includes('onClick={() => createRoadmapWithTier("premium")}'));
  assert.ok(app.includes('onClick={() => createRoadmapWithTier("standard")}'));
  assert.ok(app.includes("const blank = { tier, clientName: \"\", programs: [] }"));
  assert.ok(app.includes("const cancelTierSelection = () =>"));
  assert.ok(app.includes('setScreen("library")'));
  assert.ok(app.includes('className="tier-choice no-print"'));
  assert.ok(app.includes('className="tier-badge tier-badge--editor no-print"'));
  assert.ok(app.includes('className="tier-badge no-print"'));
  assert.match(styles, /\.tier-choice\s*\{/);
  assert.match(styles, /\.tier-badge\s*\{/);
  assert.match(styles, /\.catalog-row__meta > div\s*\{[^}]*align-items: center;/s);
  assert.ok(app.includes('className="catalog-row catalog-row--roadmap"'));
  assert.match(styles, /@media \(max-width: 860px\)[\s\S]*?\.catalog-row--roadmap\s*\{\s*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*?\.catalog-row--roadmap\s*\{\s*grid-template-columns: 1fr;/);
});

test("resolves authoring categories from the immutable roadmap tier", () => {
  assert.ok(app.includes("allowedCategoriesForTier(documentTier)"));
  assert.ok(app.includes("resolveRoadmapTier(document)"));
  assert.ok(app.includes("setActiveCategory(firstCategory)"));
  assert.ok(app.includes("setCatalogCategory(CATALOG_CATEGORIES[0].key)"));
  assert.ok(app.includes("const nextFirstCategory = allowedCategoriesForTier(resolveRoadmapTier(data.item.document))[0].key"));
  assert.ok(app.includes("allowedCategories.map(({ key, label })"));
  assert.ok(app.includes("catalogCategories.map(({ key, label })"));
  assert.ok(app.includes("categories={editorCategories}"));
  assert.ok(app.includes("params.set(\"category\", catalogCategoryKeys.has(catalogCategory) ? catalogCategory : firstCatalogCategory)"));
  assert.ok(app.includes("if (!allowedCategoryKeys.has(program.category))"));
  assert.ok(app.includes("tier: documentTier"));
});

test("keeps tier wording out of customer-facing export surfaces", () => {
  const sheetMarkup = app.match(/<article className="roadmap-sheet"[\s\S]*?<\/article>/)?.[0] || "";
  assert.doesNotMatch(sheetMarkup, /Premium|Standard|tierLabel/);
  assert.doesNotMatch(pptxExport, /Premium|Standard|tierLabel/);
});

test("runs release export verification for both roadmap tiers", () => {
  assert.match(packageJson.scripts["verify:pdf"], /--tier premium/);
  assert.match(packageJson.scripts["verify:pdf"], /--tier standard/);
  assert.ok(pdfVerifier.includes("expectedCategoryLabels = allowedCategoriesForTier(tier)"));
  assert.ok(pdfVerifier.includes('tier === "premium" ? "Premium" : "Standard"'));
  assert.ok(pptxVerifier.includes('tier: "standard"'));
  assert.ok(pptxVerifier.includes("standardArtifacts.layout.sections.length, 4"));
  assert.ok(pptxVerifier.includes("certificationAbsent: true"));
});

test("keeps creation text-first while leaving catalog editing field-based", () => {
  assert.ok(app.includes("parseCatalogText(importText)"));
  assert.ok(app.includes("catalog-import__errors"));
  assert.ok(!app.includes("내용 불러오기"));
  assert.match(app, /form\.mode === "edit" \? <div className="catalog-form__grid">/);
  assert.match(app, /if \(!editing\) \{\s*setCatalogSearch\(""\);\s*setCatalogQuery\(""\);\s*setCatalogOffset\(0\);\s*\}/);
});

test("keeps shared tag creation and catalog filters wired to the server", () => {
  assert.ok(app.includes('fetch("/api/catalog-options"'));
  assert.ok(app.includes('params.append("industry", value)'));
  assert.ok(app.includes('params.append("region", value)'));
  assert.ok(app.includes('params.append("businessSubcategory", value)'));
  assert.doesNotMatch(app, /supportYear|지원연도|연도 미정/);
  assert.ok(app.includes('params.set("startMonth", catalogStartMonth)'));
  assert.ok(app.includes('params.set("endMonth", catalogEndMonth)'));
  assert.ok(app.includes('onCreate={form.mode === "create"'));
  assert.ok(app.includes('“${normalizedQuery}” 공용 선택지로 추가'));
  assert.match(app, /<FilterPopover id="catalog-category-filter" label="구분"/);
  assert.match(app, /<FilterPopover id="catalog-industry-filter" label="업종"/);
  assert.match(app, /<FilterPopover id="catalog-region-filter" label="지역"/);
  assert.match(app, /className="catalog-quick-filters" role="group" aria-label="사업화 세부 분류"/);
  assert.match(app, /<MonthRangeFilter\s+startMonth=\{catalogStartMonth\}\s+endMonth=\{catalogEndMonth\}/);
  assert.ok(app.includes('catalogCategory !== firstCatalogCategory'));
  assert.ok(app.includes('setCatalogCategory(firstCatalogCategory)'));
  assert.ok(app.includes('catalog-month-range__start--raised'));
  assert.ok(app.includes('placeholder="사업명 검색"'));
  assert.ok(app.includes('className="catalog-main-package-toggle"'));
  assert.ok(app.includes("program.businessSubcategories?.length"));
  assert.ok(app.includes("formatCatalogPeriod(program)"));
  assert.ok(app.includes('className="catalog-filter-status" role="status"'));
  assert.ok(app.includes('aria-label="대한민국 행정구역별 지역 필터"'));
  assert.ok(app.includes('popover="auto"'));
  assert.match(styles, /\.catalog-filter-bar\s*\{/);
  assert.match(styles, /\.catalog-filter-status\s*\{/);
  assert.match(styles, /\.catalog-filter-popover::backdrop\s*\{/);
  assert.match(styles, /\.catalog-month-range__track\s*\{/);
  assert.match(styles, /\.tag-picker__create\s*\{/);
  assert.match(styles, /\.region-filter__groups\s*\{/);
});

test("renders the roadmap before its editing controls", () => {
  assert.ok(app.indexOf('<main className="preview-stage"') < app.indexOf('<section className="authoring-panel no-print"'));
});

test("keeps roadmap feedback anchored to bars and isolated from exports", () => {
  assert.ok(app.includes('className="roadmap-event__main"'));
  assert.ok(app.includes('onOpen(item.id)'));
  assert.doesNotMatch(app, /feedbackCount/);
  assert.ok(app.includes('roadmap-event__feedback-indicator--unresolved'));
  assert.ok(app.includes('>수정 필요</span>'));
  assert.ok(app.includes('className={`feedback-composer no-print'));
  assert.ok(app.includes('className="feedback-panel no-print"'));
  assert.ok(app.includes('composerOpen={item.id === selectedFeedbackProgramId && !feedbackByProgram[item.id]}'));
  assert.match(styles, /\.roadmap-section:has\(\.feedback-composer\)\s*\{[^}]*z-index:\s*10;/s);
  assert.ok(app.includes('event.role === "lead" || event.role === "team_lead"'));
  assert.ok(app.includes('onAction("complete")'));
  assert.ok(app.includes('onAction("rework")'));
  assert.ok(app.includes('onAction("resolve")'));
  assert.match(styles, /@media \(max-width: 860px\)\s*\{[\s\S]*\.feedback-panel\s*\{[\s\S]*bottom:\s*0;/s);
  assert.match(styles, /@media print\s*\{[\s\S]*\.no-print\s*\{[^}]*display:\s*none !important;/s);
  assert.match(styles, /@media print\s*\{[\s\S]*\.roadmap-event--selected \.roadmap-event__main\s*\{[^}]*outline:\s*0;/s);
  assert.equal(pptxExport.includes("feedback"), false);
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
  assert.ok(app.includes('category, title: ""'));
  assert.ok(app.includes('draggable'));
  assert.ok(app.includes('onDrop={(event) =>'));
  assert.ok(app.includes('event.dataTransfer.getData("text/plain") || dragProgramId.current'));
  assert.ok(app.includes('const deltaMonths = monthWidth ? Math.round((event.clientX - startClientX) / monthWidth) : 0;'));
  assert.ok(app.includes('dropProgram(event, programId, laneIndex)'));
  assert.ok(!app.includes('roadmap-event__handle'));
  assert.ok(app.includes('params.set("category", catalogCategoryKeys.has(catalogCategory) ? catalogCategory : firstCatalogCategory)'));
  assert.ok(app.includes('사업 상세보기'));
  assert.ok(app.includes('지원대상:'));
  assert.ok(app.includes('지원 내용:'));
  assert.ok(app.includes('formatCatalogBulletText(program.target)'));
  assert.ok(app.includes('formatCatalogBulletText(program.details)'));
  assert.ok(app.includes('공고 링크:'));
  assert.match(styles, /\.category-tabs\s*\{/);
  assert.match(styles, /\.roadmap-lane\[data-drop-state="valid"\]/);
  assert.match(styles, /\.roadmap-lane\[data-drop-state="valid"\][\s\S]*outline:\s*0\.6pt dashed/s);
  assert.doesNotMatch(styles, /standard[\s\S]*\.roadmap-lane[\s\S]*height:/i);
  assert.match(styles, /@media print\s*\{[\s\S]*\.roadmap-lane\[data-drop-state\]\s*\{[^}]*outline:\s*0;/s);
});

test("keeps marketing and placement guidance inside roadmap authoring", () => {
  const catalogFields = worker.match(/const FIELDS = new Set\([^\n]+/)?.[0] ?? "";
  const roadmapFields = worker.match(/const ROADMAP_PROGRAM_FIELDS = new Set\([^\n]+/)?.[0] ?? "";

  assert.ok(app.includes('{ key: "marketing", label: "마케팅" }'));
  assert.ok(app.includes('{ category: "business", displayCategory: "marketing" }'));
  assert.ok(app.includes("roadmapProgramLabel(item)"));
  assert.ok(app.includes("사업 정보 보기"));
  assert.ok(app.includes("로드맵 미배치"));
  assert.ok(app.includes('code === "E_ROW_CAPACITY" && programId'));
  assert.ok(app.includes("safeExternalUrl(program.link)"));
  assert.ok(app.includes('role="group"'));
  assert.ok(app.includes("aria-describedby={placementError ? placementErrorId : undefined}"));
  assert.ok(app.includes('aria-invalid={placementError ? "true" : undefined}'));
  assert.match(styles, /\.program-editor--unplaced\s*\{[^}]*border-left-color:\s*#b42318;[^}]*background:\s*#fff1f1;/s);
  assert.match(styles, /\.program-placement-error strong\s*\{[^}]*background:\s*#b42318;/s);
  assert.match(roadmapFields, /displayCategory/);
  assert.doesNotMatch(catalogFields, /displayCategory/);
  assert.ok(pptxExport.includes("roadmapProgramLabel(item)"));
  assert.equal(pptxExport.includes("로드맵 미배치"), false);
});
