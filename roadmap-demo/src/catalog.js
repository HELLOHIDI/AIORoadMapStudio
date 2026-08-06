import { ROADMAP_CATEGORIES } from "./roadmap-policy.js";

export const EMPTY_CATALOG_PROGRAM = Object.freeze({
  category: "business",
  title: "",
  link: "",
  amountKrw: "",
  startMonth: 1,
  endMonth: 1,
  target: "",
  details: "",
  industries: [],
  regions: [],
});

const categoryByLabel = new Map(ROADMAP_CATEGORIES.map(({ key, label }) => [label, key]));
const amountUnits = { 원: 1, 만원: 10_000, 백만원: 1_000_000, 천만원: 10_000_000, 억원: 100_000_000 };

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => value.trim()).filter(Boolean))];
}

function parseAmount(value) {
  const match = value.replaceAll(",", "").match(/([\d.]+)\s*(억원|천만원|백만원|만원|원)/);
  if (!match) return null;
  const amount = Number(match[1]) * amountUnits[match[2]];
  return Number.isSafeInteger(amount) ? amount : null;
}

export function parseCatalogText(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const firstLineIndex = lines.findIndex((line) => line.trim());
  const header = lines[firstLineIndex]?.trim().match(/^\[([^\]]+)]\s*(.+)$/);
  const values = {};
  const warnings = [];

  if (header) {
    values.title = header[2].trim();
    values.category = categoryByLabel.get(header[1].trim());
    if (!values.category) warnings.push(`구분 “${header[1].trim()}”을 확인해 주세요.`);
  } else {
    warnings.push("첫 줄을 [구분] 사업명 형식으로 입력해 주세요.");
  }

  const sections = {};
  let currentLabel = null;
  for (const line of lines.slice(firstLineIndex + 1)) {
    const field = line.match(/^\s*-?\s*(링크|지원기간|지원금액|지원대상|지원내용)\s*:\s*(.*)$/);
    if (field) {
      currentLabel = field[1];
      sections[currentLabel] = field[2].trim();
    } else if (currentLabel && line.trim()) {
      sections[currentLabel] = `${sections[currentLabel]}\n${line.trim()}`.trim();
    }
  }

  if (!values.title) warnings.push("사업명을 입력해 주세요.");

  if (!sections.링크) warnings.push("링크를 입력해 주세요.");
  else {
    try {
      const url = new URL(sections.링크);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error("protocol");
      values.link = sections.링크;
    } catch {
      warnings.push("링크에 http 또는 https 주소를 입력해 주세요.");
    }
  }

  if (sections.지원대상) values.target = sections.지원대상;
  else warnings.push("지원대상을 입력해 주세요.");
  if (sections.지원내용) values.details = sections.지원내용;
  else warnings.push("지원내용을 입력해 주세요.");

  if (!sections.지원기간) warnings.push("지원기간을 n~n월 형식으로 입력해 주세요.");
  else {
    const period = sections.지원기간.match(/(\d{1,2})\s*~\s*(\d{1,2})\s*월/);
    if (period && Number(period[1]) >= 1 && Number(period[2]) <= 12 && Number(period[1]) <= Number(period[2])) {
      [values.startMonth, values.endMonth] = [Number(period[1]), Number(period[2])];
    }
    else warnings.push("지원기간을 n~n월 형식으로 확인해 주세요.");
  }

  if (!sections.지원금액) warnings.push("지원금액을 n백만원 또는 n억원 형식으로 입력해 주세요.");
  else {
    const amountKrw = parseAmount(sections.지원금액);
    if (amountKrw === null || amountKrw < 1_000_000) warnings.push("지원금액을 n백만원 또는 n억원 형식으로 확인해 주세요.");
    else values.amountKrw = amountKrw;
  }

  return { values, warnings };
}

export function catalogPayload(values) {
  return {
    category: values.category,
    title: values.title.trim(),
    link: values.link.trim(),
    amountKrw: values.amountKrw === "" ? null : Number(values.amountKrw),
    startMonth: Number(values.startMonth),
    endMonth: Number(values.endMonth),
    target: values.target.trim(),
    details: values.details.trim(),
    industries: uniqueStrings(values.industries),
    regions: uniqueStrings(values.regions),
  };
}

export function copyCatalogProgram(program, sequence, createId = () => globalThis.crypto.randomUUID()) {
  return {
    id: createId(),
    category: program.category,
    title: program.title,
    link: program.link,
    amountKrw: program.amountKrw,
    startMonth: program.startMonth,
    endMonth: program.endMonth,
    target: program.target,
    details: program.details,
    sequence,
  };
}
