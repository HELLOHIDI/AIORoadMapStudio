const categoryDefinitions = Object.freeze([
  Object.freeze({ key: "consulting", label: "컨설팅", defaultLaneCount: 2, color: "#BFBFBF", tiers: Object.freeze(["premium", "standard"]) }),
  Object.freeze({ key: "business", label: "사업화", defaultLaneCount: 4, color: "#5B9BD5", tiers: Object.freeze(["premium", "standard"]) }),
  Object.freeze({ key: "voucher", label: "바우처", defaultLaneCount: 2, color: "#FFC000", tiers: Object.freeze(["premium", "standard"]) }),
  Object.freeze({ key: "ip", label: "IP", defaultLaneCount: 2, color: "#F86828", tiers: Object.freeze(["premium", "standard"]) }),
  Object.freeze({ key: "certification", label: "기업인증", defaultLaneCount: 1, color: "#70AD47", tiers: Object.freeze(["premium"]) }),
]);

export const ROADMAP_CATEGORIES = Object.freeze(categoryDefinitions
  .map(({ key, label, defaultLaneCount, color }) => Object.freeze({ key, label, defaultLaneCount, color })));
const categoryByKey = new Map(ROADMAP_CATEGORIES.map((category) => [category.key, category]));
const tierKeys = [...new Set(categoryDefinitions.flatMap(({ tiers }) => tiers))];

export const MAX_LANES_PER_CATEGORY = 4;
export const PREMIUM_TOTAL_LANES = 11;
export const PREMIUM_DEFAULT_LANE_COUNTS = Object.freeze({ consulting: 2, business: 4, voucher: 2, ip: 2, certification: 1 });
export const STANDARD_DEFAULT_LANE_COUNTS = Object.freeze({ consulting: 2, business: 4, voucher: 2, ip: 2 });

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
const premiumCategoryKeys = Object.keys(PREMIUM_DEFAULT_LANE_COUNTS);

function error(code, path, message, programId) {
  return { code, path, message, ...(programId ? { programId } : {}) };
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value;
}

function normalizeTextList(value) {
  return Array.isArray(value) ? [...new Set(value.map(normalizeText))] : [];
}

function normalizeClientProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return {
    industries: normalizeTextList(value.industries),
    regions: normalizeTextList(value.regions),
    isWomenOwned: value.isWomenOwned === true,
    tenure: normalizeText(value.tenure),
  };
}

function normalizeDocument(input) {
  const tier = roadmapTierSet.has(input?.tier) ? input.tier : "premium";
  const document = {
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
  const clientProfile = normalizeClientProfile(input?.clientProfile);
  return clientProfile ? { ...document, clientProfile } : document;
}

export function resolveRoadmapLaneCounts(input, { requireExplicit = false } = {}) {
  const tier = resolveRoadmapTier(input);
  const present = Object.hasOwn(input ?? {}, "laneCounts");
  if (tier === "standard") {
    return present
      ? { laneCounts: null, errors: [error("E_LANE_COUNTS_FORBIDDEN", "laneCounts", "Standard roadmaps use fixed lane counts.")] }
      : { laneCounts: { ...STANDARD_DEFAULT_LANE_COUNTS }, errors: [] };
  }
  if (!present) {
    return requireExplicit
      ? { laneCounts: null, errors: [error("E_LANE_COUNTS_REQUIRED", "laneCounts", "Premium lane counts are required.")] }
      : { laneCounts: { ...PREMIUM_DEFAULT_LANE_COUNTS }, errors: [] };
  }

  const value = input.laneCounts;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { laneCounts: null, errors: [error("E_LANE_COUNTS_TYPE", "laneCounts", "Lane counts must be an object.")] };
  }
  const keys = Object.keys(value);
  if (keys.length !== premiumCategoryKeys.length || premiumCategoryKeys.some((key) => !Object.hasOwn(value, key))) {
    return { laneCounts: null, errors: [error("E_LANE_COUNTS_KEYS", "laneCounts", "Lane counts must contain exactly the Premium categories.")] };
  }
  const invalidKey = premiumCategoryKeys.find((key) => !Number.isSafeInteger(value[key])
    || value[key] < 1 || value[key] > MAX_LANES_PER_CATEGORY);
  if (invalidKey) {
    return { laneCounts: null, errors: [error("E_LANE_COUNT_RANGE", `laneCounts.${invalidKey}`, "Each lane count must be an integer from 1 to 4.")] };
  }
  if (premiumCategoryKeys.reduce((total, key) => total + value[key], 0) !== PREMIUM_TOTAL_LANES) {
    return { laneCounts: null, errors: [error("E_LANE_COUNTS_TOTAL", "laneCounts", "Premium roadmaps must contain exactly 11 lanes.")] };
  }
  return { laneCounts: Object.fromEntries(premiumCategoryKeys.map((key) => [key, value[key]])), errors: [] };
}

