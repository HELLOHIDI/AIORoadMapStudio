import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INDUSTRY_OPTIONS, NON_INDUSTRY_OPTIONS } from "../catalog-options.js";
import { inferIndustries, inferRegions } from "../catalog-tag-policy.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CRAWL_ROOT = path.resolve(ROOT, "../.tmp/government-support-full-crawl");
const DEFAULT_SITE = "https://aio-roadmap-studio.fbgmlwo1029384756.chatgpt.site";
const apply = process.argv.includes("--apply");
const site = process.argv.find((arg) => arg.startsWith("--site="))?.slice(7) || DEFAULT_SITE;
const reportPath = path.resolve(ROOT, process.argv.find((arg) => arg.startsWith("--report="))?.slice(9) || "output/catalog-tag-refinement-report.json");
const disallowed = new Set(NON_INDUSTRY_OPTIONS);
const allowedIndustries = new Set(INDUSTRY_OPTIONS);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sameTags = (left, right) => [...left].sort().join("\0") === [...right].sort().join("\0");

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

async function readJsonl(file) {
  try { return (await fs.readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function request(pathname, options = {}, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${site}${pathname}`, options);
      const text = await response.text();
      if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 500)}`);
      return text ? JSON.parse(text) : null;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 800);
    }
  }
  throw lastError;
}

async function fetchCatalog() {
  const records = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const page = await request(`/api/catalog-programs?limit=100&offset=${offset}`);
    total = page.total;
    records.push(...page.items);
    offset += page.items.length;
    if (!page.items.length) break;
  }
  return records;
}

async function sourceRecordsByLink() {
  const [queue, body, attachments] = await Promise.all([
    readJson(path.join(CRAWL_ROOT, "queue.json"), []),
    readJsonl(path.join(CRAWL_ROOT, "body-records.jsonl")),
    readJsonl(path.join(CRAWL_ROOT, "attachment-records.jsonl")),
  ]);
  const merged = new Map();
  for (const row of [...queue, ...body, ...attachments]) {
    const sequence = Number(row.sequence);
    if (Number.isFinite(sequence)) merged.set(sequence, { ...(merged.get(sequence) ?? {}), ...row });
  }
  return new Map([...merged.values()].filter((row) => row.url).map((row) => [row.url, row]));
}

function payload(record, source) {
  const needsIndustryRepair = record.industries.length !== 2 || record.industries.some((tag) => disallowed.has(tag));
  return {
    category: record.category,
    title: record.title,
    link: record.link,
    amountKrw: record.amountKrw,
    startMonth: record.startMonth,
    endMonth: record.endMonth,
    target: record.target,
    details: record.details,
    industries: needsIndustryRepair ? inferIndustries(record, source, INDUSTRY_OPTIONS) : record.industries,
    regions: inferRegions(record, source),
  };
}

async function main() {
  const [records, sourceByLink, options] = await Promise.all([
    fetchCatalog(), sourceRecordsByLink(), request("/api/catalog-options"),
  ]);
  const patches = records.map((record) => {
    const source = sourceByLink.get(record.link) ?? {};
    const next = payload(record, source);
    return { record, source, next, industriesChanged: !sameTags(record.industries, next.industries), regionsChanged: !sameTags(record.regions, next.regions) };
  }).filter(({ industriesChanged, regionsChanged }) => industriesChanged || regionsChanged);

  const missingRegions = [...new Set(patches.flatMap(({ next }) => next.regions))]
    .filter((region) => region !== "전국" && !options.regions.includes(region)).sort((a, b) => a.localeCompare(b, "ko"));
  const invalidAfter = patches.filter(({ next }) => next.industries.some((tag) => disallowed.has(tag) || !allowedIndustries.has(tag)));
  const wrongIndustryCountAfter = records.reduce((count, record) => {
    const patch = patches.find((item) => item.record.id === record.id);
    const tags = patch?.next.industries ?? record.industries;
    return count + Number(tags.some((tag) => disallowed.has(tag)));
  }, 0);
  const report = {
    generatedAt: new Date().toISOString(), site, apply, total: records.length,
    sourceMatched: records.filter((record) => sourceByLink.has(record.link)).length,
    changed: patches.length,
    industryChanges: patches.filter(({ industriesChanged }) => industriesChanged).length,
    regionChanges: patches.filter(({ regionsChanged }) => regionsChanged).length,
    missingRegions,
    invalidIndustryAssignmentsAfter: invalidAfter.length,
    recordsWithNonIndustryTagsAfter: wrongIndustryCountAfter,
    changes: patches.map(({ record, next, industriesChanged, regionsChanged }) => ({
      id: record.id, title: record.title, industriesChanged, regionsChanged,
      industriesBefore: record.industries, industriesAfter: next.industries,
      regionsBefore: record.regions, regionsAfter: next.regions,
    })),
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, changes: report.changes.slice(0, 12) }, null, 2));
  if (!apply) return;
  if (invalidAfter.length || wrongIndustryCountAfter) throw new Error("업종 태그 검증에 실패했습니다.");

  for (const region of missingRegions) {
    await request("/api/catalog-options", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "region", value: region }),
    });
  }

  let cursor = 0;
  const failures = [];
  async function worker() {
    while (cursor < patches.length) {
      const item = patches[cursor++];
      try {
        await request(`/api/catalog-programs/${item.record.id}`, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(item.next),
        });
      } catch (error) {
        failures.push({ id: item.record.id, title: item.record.title, error: error.message });
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  if (failures.length) throw new Error(`태그 갱신 ${failures.length}건 실패: ${JSON.stringify(failures.slice(0, 5))}`);
  console.log(JSON.stringify({ applied: patches.length, addedRegionOptions: missingRegions.length }, null, 2));
}

await main();
