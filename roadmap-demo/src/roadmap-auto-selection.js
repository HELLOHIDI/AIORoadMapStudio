import { allowedCategoriesForTier } from "./roadmap-policy.js";
import { ADMINISTRATIVE_REGION_GROUPS } from "../catalog-tag-policy.js";

// This is the single draft-selection policy used by the new-roadmap UI and its tests.
// ponytail: target-text heuristics are intentionally small; use structured catalog eligibility when data quality warrants it.
const WOMEN_ONLY = /(?:여성(?:기업|창업자|대표자?)?\s*(?:전용|대상)|여성(?:기업|창업자|대표자?)?만|women[-\s]?only|female[-\s]?founders?\s+only)/iu;
const WOMEN_NOT_ONLY = /(?:여성\s*(?:기업\s*)?(?:우대|포함)|women[-\s]?(?:preferred|eligible|inclusive))/iu;
const PRELAUNCH = /(?:예비\s*창업자?|창업\s*예정|사업자\s*등록\s*전|pre[-\s]?startup)/iu;

const NATIONWIDE = "전국";
const ALL_INDUSTRIES = "모든 영역";
const RECOMMENDATION_LIMIT = 35;
const RECOMMENDATION_TARGETS = Object.freeze({ business: 20, voucher: 10, ip: 5 });
const RECOMMENDATION_CATEGORIES = new Set(Object.keys(RECOMMENDATION_TARGETS));
const regionParentByTag = new Map(ADMINISTRATIVE_REGION_GROUPS.flatMap(({ key, options }) => (
  options.map((option) => [option, key])
)));

function industryMatchGrade(programTags, clientTags) {
  if (!Array.isArray(programTags) || programTags.length === 0) return "empty";
  const client = new Set(Array.isArray(clientTags) ? clientTags : []);
  if (programTags.some((tag) => client.has(tag))) return "exact";
  return programTags.includes(ALL_INDUSTRIES) ? "wildcard" : "none";
}

function regionMatchGrade(programTags, clientTags) {
  if (!Array.isArray(programTags) || programTags.length === 0) return "empty";
  const client = Array.isArray(clientTags) ? clientTags : [];
  const clientSet = new Set(client);
  if (programTags.some((tag) => clientSet.has(tag))) return "exact";
  if (programTags.includes(NATIONWIDE)) return "nationwide";
  const clientParents = new Set(client.map((tag) => regionParentByTag.get(tag)).filter(Boolean));
  return programTags.some((tag) => clientParents.has(tag)) ? "parent" : "none";
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

function isWomenOnly(program) {
  const source = programText(program);
  return WOMEN_ONLY.test(source) && !WOMEN_NOT_ONLY.test(source);
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

function scoreProgram(program, client, fit) {
  const industryGrade = industryMatchGrade(program?.industries, client.industries);
  const regionGrade = regionMatchGrade(program?.regions, client.regions);
  const reasons = [];
  let matchScore = 0;

  if (industryGrade === "exact") {
    matchScore += 40;
    reasons.push("업종 정확 일치 +40");
  } else if (industryGrade === "wildcard") {
    matchScore += 10;
    reasons.push("모든 업종 대상 +10");
  }

  if (regionGrade === "exact") {
    matchScore += 30;
    reasons.push("지역 정확 일치 +30");
  } else if (regionGrade === "parent") {
    matchScore += 20;
    reasons.push("상위 시·도 일치 +20");
  } else if (regionGrade === "nationwide") {
    matchScore += 15;
    reasons.push("전국 대상 +15");
  }

  if (fit.matched) {
    matchScore += 20;
    reasons.push("업력 조건 충족 +20");
  }
  if (isWomenOwned(client) && isWomenOnly(program)) {
    matchScore += 10;
    reasons.push("여성기업 조건 일치 +10");
  }
  if (program.mainPackage === true) {
    matchScore += 15;
    reasons.push("메인패키지 +15");
  }

  return {
    matchScore,
    matchReasons: reasons,
    exactMatchCount: Number(industryGrade === "exact") + Number(regionGrade === "exact"),
  };
}

function rank(a, b) {
  return b.matchScore - a.matchScore
    || Number(b.program.mainPackage === true) - Number(a.program.mainPackage === true)
    || b.exactMatchCount - a.exactMatchCount
    || (Number(b.program.amountKrw) || 0) - (Number(a.program.amountKrw) || 0)
    || String(a.program.id ?? "").localeCompare(String(b.program.id ?? ""))
    || String(a.program.title ?? "").localeCompare(String(b.program.title ?? ""));
}

export function selectRoadmapPrograms({ programs = [], client = {}, tier = "premium", reservedRowsByCategory = {} } = {}) {
  const categories = allowedCategoriesForTier(tier);
  const categoryKeys = new Set(categories.map(({ key }) => key));
  const eligible = programs.flatMap((program) => {
    const fit = tenureFit(program, client);
    if (!categoryKeys.has(program?.category)
      || program?.category === "certification"
      || excludesByWomenOnly(program, client)
      || !fit.eligible) return [];
    const score = scoreProgram(program, client, fit);
    return [{
      program,
      ...score,
    }];
  });
  const eligibleByCategory = new Map(categories.map(({ key }) => [
    key,
    eligible.filter(({ program }) => program.category === key).sort(rank),
  ]));
  const recommendationEntries = [];
  const includedIds = new Set();
  for (const [key, target] of Object.entries(RECOMMENDATION_TARGETS)) {
    for (const entry of (eligibleByCategory.get(key) ?? []).slice(0, target)) {
      recommendationEntries.push(entry);
      includedIds.add(entry.program.id);
    }
  }
  const remaining = eligible
    .filter(({ program }) => (program.category === "business" || program.category === "voucher") && !includedIds.has(program.id))
    .sort(rank)
    .slice(0, Math.max(0, RECOMMENDATION_LIMIT - recommendationEntries.length));
  recommendationEntries.push(...remaining);
  recommendationEntries.sort(rank);
  const recommendations = recommendationEntries.map(({ program, matchScore, matchReasons }) => ({
    ...program,
    matchScore,
    matchReasons,
  }));
  const recommendationIds = new Set(recommendations.map(({ id }) => id));
  const selected = [];

  const categorySummaries = categories.map((category) => {
    const categoryEligible = eligibleByCategory.get(category.key) ?? [];
    const categoryRecommendations = RECOMMENDATION_CATEGORIES.has(category.key)
      ? categoryEligible.filter(({ program }) => recommendationIds.has(program.id))
      : [];
    const reservedRows = Number.isSafeInteger(reservedRowsByCategory[category.key])
      ? Math.max(0, reservedRowsByCategory[category.key])
      : 0;
    const placementPool = category.key === "consulting" ? categoryEligible : categoryRecommendations;
    const placed = placementPool.slice(0, Math.max(0, category.maxRows - reservedRows)).map(({ program }, index) => ({
      ...program,
      sequence: selected.length + index,
    }));
    selected.push(...placed);
    return {
      key: category.key,
      eligibleCount: categoryEligible.length,
      recommendationCount: categoryRecommendations.length,
      placedCount: placed.length,
      programs: placed,
    };
  });

  return { programs: selected, recommendations, categories: categorySummaries };
}
