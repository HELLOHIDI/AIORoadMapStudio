import PptxGenJS from "pptxgenjs";
import { formatAmount } from "./amount.js";

const MM_PER_INCH = 25.4;
const POINTS_PER_INCH = 72;

export const PPTX_LAYOUT = Object.freeze({
  name: "ANP_A4_LANDSCAPE",
  page: Object.freeze({ widthMm: 297, heightMm: 210 }),
  content: Object.freeze({ leftMm: 11.7, rightMm: 6.7 }),
  headerHeightMm: 37.8,
  categoryWidthMm: 21,
  monthHeightMm: 10.2,
  laneHeightMm: 10.287,
  notesHeightMm: 18.9,
  footerHeightMm: 16.7,
});

export const PPTX_PROGRAM_TEXT = Object.freeze({
  labelFontSizePt: 6,
  amountFontSizePt: 4,
  labelLeftPt: 0.5,
  amountGapPt: 1,
  labelHeightMm: 3.45,
  amountHeightMm: 2,
  amountTopFromBarMm: 5.42,
});

export class RoadmapPptxError extends Error {
  constructor(code, message, errors = []) {
    super(message);
    this.name = "RoadmapPptxError";
    this.code = code;
    this.errors = errors;
  }
}

export function mm(value) {
  return value / MM_PER_INCH;
}

function pointMm(value) {
  return value * MM_PER_INCH / POINTS_PER_INCH;
}

function labelText(section, item) {
  return `[${section.label}] ${item.title}`;
}

export function estimateProgramLabelWidthMm(text) {
  let emWidth = 0;
  for (const character of text) {
    if (/\s/u.test(character)) emWidth += 0.3;
    else if (/^[\[\](){}]$/u.test(character)) emWidth += 0.35;
    else if (/^[\u3131-\uD79D\u3400-\u9FFF]$/u.test(character)) emWidth += 0.86;
    else if (/^[A-Za-z0-9]$/u.test(character)) emWidth += 0.52;
    else emWidth += 0.6;
  }
  return pointMm(emWidth * PPTX_PROGRAM_TEXT.labelFontSizePt);
}

export async function measureProgramLabelWidthsMm(layout, documentImplementation = globalThis.document) {
  const labels = layout.sections.flatMap((section) => section.lanes.flatMap(
    (lane) => lane.map((item) => [item.id, labelText(section, item)]),
  ));
  const fallback = Object.fromEntries(labels.map(([id, text]) => [id, estimateProgramLabelWidthMm(text)]));
  if (!documentImplementation?.createElement) return fallback;

  try {
    const font = `700 ${PPTX_PROGRAM_TEXT.labelFontSizePt}pt "NanumSquare AC"`;
    const loadedFonts = await documentImplementation.fonts?.load?.(font, "가나다라마바사");
    if (loadedFonts && loadedFonts.length === 0) return fallback;
    const context = documentImplementation.createElement("canvas").getContext("2d");
    if (!context) return fallback;
    context.font = font;
    return Object.fromEntries(labels.map(([id, text]) => [
      id,
      context.measureText(text).width * MM_PER_INCH / 96,
    ]));
  } catch {
    return fallback;
  }
}