export function resolveRoadmapTier(input) {
  return roadmapTierSet.has(input?.tier) ? input.tier : "premium";
}

export function allowedCategoriesForTier(tier) {
  return ROADMAP_TIERS[roadmapTierSet.has(tier) ? tier : "premium"].categories;
}

export function roadmapProgramLabel(program) {
  if (program?.category === "business" && program.displayCategory === "marketing") return "마케팅";
  return categoryByKey.get(program?.category)?.label ?? "";
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
  if (program?.displayCategory !== undefined && (program.category !== "business" || program.displayCategory !== "marketing")) {
    errors.push(error("E_DISPLAY_CATEGORY_INVALID", `${path}.displayCategory`, "마케팅 표시는 사업화 구분에서만 사용할 수 있습니다.", id));
  }

  const validStart = Number.isInteger(program?.startMonth) && program.startMonth >= 1 && program.startMonth <= 12;
  const validEnd = Number.isInteger(program?.endMonth) && program.endMonth >= 1 && program.endMonth <= 12;
  if (!validStart || !validEnd || program.startMonth > program.endMonth) {
    errors.push(error("E_MONTH_RANGE", `${path}.startMonth`, "시작월과 종료월은 1~12의 정수이며 시작월이 종료월보다 늦을 수 없습니다.", id));
  }

  if (program?.amountKrw != null && (!Number.isSafeInteger(program.amountKrw) || program.amountKrw <= 0)) {
    errors.push(error("E_AMOUNT_INVALID", `${path}.amountKrw`, "금액은 1원 이상의 안전한 정수여야 합니다.", id));
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

  const laneCountResult = resolveRoadmapLaneCounts(input, { requireExplicit: document.tier === "premium" });
  errors.push(...laneCountResult.errors);
  if (document.tier === "premium" && laneCountResult.laneCounts) document.laneCounts = laneCountResult.laneCounts;

  const seenIds = new Set();
  const allowedCategoryKeys = new Set(allowedCategoriesForTier(document.tier).map((category) => category.key));
  document.programs.forEach((program, index) => errors.push(...validateProgram(program, index, seenIds, allowedCategoryKeys)));
  return { document, errors, laneCounts: laneCountResult.laneCounts };
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

function hasValidLaneIndex(program, laneCount) {
  return Number.isInteger(program?.laneIndex) && program.laneIndex >= 0 && program.laneIndex < laneCount;
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
  const { document, errors, laneCounts } = validateRoadmapDocument(input);
  const invalidIds = new Set(errors.map((item) => item.programId).filter(Boolean));
  const sections = allowedCategoriesForTier(document.tier).map((category) => ({
    ...category,
    laneCount: laneCounts?.[category.key] ?? 0,
    lanes: Array.from({ length: laneCounts?.[category.key] ?? 0 }, () => []),
  }));

  for (const section of sections) {
    const programs = document.programs
      .filter((program) => program.category === section.key && !invalidIds.has(program.id))
      .sort(programOrder);

    for (const program of programs.filter((item) => hasValidLaneIndex(item, section.laneCount))) {
      const lane = section.lanes[program.laneIndex];
      if (lane.some((placed) => overlaps(placed, program))) {
        errors.push(error("E_ROW_CAPACITY", `programs.${program.id}`, `“${program.title || program.id}”은 ${section.label}의 최대 행 수를 초과해 로드맵에 배치되지 않았습니다.`, program.id));
        continue;
      }
      lane.push(placedProgram(program, program.laneIndex));
    }

    for (const program of programs.filter((item) => !hasValidLaneIndex(item, section.laneCount))) {
      const rowIndex = section.lanes.findIndex((lane) => lane.every((placed) => !overlaps(placed, program)));
      if (rowIndex === -1) {
        errors.push(error("E_ROW_CAPACITY", `programs.${program.id}`, `“${program.title || program.id}”은 ${section.label}의 최대 행 수를 초과해 로드맵에 배치되지 않았습니다.`, program.id));
        continue;
      }
      section.lanes[rowIndex].push(placedProgram(program, rowIndex));
    }
  }

  return { document, sections, errors };
}

function rejectedLaneTransfer(document, reason) {
  return { ok: false, document, reason };
}

export function transferRoadmapLane({ document, sourceCategory, sourceLaneIndex, targetCategory }) {
  if (!Array.isArray(document?.programs)) return rejectedLaneTransfer(document, "E_LANE_TRANSFER_SOURCE_UNRESOLVED");
  if (document?.tier !== "premium") return rejectedLaneTransfer(document, "E_LANE_TRANSFER_TIER");

  const { laneCounts, errors } = resolveRoadmapLaneCounts(document, { requireExplicit: true });
  if (errors.length) return rejectedLaneTransfer(document, errors[0].code);
  if (!premiumCategoryKeys.includes(sourceCategory) || !premiumCategoryKeys.includes(targetCategory)) {
    return rejectedLaneTransfer(document, "E_LANE_TRANSFER_CATEGORY");
  }
  if (sourceCategory === targetCategory) return rejectedLaneTransfer(document, "E_LANE_TRANSFER_SAME_CATEGORY");
  if (!Number.isInteger(sourceLaneIndex) || sourceLaneIndex < 0 || sourceLaneIndex >= laneCounts[sourceCategory]) {
    return rejectedLaneTransfer(document, "E_LANE_TRANSFER_SOURCE_INDEX");
  }
  if (laneCounts[sourceCategory] <= 1) return rejectedLaneTransfer(document, "E_LANE_TRANSFER_SOURCE_MINIMUM");
  if (laneCounts[targetCategory] >= MAX_LANES_PER_CATEGORY) {
    return rejectedLaneTransfer(document, "E_LANE_TRANSFER_TARGET_MAXIMUM");
  }

  const sourcePrograms = document.programs.filter((program) => program?.category === sourceCategory);
  if (sourcePrograms.some((program) => !Number.isSafeInteger(program?.sequence) || program.sequence < 0)) {
    return rejectedLaneTransfer(document, "E_LANE_TRANSFER_SOURCE_UNRESOLVED");
  }
  if (sourcePrograms.some((program) => Object.hasOwn(program ?? {}, "laneIndex") && !Number.isSafeInteger(program.laneIndex))) {
    return rejectedLaneTransfer(document, "E_LANE_TRANSFER_SOURCE_UNRESOLVED");
  }
  const normalizedIds = document.programs.map((program) => normalizeText(program?.id));
  if (sourcePrograms.some((program) => {
    const id = normalizeText(program?.id);
    return !id || normalizedIds.filter((item) => item === id).length !== 1;
  })) return rejectedLaneTransfer(document, "E_LANE_TRANSFER_SOURCE_UNRESOLVED");

  const sourceLayout = buildRoadmapLayout({
    tier: "premium",
    clientName: "layout",
    laneCounts,
    programs: sourcePrograms.map((program) => ({
      ...program,
      title: program.title || "layout",
      amountKrw: Number.isSafeInteger(program.amountKrw) && program.amountKrw > 0 ? program.amountKrw : null,
      ...(program.category === "business" && program.displayCategory === "marketing" ? {} : { displayCategory: undefined }),
    })),
  });
  const sourceSection = sourceLayout.sections.find((section) => section.key === sourceCategory);
  const resolvedById = new Map(sourceSection?.lanes.flat().map((program) => [program.id, program.rowIndex]));
  if (!sourceSection || sourcePrograms.some((program) => !resolvedById.has(normalizeText(program.id)))) {
    return rejectedLaneTransfer(document, "E_LANE_TRANSFER_SOURCE_UNRESOLVED");
  }
  if (sourceSection.lanes[sourceLaneIndex].length) {
    return rejectedLaneTransfer(document, "E_LANE_TRANSFER_SOURCE_OCCUPIED");
  }

  const nextLaneCounts = { ...laneCounts };
  nextLaneCounts[sourceCategory] -= 1;
  nextLaneCounts[targetCategory] += 1;
  const nextPrograms = document.programs.map((program) => {
    if (program.category !== sourceCategory || !Object.hasOwn(program, "laneIndex")) return program;
    const resolvedRow = resolvedById.get(normalizeText(program.id));
    const currentRow = program.laneIndex >= 0 && program.laneIndex < laneCounts[sourceCategory]
      ? program.laneIndex
      : resolvedRow;
    return { ...program, laneIndex: currentRow > sourceLaneIndex ? currentRow - 1 : currentRow };
  });
  const nextDocument = { ...document, laneCounts: nextLaneCounts, programs: nextPrograms };

  const nextSourcePrograms = nextPrograms.filter((program) => program.category === sourceCategory);
  const invalidExplicitIndex = nextSourcePrograms.some((program) => Object.hasOwn(program, "laneIndex")
    && (!Number.isInteger(program.laneIndex) || program.laneIndex < 0 || program.laneIndex >= nextLaneCounts[sourceCategory]));
  if (invalidExplicitIndex) return rejectedLaneTransfer(document, "E_LANE_TRANSFER_POSTCONDITION");
  return { ok: true, document: nextDocument, outcome: "transferred" };
}

export function moveProgramToLane({ document, programId, targetLaneIndex }) {
  const reject = () => ({ ok: false, document, outcome: "rejected" });
  const programs = document?.programs ?? [];
  const tier = resolveRoadmapTier(document);
  const { laneCounts, errors: laneCountErrors } = resolveRoadmapLaneCounts(document, { requireExplicit: tier === "premium" });
  const program = programs.find((item) => item.id === programId);
  const allowedCategoryKeys = new Set(allowedCategoriesForTier(tier).map((category) => category.key));
  const category = allowedCategoryKeys.has(program?.category) ? categoryByKey.get(program?.category) : undefined;
  if (laneCountErrors.length || !program || !category || !Number.isInteger(targetLaneIndex)
    || targetLaneIndex < 0 || targetLaneIndex >= laneCounts[category.key]) {
    return reject();
  }

  const lanePrograms = programs
    .filter((item) => item.category === program.category && hasValidMonthRange(item))
    .map((item) => ({ ...item, title: item.title || "layout" }));
  if (!lanePrograms.some((item) => item.id === programId)) return reject();

  const layout = buildRoadmapLayout({ ...document, clientName: "layout", programs: lanePrograms });

  const section = layout.sections.find((item) => item.key === program.category);
  const current = section.lanes.flat().find((item) => item.id === programId);
  if (!current) return reject();

  const conflicts = section.lanes[targetLaneIndex].filter((item) => item.id !== programId && overlaps(item, program));
  if (conflicts.length === 0) {
    const moveToTargetLane = (item) => item.id === programId ? { ...item, laneIndex: targetLaneIndex } : item;
    return {
      ok: true,
      document: { ...document, programs: programs.map(moveToTargetLane) },
      programs: programs.map(moveToTargetLane),
      outcome: "moved",
    };
  }
  if (conflicts.length !== 1) return reject();

  const [conflict] = conflicts;
  const targetRest = section.lanes[targetLaneIndex].filter((item) => item.id !== programId && item.id !== conflict.id);
  const sourceRest = section.lanes[current.rowIndex].filter((item) => item.id !== programId && item.id !== conflict.id);
  const validSwap = targetRest.every((item) => !overlaps(item, program))
    && sourceRest.every((item) => !overlaps(item, conflict));
  if (!validSwap) return reject();

  const swapLanes = (item) => {
    if (item.id === programId) return { ...item, laneIndex: targetLaneIndex };
    if (item.id === conflict.id) return { ...item, laneIndex: current.rowIndex };
    return item;
  };
  return {
    ok: true,
    programs: programs.map(swapLanes),
    document: { ...document, programs: programs.map(swapLanes) },
    outcome: "swapped",
  };
}

function layoutForProgram({ document, programId }) {
  const programs = document?.programs ?? [];
  const tier = resolveRoadmapTier(document);
  const program = programs.find((item) => item.id === programId);
  const allowedCategoryKeys = new Set(allowedCategoriesForTier(tier).map((category) => category.key));
  const category = allowedCategoryKeys.has(program?.category) ? categoryByKey.get(program?.category) : undefined;
  if (!program || !category || !hasValidMonthRange(program)) return {};

  const lanePrograms = programs
    .filter((item) => item.category === program.category && hasValidMonthRange(item))
    .map((item) => ({ ...item, title: item.title || "layout" }));
  const layout = buildRoadmapLayout({ ...document, clientName: "layout", programs: lanePrograms });
  const section = layout.sections.find((item) => item.key === program.category);
  const current = section?.lanes.flat().find((item) => item.id === programId);
  return { program, category, layout, section, current };
}

export function shiftProgramByMonths({ document, programId, deltaMonths }) {
  const reject = () => ({ ok: false, document, outcome: "rejected" });
  const programs = document?.programs ?? [];
  if (deltaMonths !== -1 && deltaMonths !== 1) return reject();
  const { program, layout, section, current } = layoutForProgram({ document, programId });
  if (!program || !layout || !section || !current || layout.errors.length) return reject();

  const shifted = { ...program, startMonth: program.startMonth + deltaMonths, endMonth: program.endMonth + deltaMonths };
  if (!hasValidMonthRange(shifted)) return reject();
  const sourceRest = section.lanes[current.rowIndex].filter((item) => item.id !== programId);
  if (sourceRest.some((item) => overlaps(item, shifted))) return reject();

  const applyShift = (item) => item.id === programId ? { ...shifted, laneIndex: current.rowIndex } : item;
  return {
    ok: true,
    programs: programs.map(applyShift),
    document: { ...document, programs: programs.map(applyShift) },
    outcome: "shifted",
  };
}

export function exchangeProgramWithLanePair({ document, programId, targetLaneIndex }) {
  const programs = document?.programs ?? [];
  const { program, category, section, current } = layoutForProgram({ document, programId });
  if (!program || !category || !section || !current || !Number.isInteger(targetLaneIndex)
    || targetLaneIndex < 0 || targetLaneIndex >= section.laneCount || targetLaneIndex === current.rowIndex) {
    return { ok: false, document, outcome: "rejected" };
  }

  const pair = section.lanes[targetLaneIndex].filter((item) => item.id !== programId);
  if (pair.length !== 2 || overlaps(pair[0], pair[1])) return { ok: false, document, outcome: "rejected" };
  const sourceRest = section.lanes[current.rowIndex].filter((item) => item.id !== programId);
  if (sourceRest.some((item) => pair.some((displaced) => overlaps(item, displaced)))) {
    return { ok: false, document, outcome: "rejected" };
  }

  const exchangeLanes = (item) => {
    if (item.id === programId) return { ...item, laneIndex: targetLaneIndex };
    if (pair.some((displaced) => displaced.id === item.id)) return { ...item, laneIndex: current.rowIndex };
    return item;
  };
  return {
    ok: true,
    programs: programs.map(exchangeLanes),
    document: { ...document, programs: programs.map(exchangeLanes) },
    outcome: "swapped-pair",
  };
}

function exchangeLanePairWithProgram({ document, programId, targetLaneIndex }) {
  const programs = document?.programs ?? [];
  const { section, current } = layoutForProgram({ document, programId });
  if (!section || !current || targetLaneIndex === current.rowIndex) return { ok: false, document, outcome: "rejected" };

  const pair = section.lanes[current.rowIndex];
  const target = section.lanes[targetLaneIndex];
  if (pair.length !== 2 || target.length !== 1 || overlaps(pair[0], pair[1])) return { ok: false, document, outcome: "rejected" };

  const exchangeLanes = (item) => {
    if (pair.some((member) => member.id === item.id)) return { ...item, laneIndex: targetLaneIndex };
    if (item.id === target[0].id) return { ...item, laneIndex: current.rowIndex };
    return item;
  };
  return {
    ok: true,
    programs: programs.map(exchangeLanes),
    document: { ...document, programs: programs.map(exchangeLanes) },
    outcome: "swapped-pair",
  };
}

export function moveProgramToTargetLane({ document, programId, targetLaneIndex }) {
  const { section, current } = layoutForProgram({ document, programId });
  const targetLane = section?.lanes[targetLaneIndex];
  if (targetLane?.length === 2) {
    const exchange = exchangeProgramWithLanePair({ document, programId, targetLaneIndex });
    if (exchange.ok) return exchange;
  }
  if (targetLane?.length === 1 && section?.lanes[current?.rowIndex]?.length === 2) {
    const exchange = exchangeLanePairWithProgram({ document, programId, targetLaneIndex });
    if (exchange.ok) return exchange;
  }
  return moveProgramToLane({ document, programId, targetLaneIndex });
}
