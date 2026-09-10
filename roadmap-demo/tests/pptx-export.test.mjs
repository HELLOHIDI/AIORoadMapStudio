import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import JSZip from "jszip";
import { buildRoadmapLayout, ROADMAP_CATEGORIES, shiftProgramByMonths } from "../src/roadmap-policy.js";
import {
  createRoadmapPresentation,
  exportRoadmapPptx,
  PPTX_LAYOUT,
  PPTX_PROGRAM_TEXT,
  RoadmapPptxError,
  measureProgramLabelWidthsMm,
  sanitizePptxFileName,
} from "../src/pptx-export.js";
import { sampleRoadmap } from "../src/sample-roadmap.js";

const logoPath = new URL("../public/assets/anp-consulting-logo.png", import.meta.url);
const pptxGenPackagePath = new URL("../node_modules/pptxgenjs/package.json", import.meta.url);
const pptxGenEsmPath = new URL("../node_modules/pptxgenjs/dist/pptxgen.es.js", import.meta.url);

async function logoData() {
  const buffer = await readFile(logoPath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function buildPackage(roadmap = sampleRoadmap, options = {}) {
  const layout = buildRoadmapLayout(roadmap);
  const presentation = createRoadmapPresentation(layout, { logoData: await logoData(), ...options });
  const buffer = await presentation.write({ outputType: "nodebuffer", compression: true });
  const zip = await JSZip.loadAsync(buffer);
  return {
    layout,
    zip,
    slideXml: await zip.file("ppt/slides/slide1.xml").async("string"),
    presentationXml: await zip.file("ppt/presentation.xml").async("string"),
    coreXml: await zip.file("docProps/core.xml").async("string"),
  };
}

function shapeXmlByName(slideXml, name) {
  return [...slideXml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)]
    .map(([xml]) => xml)
    .find((xml) => xml.includes(`name="${name}"`));
}

const standardRoadmap = {
  tier: "standard",
  clientName: sampleRoadmap.clientName,
  programs: sampleRoadmap.programs.filter(({ category }) => category !== "certification"),
};

function shapeOffset(xml) {
  const match = xml?.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
  assert.ok(match, "expected shape offset");
  return { x: Number(match[1]), y: Number(match[2]) };
}

function shapeExtent(xml) {
  const match = xml?.match(/<a:ext cx="(-?\d+)" cy="(-?\d+)"/);
  assert.ok(match, "expected shape extent");
  return { cx: Number(match[1]), cy: Number(match[2]) };
}

function totalLaneCount(layout) {
  return layout.sections.reduce((total, section) => total + section.lanes.length, 0);
}

test("PPTX bar geometry follows a one-month policy shift", async () => {
  const roadmap = {
    tier: "premium",
    laneCounts: { consulting: 2, business: 4, voucher: 2, ip: 2, certification: 1 },
    clientName: "shift",
    programs: [{ id: "shift", category: "consulting", title: "shift", startMonth: 3, endMonth: 4, amountKrw: null, sequence: 0, laneIndex: 0 }],
  };
  const shifted = shiftProgramByMonths({ document: roadmap, programId: "shift", deltaMonths: 1 });
  const before = await buildPackage(roadmap);
  const after = await buildPackage({ ...roadmap, programs: shifted.programs });
  const beforeBar = shapeOffset(shapeXmlByName(before.slideXml, "anp.roadmap.program.shift.bar"));
  const afterBar = shapeOffset(shapeXmlByName(after.slideXml, "anp.roadmap.program.shift.bar"));
  const timelineWidth = PPTX_LAYOUT.page.widthMm - PPTX_LAYOUT.content.leftMm - PPTX_LAYOUT.content.rightMm - PPTX_LAYOUT.categoryWidthMm;

  assert.equal(afterBar.x - beforeBar.x, Math.round(timelineWidth / 12 * 36000));
  assert.equal(afterBar.y, beforeBar.y);
});

test("PPTX 파일명은 안전한 고객명과 pptx 확장자를 사용한다", () => {
  assert.equal(
    sanitizePptxFileName('  알파:/브라더스?  '),
    "ANP_올인원_컨설팅_연간_로드맵_알파 브라더스.pptx",
  );
});

test("브라우저 PPTX 번들은 취약한 image-size 파서를 포함하지 않는다", async () => {
  const packageMetadata = JSON.parse(await readFile(pptxGenPackagePath, "utf8"));
  const esmBundle = await readFile(pptxGenEsmPath, "utf8");
  assert.equal(packageMetadata.browser["image-size"], false);
  assert.doesNotMatch(esmBundle, /(?:from\s+|require\()\s*["']image-size["']/);
});

test("브라우저에서 로드된 승인 글꼴로 프로그램 제목 폭을 측정한다", async () => {
  const layout = buildRoadmapLayout({
    tier: "premium",
    laneCounts: { consulting: 2, business: 4, voucher: 2, ip: 2, certification: 1 },
    clientName: "폭 측정",
    programs: [{
      id: "width-program",
      category: "business",
      title: "초기창업패키지",
      startMonth: 1,
      endMonth: 1,
      amountKrw: 100_000_000,
      sequence: 0,
    }],
  });
  let loadedFont = "";
  let canvasFont = "";
  const widths = await measureProgramLabelWidthsMm(layout, {
    fonts: { load: async (font) => { loadedFont = font; return [{}]; } },
    createElement: () => ({
      getContext: () => ({
        set font(value) { canvasFont = value; },
        measureText: () => ({ width: 96 }),
      }),
    }),
  });
  assert.match(loadedFont, /700 6pt "NanumSquare AC"/);
  assert.equal(canvasFont, loadedFont);
  assert.ok(Math.abs(widths["width-program"] - 25.4) < 0.001);
});

test("PPTX uses the roadmap-only business or marketing prefix", async () => {
  const { layout, slideXml } = await buildPackage({
    tier: "premium",
    laneCounts: { consulting: 2, business: 4, voucher: 2, ip: 2, certification: 1 },
    clientName: "표시 구분",
    programs: [
      { id: "business-label", category: "business", title: "사업화 지원", startMonth: 1, endMonth: 1, amountKrw: null, sequence: 0 },
      { id: "marketing-label", category: "business", displayCategory: "marketing", title: "홍보 지원", startMonth: 2, endMonth: 2, amountKrw: null, sequence: 1 },
    ],
  });

  assert.equal(layout.errors.length, 0);
  assert.match(slideXml, /\[사업화] 사업화 지원/);
  assert.match(slideXml, /\[마케팅] 홍보 지원/);
});

test("레이아웃 오류가 있으면 PPTX 생성을 차단하고 원래 오류를 보존한다", async () => {
  const layout = buildRoadmapLayout({ clientName: "", programs: [] });
  const logo = await logoData();
  assert.throws(
    () => createRoadmapPresentation(layout, { logoData: logo }),
    (error) => error instanceof RoadmapPptxError
      && error.code === "E_PPTX_LAYOUT_INVALID"
      && error.errors.some(({ code }) => code === "E_CLIENT_NAME_REQUIRED"),
  );
});

test("레이아웃 오류는 로고 요청이나 다운로드보다 먼저 차단된다", async () => {
  const layout = buildRoadmapLayout({ clientName: "", programs: [] });
  let fetchCalls = 0;
  await assert.rejects(
    exportRoadmapPptx({
      layout,
      fetchImplementation: async () => {
        fetchCalls += 1;
        throw new Error("must not fetch");
      },
    }),
    (error) => error instanceof RoadmapPptxError && error.code === "E_PPTX_LAYOUT_INVALID",
  );
  assert.equal(fetchCalls, 0);
});

test("네이티브 PPTX 패키지는 A4 가로 한 장과 편집 가능한 로드맵 개체를 포함한다", async () => {
  const { layout, zip, slideXml, presentationXml, coreXml } = await buildPackage();
  const slideIds = presentationXml.match(/<p:sldId\b/g) || [];

  assert.equal(layout.errors.length, 0);
  assert.equal(slideIds.length, 1);
  assert.match(presentationXml, new RegExp(`cx="${PPTX_LAYOUT.page.widthMm * 36000}"`));
  assert.match(presentationXml, new RegExp(`cy="${PPTX_LAYOUT.page.heightMm * 36000}"`));
  assert.match(coreXml, /ANP Consulting/);

  assert.match(slideXml, /올인원 컨설팅 서비스 연간 로드맵_클라이언트명/);
  assert.match(slideXml, /Road to funds/);
  assert.match(slideXml, /ANP CONSULTING/);
  for (let month = 1; month <= 12; month += 1) assert.match(slideXml, new RegExp(`${month}월`));
  for (const category of ROADMAP_CATEGORIES) assert.match(slideXml, new RegExp(category.label));
  for (const program of sampleRoadmap.programs) {
    assert.match(slideXml, new RegExp(`anp\\.roadmap\\.program\\.${program.id}\\.text`));
    assert.match(slideXml, new RegExp(`anp\\.roadmap\\.program\\.${program.id}\\.bar`));
    assert.match(slideXml, new RegExp(program.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    if (program.amountKrw != null) {
      assert.match(slideXml, new RegExp(`anp\\.roadmap\\.program\\.${program.id}\\.amount`));
    }
  }

  assert.match(slideXml, /<a:prstGeom prst="roundRect"/);
  assert.ok((slideXml.match(/<p:sp>/g) || []).length > sampleRoadmap.programs.length * 2);
  assert.ok((slideXml.match(/name="anp\.roadmap\.line\./g) || []).length >= 18);
  assert.equal(slideXml.includes("AIO Roadmap Studio"), false);
  assert.equal(slideXml.includes("aio-roadmap-studio-icon"), false);
  assert.equal(Object.keys(zip.files).filter((name) => name.startsWith("ppt/media/") && !zip.files[name].dir).length, 1);
  assert.equal(
    (slideXml.match(/name="anp\.roadmap\.program\.[^"]+\.amount"/g) || []).length,
    sampleRoadmap.programs.filter(({ amountKrw }) => amountKrw != null).length,
  );
  assert.equal(slideXml.includes('baseline="30000"'), false);
});

test("Premium and Standard PPTX outputs use tier-resolved section and lane geometry", async () => {
  const premium = await buildPackage();
  const standard = await buildPackage(standardRoadmap);
  const oneLane = Math.round(PPTX_LAYOUT.laneHeightMm * 36000);

  assert.equal(premium.layout.errors.length, 0);
  assert.equal(standard.layout.errors.length, 0);
  assert.equal(premium.layout.sections.length, 5);
  assert.equal(standard.layout.sections.length, 4);
  assert.equal(totalLaneCount(premium.layout), 11);
  assert.equal(totalLaneCount(standard.layout), 10);
  assert.equal(standard.layout.sections.some(({ key }) => key === "certification"), false);

  const certification = ROADMAP_CATEGORIES.find(({ key }) => key === "certification");
  assert.ok(certification);
  assert.match(premium.slideXml, new RegExp(certification.label));
  assert.doesNotMatch(standard.slideXml, new RegExp(certification.label));
  assert.doesNotMatch(standard.slideXml, /anp\.roadmap\.category-certification/);
  assert.doesNotMatch(standard.slideXml, /anp\.roadmap\.program\.a[1-4]\./);

  for (const name of [
    "anp.roadmap.line.table-bottom",
    "anp.roadmap.text.note-1",
    "anp.roadmap.line.notes-bottom",
    "anp.roadmap.text.footer",
  ]) {
    const premiumY = shapeOffset(shapeXmlByName(premium.slideXml, name)).y;
    const standardY = shapeOffset(shapeXmlByName(standard.slideXml, name)).y;
    assert.equal(premiumY - standardY, oneLane, name);
  }
  assert.equal(
    shapeOffset(shapeXmlByName(premium.slideXml, "anp.roadmap.text.watermark")).y
      - shapeOffset(shapeXmlByName(standard.slideXml, "anp.roadmap.text.watermark")).y,
    Math.round(oneLane / 2),
    "anp.roadmap.text.watermark",
  );

  const bodyStartY = PPTX_LAYOUT.headerHeightMm + PPTX_LAYOUT.monthHeightMm;
  const standardBodyHeight = totalLaneCount(standard.layout) * PPTX_LAYOUT.laneHeightMm;
  assert.equal(
    shapeOffset(shapeXmlByName(standard.slideXml, "anp.roadmap.text.watermark")).y,
    Math.round((bodyStartY + standardBodyHeight / 2 - 9) * 36000),
  );
  assert.equal(
    shapeOffset(shapeXmlByName(standard.slideXml, "anp.roadmap.line.table-bottom")).y,
    Math.round((bodyStartY + standardBodyHeight) * 36000),
  );

  assert.equal(
    (standard.slideXml.match(/name="anp\.roadmap\.shape\.category-background\.[^"]+"/g) || []).length,
    4,
  );
});

test("PPTX geometry follows representative transferred Premium lane counts", async () => {
  const custom = await buildPackage({
    tier: "premium",
    clientName: "custom lanes",
    laneCounts: { consulting: 2, business: 4, voucher: 2, ip: 1, certification: 2 },
    programs: [],
  });
  const defaults = await buildPackage({ ...sampleRoadmap, programs: [] });
  const oneLane = Math.round(PPTX_LAYOUT.laneHeightMm * 36000);

  assert.equal(totalLaneCount(custom.layout), 11);
  assert.equal(shapeExtent(shapeXmlByName(custom.slideXml, "anp.roadmap.shape.category-background.ip")).cy, oneLane);
  assert.equal(shapeExtent(shapeXmlByName(custom.slideXml, "anp.roadmap.shape.category-background.certification")).cy, oneLane * 2);
  assert.equal(
    shapeOffset(shapeXmlByName(defaults.slideXml, "anp.roadmap.shape.category-background.certification")).y
      - shapeOffset(shapeXmlByName(custom.slideXml, "anp.roadmap.shape.category-background.certification")).y,
    oneLane,
  );
  assert.equal(
    shapeOffset(shapeXmlByName(custom.slideXml, "anp.roadmap.line.table-bottom")).y,
    shapeOffset(shapeXmlByName(defaults.slideXml, "anp.roadmap.line.table-bottom")).y,
  );
});

test("PPTX customer-facing XML, metadata, and filenames do not expose tier wording", async () => {
  const { slideXml, presentationXml, coreXml } = await buildPackage(standardRoadmap);
  const fileName = sanitizePptxFileName("Neutral Client");
  for (const value of [slideXml, presentationXml, coreXml, fileName]) {
    assert.doesNotMatch(value, /Premium|Standard|premium|standard|tier/i);
  }
});

test("프로그램 막대의 좌표와 너비는 월 범위와 결정된 행에서 계산된다", async () => {
  const roadmap = {
    tier: "premium",
    laneCounts: { consulting: 2, business: 4, voucher: 2, ip: 2, certification: 1 },
    clientName: "좌표 검증",
    programs: [{
      id: "program-coordinate",
      category: "business",
      title: "좌표 검증 사업",
      startMonth: 3,
      endMonth: 5,
      amountKrw: 30_000_000,
      sequence: 0,
      laneIndex: 2,
    }],
  };
  const labelWidthMm = 20.32;
  const { slideXml } = await buildPackage(roadmap, {
    programLabelWidthsMm: { "program-coordinate": labelWidthMm },
  });
  const barXml = shapeXmlByName(slideXml, "anp.roadmap.program.program-coordinate.bar");
  const amountXml = shapeXmlByName(slideXml, "anp.roadmap.program.program-coordinate.amount");
  assert.ok(barXml);
  assert.ok(amountXml);

  const contentWidth = PPTX_LAYOUT.page.widthMm - PPTX_LAYOUT.content.leftMm - PPTX_LAYOUT.content.rightMm;
  const timelineLeft = PPTX_LAYOUT.content.leftMm + PPTX_LAYOUT.categoryWidthMm;
  const timelineWidth = contentWidth - PPTX_LAYOUT.categoryWidthMm;
  const expectedX = Math.round((timelineLeft + 2 * timelineWidth / 12 + 0.7) * 36000);
  const expectedWidth = Math.round((3 * timelineWidth / 12 - 1.4) * 36000);
  const businessSectionTop = PPTX_LAYOUT.headerHeightMm
    + PPTX_LAYOUT.monthHeightMm
    + ROADMAP_CATEGORIES[0].defaultLaneCount * PPTX_LAYOUT.laneHeightMm;
  const expectedY = Math.round((businessSectionTop + 2 * PPTX_LAYOUT.laneHeightMm + PPTX_LAYOUT.laneHeightMm - 0.8 - 2.1) * 36000);
  const expectedAmountX = Math.round((timelineLeft + 2 * timelineWidth / 12 + 0.7
    + PPTX_PROGRAM_TEXT.labelLeftPt * 25.4 / 72
    + labelWidthMm
    + PPTX_PROGRAM_TEXT.amountGapPt * 25.4 / 72) * 36000);
  const expectedAmountY = Math.round((expectedY / 36000 - PPTX_PROGRAM_TEXT.amountTopFromBarMm) * 36000);

  assert.match(barXml, new RegExp(`<a:off x="${expectedX}" y="${expectedY}"`));
  assert.match(barXml, new RegExp(`<a:ext cx="${expectedWidth}" cy="${Math.round(2.1 * 36000)}"`));
  assert.match(amountXml, new RegExp(`<a:off x="${expectedAmountX}" y="${expectedAmountY}"`));
});

test("Standard program coordinates keep existing month and lane invariants", async () => {
  const roadmap = {
    tier: "standard",
    clientName: "standard-coordinate",
    programs: [{
      id: "standard-coordinate",
      category: "business",
      title: "standard coordinate program",
      startMonth: 3,
      endMonth: 5,
      amountKrw: 30_000_000,
      sequence: 0,
      laneIndex: 2,
    }],
  };
  const labelWidthMm = 20.32;
  const { slideXml } = await buildPackage(roadmap, {
    programLabelWidthsMm: { "standard-coordinate": labelWidthMm },
  });
  const barXml = shapeXmlByName(slideXml, "anp.roadmap.program.standard-coordinate.bar");
  const amountXml = shapeXmlByName(slideXml, "anp.roadmap.program.standard-coordinate.amount");
  assert.ok(barXml);
  assert.ok(amountXml);

  const contentWidth = PPTX_LAYOUT.page.widthMm - PPTX_LAYOUT.content.leftMm - PPTX_LAYOUT.content.rightMm;
  const timelineLeft = PPTX_LAYOUT.content.leftMm + PPTX_LAYOUT.categoryWidthMm;
  const timelineWidth = contentWidth - PPTX_LAYOUT.categoryWidthMm;
  const expectedX = Math.round((timelineLeft + 2 * timelineWidth / 12 + 0.7) * 36000);
  const expectedWidth = Math.round((3 * timelineWidth / 12 - 1.4) * 36000);
  const businessSectionTop = PPTX_LAYOUT.headerHeightMm
    + PPTX_LAYOUT.monthHeightMm
    + ROADMAP_CATEGORIES[0].defaultLaneCount * PPTX_LAYOUT.laneHeightMm;
  const expectedY = Math.round((businessSectionTop + 2 * PPTX_LAYOUT.laneHeightMm + PPTX_LAYOUT.laneHeightMm - 0.8 - 2.1) * 36000);
  const expectedAmountX = Math.round((timelineLeft + 2 * timelineWidth / 12 + 0.7
    + PPTX_PROGRAM_TEXT.labelLeftPt * 25.4 / 72
    + labelWidthMm
    + PPTX_PROGRAM_TEXT.amountGapPt * 25.4 / 72) * 36000);
  const expectedAmountY = Math.round((expectedY / 36000 - PPTX_PROGRAM_TEXT.amountTopFromBarMm) * 36000);

  assert.match(barXml, new RegExp(`<a:off x="${expectedX}" y="${expectedY}"`));
  assert.match(barXml, new RegExp(`<a:ext cx="${expectedWidth}" cy="${Math.round(2.1 * 36000)}"`));
  assert.match(amountXml, new RegExp(`<a:off x="${expectedAmountX}" y="${expectedAmountY}"`));
  assert.deepEqual(shapeExtent(barXml), { cx: expectedWidth, cy: Math.round(2.1 * 36000) });
});