function color(value) {
  return value.replace(/^#/, "").toUpperCase();
}

function objectName(...parts) {
  return ["anp", "roadmap", ...parts]
    .map((part) => String(part).replace(/[\r\n\t]+/g, " ").trim())
    .join(".");
}

function addLine(slide, shapeType, role, x, y, w, h, lineColor, widthPt) {
  slide.addShape(shapeType, {
    x: mm(x), y: mm(y), w: mm(w), h: mm(h),
    line: { color: color(lineColor), width: widthPt },
    objectName: objectName("line", role),
  });
}

function addText(slide, text, role, x, y, w, h, options = {}) {
  slide.addText(text, {
    x: mm(x), y: mm(y), w: mm(w), h: mm(h),
    margin: 0,
    breakLine: false,
    fontFace: "NanumSquare AC",
    color: "111111",
    lang: "ko-KR",
    fit: "shrink",
    valign: "mid",
    objectName: objectName("text", role),
    ...options,
  });
}

function assertExportableLayout(layout) {
  if (!layout || !Array.isArray(layout.sections) || !layout.document) {
    throw new RoadmapPptxError("E_PPTX_LAYOUT_REQUIRED", "PPTX를 만들 로드맵 배치 정보가 없습니다.");
  }
  if (layout.errors?.length) {
    throw new RoadmapPptxError(
      "E_PPTX_LAYOUT_INVALID",
      "로드맵의 입력 또는 배치 오류를 해결한 뒤 PPTX로 내보내 주세요.",
      layout.errors,
    );
  }
}

function addHeader(presentation, slide, layout, logoData) {
  const { leftMm } = PPTX_LAYOUT.content;
  const contentWidth = PPTX_LAYOUT.page.widthMm - leftMm - PPTX_LAYOUT.content.rightMm;
  const logoWidth = 31;
  const logoHeight = logoWidth * 36 / 166;

  slide.addImage({
    data: logoData,
    x: mm(leftMm),
    y: mm(PPTX_LAYOUT.headerHeightMm - 1.35 - logoHeight),
    w: mm(logoWidth),
    h: mm(logoHeight),
    objectName: objectName("image", "anp-logo"),
    altText: "ANP Consulting",
  });

  addText(
    slide,
    `올인원 컨설팅 서비스 연간 로드맵_${layout.document.clientName || "클라이언트명"}`,
    "document-title",
    leftMm + 37,
    20.8,
    contentWidth - 74,
    7.2,
    { align: "center", bold: true, fontSize: 16, breakLine: false },
  );
  addText(
    slide,
    "Road to funds",
    "road-to-funds",
    leftMm + contentWidth - 42.4,
    29.2,
    40,
    4,
    { align: "right", fontSize: 7 },
  );

  presentation.title = `올인원 컨설팅 서비스 연간 로드맵_${layout.document.clientName || "클라이언트명"}`;
}

function addMonthRow(slide, shapeType) {
  const { leftMm } = PPTX_LAYOUT.content;
  const contentWidth = PPTX_LAYOUT.page.widthMm - leftMm - PPTX_LAYOUT.content.rightMm;
  const timelineWidth = contentWidth - PPTX_LAYOUT.categoryWidthMm;
  const monthWidth = timelineWidth / 12;
  const rowY = PPTX_LAYOUT.headerHeightMm;

  slide.addShape(shapeType.rect, {
    x: mm(leftMm), y: mm(rowY), w: mm(contentWidth), h: mm(PPTX_LAYOUT.monthHeightMm),
    fill: { color: "F2F2F2" },
    line: { transparency: 100 },
    objectName: objectName("shape", "month-row-background"),
  });
  addText(slide, "구분", "month-category-heading", leftMm, rowY, PPTX_LAYOUT.categoryWidthMm, PPTX_LAYOUT.monthHeightMm, {
    align: "center", bold: true, fontSize: 7,
  });

  for (let index = 0; index < 12; index += 1) {
    const monthX = leftMm + PPTX_LAYOUT.categoryWidthMm + index * monthWidth;
    addText(slide, `${index + 1}월`, `month-${index + 1}`, monthX, rowY, monthWidth, PPTX_LAYOUT.monthHeightMm, {
      align: "center", bold: true, fontSize: 7,
    });
    if (index < 11) {
      addLine(slide, shapeType.line, `month-${index + 1}-divider`, monthX + monthWidth, rowY, 0, PPTX_LAYOUT.monthHeightMm, "979797", 0.45);
    }
  }

  addLine(slide, shapeType.line, "table-top", leftMm, rowY, contentWidth, 0, "181818", 0.55);
  addLine(slide, shapeType.line, "month-category-divider", leftMm + PPTX_LAYOUT.categoryWidthMm, rowY, 0, PPTX_LAYOUT.monthHeightMm, "7C7C7C", 0.45);
  addLine(slide, shapeType.line, "month-row-bottom", leftMm, rowY + PPTX_LAYOUT.monthHeightMm, contentWidth, 0, "7C7C7C", 0.45);
}

function roadmapBodyHeightMm(layout) {
  return layout.sections.reduce((total, section) => total + section.lanes.length, 0) * PPTX_LAYOUT.laneHeightMm;
}

function addWatermark(slide, layout) {
  const { leftMm } = PPTX_LAYOUT.content;
  const contentWidth = PPTX_LAYOUT.page.widthMm - leftMm - PPTX_LAYOUT.content.rightMm;
  const timelineWidth = contentWidth - PPTX_LAYOUT.categoryWidthMm;
  const bodyY = PPTX_LAYOUT.headerHeightMm + PPTX_LAYOUT.monthHeightMm;
  const bodyHeight = roadmapBodyHeightMm(layout);

  addText(
    slide,
    "ANP CONSULTING",
    "watermark",
    leftMm + PPTX_LAYOUT.categoryWidthMm,
    bodyY + bodyHeight / 2 - 9,
    timelineWidth,
    18,
    {
      align: "center",
      bold: true,
      fontFace: "Arial",
      fontSize: 37,
      color: "12214B",
      transparency: 93,
    },
  );
}

function addProgram(slide, shapeType, section, item, laneY, timelineLeft, timelineWidth, programLabelWidthsMm) {
  const barX = timelineLeft + item.startOffset * (timelineWidth / 12) + 0.7;
  const barWidth = Math.max(3, item.span * (timelineWidth / 12) - 1.4);
  const barY = laneY + PPTX_LAYOUT.laneHeightMm - 0.8 - 2.1;
  const textX = barX + pointMm(PPTX_PROGRAM_TEXT.labelLeftPt);
  const textY = barY - PPTX_PROGRAM_TEXT.labelHeightMm;
  const textWidth = timelineLeft + timelineWidth - textX;
  const label = labelText(section, item);

  slide.addText(label, {
    x: mm(textX),
    y: mm(textY),
    w: mm(textWidth),
    h: mm(PPTX_PROGRAM_TEXT.labelHeightMm),
    margin: 0,
    breakLine: false,
    fit: "shrink",
    valign: "bottom",
    wrap: false,
    bold: true,
    fontFace: "NanumSquare AC",
    fontSize: PPTX_PROGRAM_TEXT.labelFontSizePt,
    color: "111111",
    lang: "ko-KR",
    objectName: objectName("program", item.id, "text"),
  });
  if (item.amountKrw != null) {
    const labelWidthMm = programLabelWidthsMm?.[item.id] ?? estimateProgramLabelWidthMm(label);
    const amountX = textX + labelWidthMm + pointMm(PPTX_PROGRAM_TEXT.amountGapPt);
    slide.addText(formatAmount(item.amountKrw), {
      x: mm(amountX),
      y: mm(barY - PPTX_PROGRAM_TEXT.amountTopFromBarMm),
      w: mm(Math.max(3, timelineLeft + timelineWidth - amountX)),
      h: mm(PPTX_PROGRAM_TEXT.amountHeightMm),
      margin: 0,
      breakLine: false,
      fit: "shrink",
      valign: "top",
      wrap: false,
      fontFace: "Pretendard",
      fontSize: PPTX_PROGRAM_TEXT.amountFontSizePt,
      color: "111111",
      lang: "ko-KR",
      objectName: objectName("program", item.id, "amount"),
    });
  }
  slide.addShape(shapeType.roundRect, {
    x: mm(barX), y: mm(barY), w: mm(barWidth), h: mm(2.1),
    fill: { color: color(section.color) },
    line: { color: color(section.color), transparency: 100 },
    rectRadius: 1,
    objectName: objectName("program", item.id, "bar"),
  });
}

function addRoadmapBody(slide, shapeType, layout, programLabelWidthsMm) {
  const { leftMm } = PPTX_LAYOUT.content;
  const contentWidth = PPTX_LAYOUT.page.widthMm - leftMm - PPTX_LAYOUT.content.rightMm;
  const timelineLeft = leftMm + PPTX_LAYOUT.categoryWidthMm;
  const timelineWidth = contentWidth - PPTX_LAYOUT.categoryWidthMm;
  let sectionY = PPTX_LAYOUT.headerHeightMm + PPTX_LAYOUT.monthHeightMm;

  addWatermark(slide, layout);

  for (const section of layout.sections) {
    const sectionHeight = section.lanes.length * PPTX_LAYOUT.laneHeightMm;
    slide.addShape(shapeType.rect, {
      x: mm(leftMm), y: mm(sectionY), w: mm(PPTX_LAYOUT.categoryWidthMm), h: mm(sectionHeight),
      fill: { color: "F2F2F2", transparency: 8 },
      line: { transparency: 100 },
      objectName: objectName("shape", "category-background", section.key),
    });
    addText(slide, section.label, `category-${section.key}`, leftMm, sectionY, PPTX_LAYOUT.categoryWidthMm, sectionHeight, {
      align: "center", bold: true, fontSize: 6,
    });
    addLine(slide, shapeType.line, `category-${section.key}-right`, timelineLeft, sectionY, 0, sectionHeight, "A0A0A0", 0.45);
    if (section !== layout.sections.at(-1)) {
      addLine(slide, shapeType.line, `category-${section.key}-bottom`, leftMm, sectionY + sectionHeight, PPTX_LAYOUT.categoryWidthMm, 0, "B9B9B9", 0.35);
    }

    section.lanes.forEach((lane, laneIndex) => {
      const laneY = sectionY + laneIndex * PPTX_LAYOUT.laneHeightMm;
      lane.forEach((item) => addProgram(
        slide,
        shapeType,
        section,
        item,
        laneY,
        timelineLeft,
        timelineWidth,
        programLabelWidthsMm,
      ));
    });
    sectionY += sectionHeight;
  }

  addLine(slide, shapeType.line, "table-bottom", leftMm, sectionY, contentWidth, 0, "181818", 1.1);
  return sectionY;
}

function addNotesAndFooter(slide, shapeType, tableBottomY) {
  const { leftMm } = PPTX_LAYOUT.content;
  const contentWidth = PPTX_LAYOUT.page.widthMm - leftMm - PPTX_LAYOUT.content.rightMm;
  const notesY = tableBottomY;
  const notesTextY = notesY + 7.1;

  addText(
    slide,
    "* 기타 사업의 경우 민간·인증에 따라 매년 새로 공고되는 지원사업을 탐색 후 맞춤식 지원을 도와드립니다.",
    "note-1",
    leftMm + 4,
    notesTextY,
    contentWidth - 8,
    3.7,
    { fontSize: 7, color: "818181", valign: "top" },
  );
  addText(
    slide,
    "* 위 로드맵에 표기된 시기는 공고 및 지원금액에 따라 일부 조정될 수 있습니다.",
    "note-2",
    leftMm + 4,
    notesTextY + 3.7,
    contentWidth - 8,
    3.7,
    { fontSize: 7, color: "818181", valign: "top" },
  );
  addLine(slide, shapeType.line, "notes-bottom", leftMm, notesY + PPTX_LAYOUT.notesHeightMm, contentWidth, 0, "C9C9C9", 0.35);

  addText(
    slide,
    "주식회사 ANP컨설팅   |   서울시 강서구 공항대로45길75,제일빌딩 6층   |   E. advisor@anpc.co.kr",
    "footer",
    leftMm,
    notesY + PPTX_LAYOUT.notesHeightMm,
    contentWidth,
    PPTX_LAYOUT.footerHeightMm,
    { align: "center", fontSize: 7 },
  );
}

export function createRoadmapPresentation(layout, { logoData, programLabelWidthsMm } = {}) {
  assertExportableLayout(layout);
  if (!logoData) {
    throw new RoadmapPptxError("E_PPTX_LOGO_REQUIRED", "ANP Consulting 로고를 불러오지 못했습니다.");
  }
  const presentation = new PptxGenJS();
  presentation.defineLayout({
    name: PPTX_LAYOUT.name,
    width: mm(PPTX_LAYOUT.page.widthMm),
    height: mm(PPTX_LAYOUT.page.heightMm),
  });
  presentation.layout = PPTX_LAYOUT.name;
  presentation.author = "ANP Consulting";
  presentation.company = "ANP Consulting";
  presentation.subject = "연간 정부지원사업 로드맵";
  presentation.revision = "1";
  presentation.theme = { headFontFace: "NanumSquare AC", bodyFontFace: "NanumSquare AC" };

  const slide = presentation.addSlide();
  slide.background = { color: "FFFFFF" };
  const shapeType = presentation.ShapeType;
  addHeader(presentation, slide, layout, logoData);
  addMonthRow(slide, shapeType);
  const tableBottomY = addRoadmapBody(slide, shapeType, layout, programLabelWidthsMm);
  addNotesAndFooter(slide, shapeType, tableBottomY);
  return presentation;
}

export function sanitizePptxFileName(clientName) {
  const safeClient = String(clientName || "클라이언트명")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 60) || "클라이언트명";
  return `ANP_올인원_컨설팅_연간_로드맵_${safeClient}.pptx`;
}

