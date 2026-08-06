export const ROADMAP_CATEGORIES = Object.freeze([
  { key: "consulting", label: "컨설팅", maxRows: 2, color: "#BFBFBF" },
  { key: "business", label: "사업화", maxRows: 4, color: "#5B9BD5" },
  { key: "voucher", label: "바우처", maxRows: 2, color: "#FFC000" },
  { key: "ip", label: "IP", maxRows: 2, color: "#F86828" },
  { key: "certification", label: "기업인증", maxRows: 1, color: "#70AD47" },
]);

const categoryByKey = new Map(ROADMAP_CATEGORIES.map((category) => [category.key, category]));

function error(code, path, message, programId) {
  return { code, path, message, ...(programId ? { programId } : {}) };
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value;
}

function normalizeDocument(input) {
  return {
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

function validateProgram(program, index, seenIds) {
  const errors = [];
  const path = `programs[${index}]`;
  const id = program?.id;

  if (!id) errors.push(error("E_PROGRAM_ID_REQUIRED", `${path}.id`, "프로그램 ID가 필요합니다."));
  else if (seenIds.has(id)) errors.push(error("E_PROGRAM_ID_DUPLICATE", `${path}.id`, "프로그램 ID가 중복되었습니다.", id));
  else seenIds.add(id);

  if (!categoryByKey.has(program?.category)) {
    errors.push(error("E_CATEGORY_UNKNOWN", `${path}.category`, "지원하지 않는 구분입니다.", id));
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
  if (!document.clientName) errors.push(error("E_CLIENT_NAME_REQUIRED", "clientName", "클라이언트명이 필요합니다."));
  if (!Array.isArray(input?.programs)) errors.push(error("E_PROGRAMS_REQUIRED", "programs", "프로그램 목록이 필요합니다."));

  const seenIds = new Set();
  document.programs.forEach((program, index) => errors.push(...validateProgram(program, index, seenIds)));
  return { document, errors };
}

function overlaps(a, b) {
  return a.startMonth <= b.endMonth && b.startMonth <= a.endMonth;
}

export function buildRoadmapLayout(input) {
  const { document, errors } = validateRoadmapDocument(input);
  const invalidIds = new Set(errors.map((item) => item.programId).filter(Boolean));
  const sections = ROADMAP_CATEGORIES.map((category) => ({
    ...category,
    lanes: Array.from({ length: category.maxRows }, () => []),
  }));

  for (const section of sections) {
    const programs = document.programs
      .filter((program) => program.category === section.key && !invalidIds.has(program.id))
      .sort((a, b) => a.startMonth - b.startMonth
        || a.endMonth - b.endMonth
        || a.sequence - b.sequence
        || a.id.localeCompare(b.id));

    for (const program of programs) {
      const rowIndex = section.lanes.findIndex((lane) => lane.every((placed) => !overlaps(placed, program)));
      if (rowIndex === -1) {
        errors.push(error("E_ROW_CAPACITY", `programs.${program.id}`, `${section.label}의 최대 행 수를 초과했습니다.`, program.id));
        continue;
      }
      section.lanes[rowIndex].push({
        ...program,
        rowIndex,
        startOffset: program.startMonth - 1,
        span: program.endMonth - program.startMonth + 1,
      });
    }
  }

  return { document, sections, errors };
}
