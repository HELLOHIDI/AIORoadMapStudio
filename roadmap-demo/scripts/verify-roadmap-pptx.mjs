import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { createRoadmapPresentation, PPTX_LAYOUT } from "../src/pptx-export.js";
import { buildRoadmapLayout, ROADMAP_CATEGORIES, ROADMAP_TIERS } from "../src/roadmap-policy.js";
import { sampleRoadmap } from "../src/sample-roadmap.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const outputPath = resolve(projectRoot, argument("--output", "output/pptx/ANP-roadmap-verified.pptx"));
const standardOutputPath = resolve(projectRoot, argument("--standard-output", "output/pptx/ANP-roadmap-standard-verified.pptx"));
const reportPath = resolve(projectRoot, argument("--report", "output/pptx/ANP-roadmap-verified.qa.json"));
const logoPath = resolve(projectRoot, "public/assets/anp-consulting-logo.png");

const logo = await readFile(logoPath);
const logoData = `data:image/png;base64,${logo.toString("base64")}`;

async function createVerifiedArtifacts(roadmap) {
  const roadmapLayout = buildRoadmapLayout(roadmap);
  assert.deepEqual(roadmapLayout.errors, []);
  const presentation = createRoadmapPresentation(roadmapLayout, { logoData });
  const buffer = Buffer.from(await presentation.write({ outputType: "nodebuffer", compression: true }));
  const archive = await JSZip.loadAsync(buffer);
  return {
    layout: roadmapLayout,
    pptx: buffer,
    zip: archive,
    presentationXml: await archive.file("ppt/presentation.xml").async("string"),
    slideXml: await archive.file("ppt/slides/slide1.xml").async("string"),
    coreXml: await archive.file("docProps/core.xml").async("string"),
  };
}

const { layout, pptx, zip, presentationXml, slideXml, coreXml } = await createVerifiedArtifacts(sampleRoadmap);