async function loadImageDataUri(url, fetchImplementation) {
  const response = await fetchImplementation(url);
  if (!response.ok) throw new RoadmapPptxError("E_PPTX_LOGO_FETCH", "ANP Consulting 로고를 불러오지 못했습니다.");
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener("error", () => reject(new RoadmapPptxError("E_PPTX_LOGO_READ", "ANP Consulting 로고를 읽지 못했습니다.")), { once: true });
    reader.readAsDataURL(blob);
  });
}

export async function exportRoadmapPptx({
  layout,
  fileName = sanitizePptxFileName(layout?.document?.clientName),
  logoUrl = "/assets/anp-consulting-logo.png",
  fetchImplementation = globalThis.fetch,
  documentImplementation = globalThis.document,
} = {}) {
  assertExportableLayout(layout);
  if (typeof fetchImplementation !== "function") {
    throw new RoadmapPptxError("E_PPTX_FETCH_UNAVAILABLE", "PPTX에 넣을 로고를 불러올 수 없는 환경입니다.");
  }
  const [logoData, programLabelWidthsMm] = await Promise.all([
    loadImageDataUri(logoUrl, fetchImplementation),
    measureProgramLabelWidthsMm(layout, documentImplementation),
  ]);
  const presentation = createRoadmapPresentation(layout, { logoData, programLabelWidthsMm });
  await presentation.writeFile({ fileName, compression: true });
  return fileName;
}
