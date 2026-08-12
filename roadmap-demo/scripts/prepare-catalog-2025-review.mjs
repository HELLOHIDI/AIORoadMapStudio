import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { inferIndustries, inferRegions } from "../catalog-tag-policy.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SOURCE = path.resolve(ROOT, "../outputs/government-support-full-crawl/정부지원사업_2025-2026_최종상세정규화.xlsx");
const OUTPUT = path.resolve(ROOT, "output");
const SITE = process.env.CATALOG_SITE ?? "https://aio-roadmap-studio.fbgmlwo1029384756.chatgpt.site";
const CATEGORY = { "사업화": "business", "컨설팅": "business", IP: "ip", "기업인증": "certification" };
const VOUCHER_TERMS = /바우처|voucher|크레딧|credit|포인트|point|쿠폰|coupon/u;
const EMPLOYMENT_TERMS = /채용|고용|일자리|임금|인건비|근로자|취업/u;
const EMPLOYMENT_SUPPORT = /지원|장려|보조/u;
const BANNED_TITLE_TERMS = ["보증", "연장", "추가모집", "주관기관모집", "융자", "통합공고"];
const EXCLUDED_FUNDING_TERMS = ["육성자금", "운전자금"];

const unescapeXml = (value = "") => value.replace(/<[^>]+>/g, "").replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[entity]);
const columnIndex = (reference) => [...reference.match(/^([A-Z]+)/)?.[1] ?? ""].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
const normalized = (value) => String(value ?? "").replace(/\s+/g, "").trim();
const normalizeLink = (value) => String(value ?? "").trim().replace(/\/$/, "").toLowerCase();

async function readWorkbook() {
  const zip = await JSZip.loadAsync(await fs.readFile(SOURCE));
  const sharedXml = await zip.file("xl/sharedStrings.xml").async("string");
  const shared = [...sharedXml.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(([, value]) => unescapeXml(value));
  const sheetXml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  return [...sheetXml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)].map(([, rowXml]) => {
    const row = [];
    for (const [, attributes, cellXml] of rowXml.matchAll(/<(?:\w+:)?c\b([^>/]*?)>([\s\S]*?)<\/(?:\w+:)?c>/g)) {
      const reference = attributes.match(/\br="([A-Z]+)\d+"/)?.[1];
      const index = columnIndex(reference ?? "");
      const raw = cellXml.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] ?? "";
      row[index] = attributes.includes('t="s"') ? shared[Number(raw)] ?? "" : unescapeXml(raw);
    }
    return row;
  }).slice(1);
}

async function fetchCatalog() {
  const records = [];
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(`${SITE}/api/catalog-programs?limit=100&offset=${offset}`);
    if (!response.ok) throw new Error(`Catalog fetch failed: ${response.status}`);
    const page = await response.json();
    records.push(...page.items);
    if (records.length >= page.total || !page.items.length) return records;
  }
}

async function fetchOptions() {
  const response = await fetch(`${SITE}/api/catalog-options`);
  if (!response.ok) throw new Error(`Catalog options fetch failed: ${response.status}`);
  return response.json();
}

