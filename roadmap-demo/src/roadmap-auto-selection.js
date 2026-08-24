import { allowedCategoriesForTier } from "./roadmap-policy.js";

// This is the single draft-selection policy used by the new-roadmap UI and its tests.
// ponytail: target-text heuristics are intentionally small; use structured catalog eligibility when data quality warrants it.
const WOMEN_ONLY = /(?:여성(?:기업|창업자|대표자?)?\s*(?:전용|대상)|여성(?:기업|창업자|대표자?)?만|women[-\s]?only|female[-\s]?founders?\s+only)/iu;
const WOMEN_NOT_ONLY = /(?:여성\s*(?:기업\s*)?(?:우대|포함)|women[-\s]?(?:preferred|eligible|inclusive))/iu;
const PRELAUNCH = /(?:예비\s*창업자?|창업\s*예정|사업자\s*등록\s*전|pre[-\s]?startup)/iu;

const NATIONWIDE = "전국";
const ALL_INDUSTRIES = "모든 영역";

// Returns "exact" for a real tag intersection, "wildcard" for wildcard/empty-tag
// passes, and null when the program does not match the client at all.
function tagMatchGrade(programTags, clientTags, wildcard) {
  if (!Array.isArray(programTags) || programTags.length === 0) return "wildcard";
  const client = new Set(Array.isArray(clientTags) ? clientTags : []);
  if (programTags.some((tag) => client.has(tag))) return "exact";
  return programTags.includes(wildcard) ? "wildcard" : null;
}

function programText(program) {
  return `${program?.target ?? ""} ${program?.title ?? ""}`;
}

function isWomenOwned(client) {
  return client?.isWomenOwned === true || client?.womenOwned === true;
}

function excludesByWomenOnly(program, client) {
  const source = programText(program);
  return !isWomenOwned(client) && WOMEN_ONLY.test(source) && !WOMEN_NOT_ONLY.test(source);
}

function clientTenureYears(client) {
  if (client?.tenure === "prelaunch" || client?.tenure === "예비") return "prelaunch";
  if (Number.isFinite(client?.tenureYears)) return client.tenureYears;
  if (Number.isFinite(client?.tenureMonths)) return client.tenureMonths / 12;
  if (Number.isFinite(client?.tenure)) return client.tenure;
  return null;
}

function inferTenureRule(program) {
  const source = programText(program);
  if (PRELAUNCH.test(source)) return { prelaunch: true };

  const range = source.match(/(\d+)\s*년\s*(?:이상|초과)?\s*(?:~|부터)\s*(\d+)\s*년\s*(?:미만|이내|이하)/iu);
  if (range) return { minYears: Number(range[1]), maxYears: Number(range[2]), maxExclusive: true };

  const max = source.match(/(?:업력|창업\s*후)?\s*(\d+)\s*년\s*(미만|이내|이하)/iu)
    ?? source.match(/(?:within|under|less than)\s*(\d+)\s*years?/iu)
    ?? source.match(/(\d+)\s*years?\s*(?:or less)/iu);
  if (max) return { maxYears: Number(max[1]), maxExclusive: max[2] === "미만" || /within|under|less than/i.test(max[0]) };

  const min = source.match(/(?:업력|창업\s*후)?\s*(\d+)\s*년\s*(이상|초과)/iu)
    ?? source.match(/(?:over|at least|more than)\s*(\d+)\s*years?/iu)
    ?? source.match(/(\d+)\s*years?\s*(?:or more)/iu);
  if (min) return { minYears: Number(min[1]), minExclusive: min[2] === "초과" || /over|more than/i.test(min[0]) };

  return null;
}

function tenureFit(program, client) {
  const rule = inferTenureRule(program);
  const tenure = clientTenureYears(client);
  if (!rule || tenure === null) return { eligible: true, matched: false };
  if (rule.prelaunch) return { eligible: tenure === "prelaunch", matched: tenure === "prelaunch" };
  if (tenure === "prelaunch") return { eligible: false, matched: false };

  const aboveMinimum = rule.minYears === undefined
    || (rule.minExclusive ? tenure > rule.minYears : tenure >= rule.minYears);
  const belowMaximum = rule.maxYears === undefined
    || (rule.maxExclusive ? tenure < rule.maxYears : tenure <= rule.maxYears);
  return { eligible: aboveMinimum && belowMaximum, matched: aboveMinimum && belowMaximum };
}

function rank(a, b) {
  return Number(b.mainPackageMatch) - Number(a.mainPackageMatch)
    || b.matchScore - a.matchScore
    || (Number(b.program.amountKrw) || 0) - (Number(a.program.amountKrw) || 0)
    || String(a.program.id ?? "").localeCompare(String(b.program.id ?? ""))
    || String(a.program.title ?? "").localeCompare(String(b.program.title ?? ""));
}

export function selectRoadmapPrograms({ programs = [], client = {}, tier = "premium", reservedRowsByCategory = {} } = {}) {
  const categories = allowedCategoriesForTier(tier);
  const categoryKeys = new Set(categories.map(({ key }) => key));
  const eligible = programs.flatMap((program) => {
    const fit = tenureFit(program, client);
    const industryGrade = tagMatchGrade(program?.industries, client.industries, ALL_INDUSTRIES);
    const regionGrade = tagMatchGrade(program?.regions, client.regions, NATIONWIDE);
    if (!categoryKeys.has(program?.category)
      || industryGrade === null
      || regionGrade === null
      || excludesByWomenOnly(program, client)
      || !fit.eligible) return [];
    return [{
      program,
      mainPackageMatch: program.mainPackage === true && fit.matched,
      matchScore: Number(industryGrade === "exact") + Number(regionGrade === "exact"),
    }];
  });
  const selected = [];

  const categorySummaries = categories.map((category) => {
    const categoryEligible = eligible
      .filter(({ program }) => program.category === category.key)
      .sort(rank);
    const reservedRows = Number.isSafeInteger(reservedRowsByCategory[category.key])
      ? Math.max(0, reservedRowsByCategory[category.key])
      : 0;
    const placed = categoryEligible.slice(0, Math.max(0, category.maxRows - reservedRows)).map(({ program }, index) => ({
      ...program,
      sequence: selected.length + index,
    }));
    selected.push(...placed);
    return {
      key: category.key,
      eligibleCount: categoryEligible.length,
      placedCount: placed.length,
      programs: placed,
    };
  });

  return { programs: selected, categories: categorySummaries };
}
