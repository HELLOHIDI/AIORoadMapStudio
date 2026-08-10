const categoryDefinitions = Object.freeze([
  Object.freeze({ key: "consulting", label: "컨설팅", maxRows: 2, color: "#BFBFBF", tiers: Object.freeze(["premium", "standard"]) }),
  Object.freeze({ key: "business", label: "사업화", maxRows: 4, color: "#5B9BD5", tiers: Object.freeze(["premium", "standard"]) }),
  Object.freeze({ key: "voucher", label: "바우처", maxRows: 2, color: "#FFC000", tiers: Object.freeze(["premium", "standard"]) }),
  Object.freeze({ key: "ip", label: "IP", maxRows: 2, color: "#F86828", tiers: Object.freeze(["premium", "standard"]) }),
  Object.freeze({ key: "certification", label: "기업인증", maxRows: 1, color: "#70AD47", tiers: Object.freeze(["premium"]) }),
]);

export const ROADMAP_CATEGORIES = Object.freeze(categoryDefinitions
  .map(({ key, label, maxRows, color }) => Object.freeze({ key, label, maxRows, color })));
const categoryByKey = new Map(ROADMAP_CATEGORIES.map((category) => [category.key, category]));
const tierKeys = [...new Set(categoryDefinitions.flatMap(({ tiers }) => tiers))];

export const ROADMAP_TIERS = Object.freeze(Object.fromEntries(tierKeys.map((tier) => [
  tier,
  Object.freeze({
    key: tier,
    categories: Object.freeze(categoryDefinitions
      .filter(({ tiers }) => tiers.includes(tier))
      .map(({ key }) => categoryByKey.get(key))),
  }),
])));

const roadmapTierSet = new Set(Object.keys(ROADMAP_TIERS));

function error(code, path, message, programId) {
  return { code, path, message, ...(programId ? { programId } : {}) };
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value;
}

function normalizeDocument(input) {
  const tier = roadmapTierSet.has(input?.tier) ? input.tier : "premium";
  return {
    tier,
    clientName: normalizeText(input?.clientName),
    programs: Array.isArray(input?.programs)
      ? input.programs.map((program) => ({
          ...program,
          id: normalizeText(program?.id),
          title: normalizeText(program?.title),
        }))
      : [],
  };
}

export function resolveRoadmapTier(input) {
  return roadmapTierSet.has(input?.tier) ? input.tier : "premium";
}

export function allowedCategoriesForTier(tier) {
  return ROADMAP_TIERS[roadmapTierSet.has(tier) ? tier : "premium"].categories;
}

function validateProgram(program, index, seenIds, allowedCategoryKeys) {
  const errors = [];
  const path = `programs[${index}]`;
  const id = program?.id;

  if (!id) errors.push(error("E_PROGRAM_ID_REQUIRED", `${path}.id`, "프로그램 ID가 필요합니다."));
  else if (seenIds.has(id)) errors.push(error("E_PROGRAM_ID_DUPLICATE", `${path}.id`, "프로그램 ID가 중복되었습니다.", id));
  else seenIds.add(id);

  if (!categoryByKey.has(program?.category)) {
    errors.push(error("E_CATEGORY_UNKNOWN", `${path}.category`, "지원하지 않는 구분입니다.", id));
  } else if (!allowedCategoryKeys.has(program.category)) {
    errors.push(error("E_CATEGORY_FORBIDDEN_FOR_TIER", `${path}.category`, `${program.title || id || path} is not supported for this roadmap tier.`, id));
  }
  if (!program?.title) errors.push(error("E_TITLE_REQUIRED", `${path}.title`, "사업명이 필요합니다.", id));

  const validStart = Number.isInteger(program?.startMonth) && program.startMonth >= 1 && program.startMonth <= 12;
  const validEnd = Number.isInteger(program?.endMonth) && program.endMonth >= 1 && program.endMonth <= 12;
  if (!validStart || !validEnd || program.startMonth > program.endMonth) {
    errors.push(error("E_MONTH_RANGE", `${path}.startMonth`, "시작월과 종료월은 1~12의 정수이며 시작월이 종료월보다 늦을 수 없습니다.", id));
  }

  if (program?.amountKrw != null && (!Number.isSafeInteger(program.amountKrw) || program.amountKrw < 1_000_000)) {
    errors.push(error("E_AMOUNT_INVALID", `${path}.amountKrw`, "금액은 1백만원 이상의 안전한 정수여야 합니다.", id));
  }
  if (!Number.isSafeInteger(program?.sequence) || program.sequence < 0) {
    errors.push(error("E_SEQUENCE_INVALID", `${path}.sequence`, "정렬 순서는 0 이상의 안전한 정수여야 합니다.", id));
  }

  return errors;
}

export function validateRoadmapDocument(input) {
  const document = normalizeDocument(input);
  const errors = [];
  if (input?.tier !== undefined && !roadmapTierSet.has(input.tier)) {
    errors.push(error("E_TIER_UNSUPPORTED", "tier", "Unsupported roadmap tier."));
  }
  if (!document.clientName) errors.push(error("E_CLIENT_NAME_REQUIRED", "clientName", "클라이언트명이 필요합니다."));
  if (!Array.isArray(input?.programs)) errors.push(error("E_PROGRAMS_REQUIRED", "programs", "프로그램 목록이 필요합니다."));

  const seenIds = new Set();
  const allowedCategoryKeys = new Set(allowedCategoriesForTier(document.tier).map((category) => category.key));
  document.programs.forEach((program, index) => errors.push(...validateProgram(program, index, seenIds, allowedCategoryKeys)));
  return { document, errors };
}