const slideCount = (presentationXml.match(/<p:sldId\b/g) || []).length;
const shapeCount = (slideXml.match(/<p:sp>/g) || []).length;
const textObjectCount = (slideXml.match(/<p:txBody>/g) || []).length;
const lineObjectCount = (slideXml.match(/name="anp\.roadmap\.line\./g) || []).length;
const roundedBarCount = (slideXml.match(/<a:prstGeom prst="roundRect"/g) || []).length;
const programTextNames = (slideXml.match(/name="anp\.roadmap\.program\.[^"]+\.text"/g) || []);
const programBarNames = (slideXml.match(/name="anp\.roadmap\.program\.[^"]+\.bar"/g) || []);
const programAmountNames = (slideXml.match(/name="anp\.roadmap\.program\.[^"]+\.amount"/g) || []);
const mediaFiles = Object.keys(zip.files).filter((name) => name.startsWith("ppt/media/") && !zip.files[name].dir);
const imageExtents = [...slideXml.matchAll(/<p:pic>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"\/>[\s\S]*?<\/p:pic>/g)]
  .map(([, width, height]) => ({ widthEmu: Number(width), heightEmu: Number(height) }));
const page = { widthEmu: PPTX_LAYOUT.page.widthMm * 36000, heightEmu: PPTX_LAYOUT.page.heightMm * 36000 };

assert.equal(slideCount, 1, "PPTX must contain exactly one slide");
assert.match(presentationXml, new RegExp(`cx="${page.widthEmu}"`));
assert.match(presentationXml, new RegExp(`cy="${page.heightEmu}"`));
assert.match(coreXml, /ANP Consulting/);
assert.equal(mediaFiles.length, 1, "Only the independent ANP logo image is expected");
assert.equal(imageExtents.length, 1, "Only one image object is expected");
assert.ok(imageExtents[0].widthEmu < page.widthEmu / 2 && imageExtents[0].heightEmu < page.heightEmu / 2, "A full-slide screenshot must not exist");
assert.equal(programTextNames.length, sampleRoadmap.programs.length);
assert.equal(programBarNames.length, sampleRoadmap.programs.length);
assert.equal(programAmountNames.length, sampleRoadmap.programs.filter(({ amountKrw }) => amountKrw != null).length);
assert.equal(slideXml.includes('baseline="30000"'), false, "Amounts must use explicit native text-box coordinates instead of default superscript positioning");
assert.equal(roundedBarCount, sampleRoadmap.programs.length);
assert.ok(textObjectCount >= sampleRoadmap.programs.length + 22);
assert.ok(shapeCount >= sampleRoadmap.programs.length * 2 + 22);
assert.ok(lineObjectCount >= 18);

for (const text of [
  "올인원 컨설팅 서비스 연간 로드맵_클라이언트명",
  "Road to funds",
  "ANP CONSULTING",
  "주식회사 ANP컨설팅",
  "advisor@anpc.co.kr",
  ...Array.from({ length: 12 }, (_, index) => `${index + 1}월`),
  ...ROADMAP_CATEGORIES.map(({ label }) => label),
  ...sampleRoadmap.programs.map(({ title }) => title),
]) assert.ok(slideXml.includes(text), `Required slide text is missing: ${text}`);

for (const program of sampleRoadmap.programs) {
  assert.ok(slideXml.includes(`name="anp.roadmap.program.${program.id}.text"`));
  assert.ok(slideXml.includes(`name="anp.roadmap.program.${program.id}.bar"`));
}
for (const forbidden of ["AIO Roadmap Studio", "로드맵 저장", "사업 카탈로그", "PDF로 인쇄", "PPTX 다운로드", "Premium", "Standard"]) {
  assert.equal(slideXml.includes(forbidden), false, `Authoring content leaked into PPTX: ${forbidden}`);
}
for (const font of ["NanumSquare AC", "Pretendard", "Arial"]) assert.ok(slideXml.includes(font), `Font reference is missing: ${font}`);

const standardRoadmap = {
  ...sampleRoadmap,
  tier: "standard",
  programs: sampleRoadmap.programs.filter(({ category }) => category !== "certification"),
};
const standardArtifacts = await createVerifiedArtifacts(standardRoadmap);
const standardSlideCount = (standardArtifacts.presentationXml.match(/<p:sldId\b/g) || []).length;
const standardProgramTextCount = (standardArtifacts.slideXml.match(/name="anp\.roadmap\.program\.[^"]+\.text"/g) || []).length;
assert.equal(standardSlideCount, 1, "Standard PPTX must contain exactly one slide");
assert.equal(standardArtifacts.layout.sections.length, 4);
assert.equal(standardArtifacts.layout.sections.reduce((total, section) => total + section.lanes.length, 0), 10);
assert.equal(standardProgramTextCount, standardRoadmap.programs.length);
for (const { label } of ROADMAP_TIERS.standard.categories) {
  assert.ok(standardArtifacts.slideXml.includes(label), `Standard category text is missing: ${label}`);
}
for (const program of standardRoadmap.programs) {
  assert.ok(standardArtifacts.slideXml.includes(program.title), `Standard program text is missing: ${program.title}`);
}
for (const forbidden of ["기업인증", "Premium", "Standard", "AIO Roadmap Studio"]) {
  assert.equal(standardArtifacts.slideXml.includes(forbidden), false, `Forbidden Standard PPTX text is present: ${forbidden}`);
}

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(standardOutputPath), { recursive: true });
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(outputPath, pptx);
await writeFile(standardOutputPath, standardArtifacts.pptx);
const report = {
  result: "passed",
  file: outputPath,
  bytes: pptx.length,
  page: { widthMm: PPTX_LAYOUT.page.widthMm, heightMm: PPTX_LAYOUT.page.heightMm, ...page },
  slides: slideCount,
  objects: {
    shapes: shapeCount,
    text: textObjectCount,
    lines: lineObjectCount,
    programText: programTextNames.length,
    programBars: programBarNames.length,
    programAmounts: programAmountNames.length,
    images: imageExtents.length,
  },
  stableProgramMetadata: true,
  fullSlideScreenshotAbsent: true,
  authoringBrandingAbsent: true,
  referencedFonts: ["NanumSquare AC", "Pretendard", "Arial"],
  tiers: {
    premium: { sections: layout.sections.length, lanes: layout.sections.reduce((total, section) => total + section.lanes.length, 0) },
    standard: {
      file: standardOutputPath,
      bytes: standardArtifacts.pptx.length,
      sections: standardArtifacts.layout.sections.length,
      lanes: standardArtifacts.layout.sections.reduce((total, section) => total + section.lanes.length, 0),
      programText: standardProgramTextCount,
      certificationAbsent: true,
      tierBrandingAbsent: true,
    },
  },
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