function sourceToPayload(row) {
  const [sourceCategory, title = "", link = "", period = "", amount = "", target = "", details = "", industryText = "", regionText = ""] = row;
  const dates = [...String(period).matchAll(/(20\d{2})-(\d{1,2})-(\d{1,2})/g)];
  if (!String(period).includes("2025")) return { skip: "outside-2025-period" };
  if (dates.length < 2) return { skip: "invalid-period" };
  const [, startYear, startMonth] = dates[0];
  const [, endYear, endMonth] = dates[1];
  if (startYear !== endYear || Number(startMonth) > Number(endMonth)) return { skip: "cross-year-or-reversed-period" };
  const compactTitle = normalized(title);
  if (BANNED_TITLE_TERMS.some((term) => compactTitle.includes(term))) return { skip: "excluded-title" };
  if (EXCLUDED_FUNDING_TERMS.some((term) => compactTitle.includes(term) || normalized(details).includes(term))) return { skip: "excluded-funding-term" };
  if (compactTitle.includes("2024년")) return { skip: "excluded-2024-notice" };
  if (EMPLOYMENT_TERMS.test(title) && EMPLOYMENT_SUPPORT.test(title)) return { skip: "direct-employment-support" };
  const text = `${title}\n${target}\n${details}`;
  const category = sourceCategory === "바우처" && VOUCHER_TERMS.test(text) ? "voucher" : CATEGORY[sourceCategory] ?? "business";
  const parsedAmount = String(amount).trim() ? Number(amount) : null;
  if (parsedAmount !== null && (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0)) return { skip: "invalid-amount", raw: String(amount) };
  if (!title || !link || !target || !details || title.length > 240 || link.length > 2048 || target.length > 1000 || details.length > 4000) return { skip: "invalid-required-field" };
  const record = { category, title: title.trim(), link: link.trim(), amountKrw: parsedAmount, startMonth: Number(startMonth), endMonth: Number(endMonth), target: target.trim(), details: details.trim(), industries: industryText.split(",").map((tag) => tag.trim()).filter(Boolean), regions: regionText.split(",").map((tag) => tag.trim()).filter(Boolean), mainPackage: false };
  return { value: { ...record, industries: inferIndustries(record), regions: inferRegions(record) } };
}

async function main() {
  const [rows, existing, options] = await Promise.all([readWorkbook(), fetchCatalog(), fetchOptions()]);
  const existingLinks = new Set(existing.map(({ link }) => normalizeLink(link)).filter(Boolean));
  const existingTitlesWithoutLink = new Set(existing.filter(({ link }) => !link).map(({ title }) => normalized(title)));
  const skipped = new Map();
  const skippedSamples = new Map();
  const proposed = [];
  for (const row of rows) {
    const result = sourceToPayload(row);
    if (result.skip) {
      skipped.set(result.skip, (skipped.get(result.skip) ?? 0) + 1);
      if (!skippedSamples.has(result.skip)) skippedSamples.set(result.skip, result.raw ?? row[1] ?? "");
      continue;
    }
    const item = result.value;
    const duplicate = item.link ? existingLinks.has(normalizeLink(item.link)) : existingTitlesWithoutLink.has(normalized(item.title));
    if (duplicate) { skipped.set("duplicate-existing", (skipped.get("duplicate-existing") ?? 0) + 1); continue; }
    proposed.push(item);
  }
  const requiredRegions = [...new Set(proposed.flatMap(({ regions }) => regions))].filter((region) => !options.regions.includes(region));
  const blockedByOptions = proposed.filter(({ industries, regions }) => industries.length !== 2 || industries.some((tag) => !options.industries.includes(tag)) || regions.some((tag) => !options.regions.includes(tag)));
  const ready = proposed.filter((item) => !blockedByOptions.includes(item));
  const report = {
    generatedAt: new Date().toISOString(), source: SOURCE, site: SITE, sourceRows: rows.length,
    selectionRule: "support period contains 2025; cross-year or reversed periods excluded",
    existingCatalogRecords: existing.length, proposedBeforeOptionExpansion: proposed.length, readyAdditions: ready.length,
    blockedByCatalogOptions: blockedByOptions.length, skipped: Object.fromEntries([...skipped].sort()),
    skippedSamples: Object.fromEntries(skippedSamples), requiredRegionOptions: requiredRegions,
    blockedSamples: blockedByOptions.slice(0, 20).map(({ title, regions }) => ({ title, regions })),
    samples: ready.slice(0, 20).map(({ category, title, link, startMonth, endMonth, industries, regions }) => ({ category, title, link, startMonth, endMonth, industries, regions })),
  };
  if (!ready.length) throw new Error(`Review validation failed: ${JSON.stringify(report)}`);
  await fs.mkdir(OUTPUT, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(OUTPUT, "catalog-2025-registration-review.json"), `${JSON.stringify(report, null, 2)}\n`),
    fs.writeFile(path.join(OUTPUT, "catalog-2025-registration-payload.json"), `${JSON.stringify(ready, null, 2)}\n`),
    fs.writeFile(path.join(OUTPUT, "catalog-2025-registration-expanded-payload.json"), `${JSON.stringify(proposed, null, 2)}\n`),
  ]);
  console.log(JSON.stringify(report, null, 2));
}

await main();