function overlaps(a, b) {
  return a.startMonth <= b.endMonth && b.startMonth <= a.endMonth;
}

function programOrder(a, b) {
  return a.startMonth - b.startMonth
    || a.endMonth - b.endMonth
    || a.sequence - b.sequence
    || a.id.localeCompare(b.id);
}

function hasValidLaneIndex(program, category) {
  return Number.isInteger(program?.laneIndex) && program.laneIndex >= 0 && program.laneIndex < category.maxRows;
}

function placedProgram(program, rowIndex) {
  return {
    ...program,
    rowIndex,
    startOffset: program.startMonth - 1,
    span: program.endMonth - program.startMonth + 1,
  };
}

function hasValidMonthRange(program) {
  return Number.isInteger(program?.startMonth) && program.startMonth >= 1 && program.startMonth <= 12
    && Number.isInteger(program?.endMonth) && program.endMonth >= 1 && program.endMonth <= 12
    && program.startMonth <= program.endMonth;
}

export function buildRoadmapLayout(input) {
  const { document, errors } = validateRoadmapDocument(input);
  const invalidIds = new Set(errors.map((item) => item.programId).filter(Boolean));
  const sections = allowedCategoriesForTier(document.tier).map((category) => ({
    ...category,
    lanes: Array.from({ length: category.maxRows }, () => []),
  }));

  for (const section of sections) {
    const programs = document.programs
      .filter((program) => program.category === section.key && !invalidIds.has(program.id))
      .sort(programOrder);

    for (const program of programs.filter((item) => hasValidLaneIndex(item, section))) {
      const lane = section.lanes[program.laneIndex];
      if (lane.some((placed) => overlaps(placed, program))) {
        errors.push(error("E_ROW_CAPACITY", `programs.${program.id}`, `${section.label}의 최대 행 수를 초과했습니다.`, program.id));
        continue;
      }
      lane.push(placedProgram(program, program.laneIndex));
    }

    for (const program of programs.filter((item) => !hasValidLaneIndex(item, section))) {
      const rowIndex = section.lanes.findIndex((lane) => lane.every((placed) => !overlaps(placed, program)));
      if (rowIndex === -1) {
        errors.push(error("E_ROW_CAPACITY", `programs.${program.id}`, `${section.label}의 최대 행 수를 초과했습니다.`, program.id));
        continue;
      }
      section.lanes[rowIndex].push(placedProgram(program, rowIndex));
    }
  }

  return { document, sections, errors };
}

export function moveProgramToLane({ programs, programId, targetLaneIndex, tier = "premium" }) {
  const program = programs.find((item) => item.id === programId);
  const allowedCategoryKeys = new Set(allowedCategoriesForTier(tier).map((category) => category.key));
  const category = allowedCategoryKeys.has(program?.category) ? categoryByKey.get(program?.category) : undefined;
  if (!program || !category || !Number.isInteger(targetLaneIndex) || targetLaneIndex < 0 || targetLaneIndex >= category.maxRows) {
    return { ok: false, programs, outcome: "rejected" };
  }

  const lanePrograms = programs
    .filter((item) => item.category === program.category && hasValidMonthRange(item))
    .map((item) => ({ ...item, title: item.title || "layout" }));
  if (!lanePrograms.some((item) => item.id === programId)) return { ok: false, programs, outcome: "rejected" };

  const layout = buildRoadmapLayout({ tier, clientName: "layout", programs: lanePrograms });

  const section = layout.sections.find((item) => item.key === program.category);
  const current = section.lanes.flat().find((item) => item.id === programId);
  if (!current) return { ok: false, programs, outcome: "rejected" };

  const conflicts = section.lanes[targetLaneIndex].filter((item) => item.id !== programId && overlaps(item, program));
  if (conflicts.length === 0) {
    return {
      ok: true,
      programs: programs.map((item) => item.id === programId ? { ...item, laneIndex: targetLaneIndex } : item),
      outcome: "moved",
    };
  }
  if (conflicts.length !== 1) return { ok: false, programs, outcome: "rejected" };

  const [conflict] = conflicts;
  const targetRest = section.lanes[targetLaneIndex].filter((item) => item.id !== programId && item.id !== conflict.id);
  const sourceRest = section.lanes[current.rowIndex].filter((item) => item.id !== programId && item.id !== conflict.id);
  const validSwap = targetRest.every((item) => !overlaps(item, program))
    && sourceRest.every((item) => !overlaps(item, conflict));
  if (!validSwap) return { ok: false, programs, outcome: "rejected" };

  return {
    ok: true,
    programs: programs.map((item) => {
      if (item.id === programId) return { ...item, laneIndex: targetLaneIndex };
      if (item.id === conflict.id) return { ...item, laneIndex: current.rowIndex };
      return item;
    }),
    outcome: "swapped",
  };
}
