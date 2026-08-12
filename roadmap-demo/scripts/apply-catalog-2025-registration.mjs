import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SITE = process.env.CATALOG_SITE ?? "https://aio-roadmap-studio.fbgmlwo1029384756.chatgpt.site";
const PAYLOAD_PATH = path.join(ROOT, "output/catalog-2025-registration-expanded-payload.json");
const REPORT_PATH = path.join(ROOT, "output/catalog-2025-registration-apply-report.json");
const CONCURRENCY = 6;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeLink = (value) => String(value ?? "").trim().replace(/\/$/, "").toLowerCase();

async function request(pathname, init = {}, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${SITE}${pathname}`, init);
      const body = await response.text();
      if (!response.ok) throw new Error(`${response.status}: ${body.slice(0, 300)}`);
      return body ? JSON.parse(body) : null;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 800);
    }
  }
  throw lastError;
}

async function fetchCatalog() {
  const records = [];
  for (let offset = 0; ; offset += 100) {
    const page = await request(`/api/catalog-programs?limit=100&offset=${offset}`);
    records.push(...page.items);
    if (records.length >= page.total || !page.items.length) return records;
  }
}

async function main() {
  const [payload, existing, options] = await Promise.all([
    fs.readFile(PAYLOAD_PATH, "utf8").then(JSON.parse), fetchCatalog(), request("/api/catalog-options"),
  ]);
  const existingLinks = new Set(existing.map(({ link }) => normalizeLink(link)).filter(Boolean));
  const pending = payload.filter(({ link }) => !existingLinks.has(normalizeLink(link)));
  const requiredRegions = [...new Set(pending.flatMap(({ regions }) => regions))].filter((region) => !options.regions.includes(region));
  for (const value of requiredRegions) {
    await request("/api/catalog-options", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "region", value }),
    });
  }
  const refreshedOptions = await request("/api/catalog-options");
  const invalid = pending.filter(({ industries, regions }) => industries.length !== 1 || industries.some((tag) => !refreshedOptions.industries.includes(tag)) || regions.some((tag) => !refreshedOptions.regions.includes(tag)));
  if (invalid.length) throw new Error(`Catalog-option validation failed for ${invalid.length} records.`);

  let cursor = 0;
  const failures = [];
  let created = 0;
  async function worker() {
    while (cursor < pending.length) {
      const item = pending[cursor++];
      try {
        await request("/api/catalog-programs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(item) });
        created += 1;
        if (created % 250 === 0) console.log(JSON.stringify({ created, total: pending.length }));
      } catch (error) {
        failures.push({ title: item.title, link: item.link, error: error.message });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const report = { appliedAt: new Date().toISOString(), site: SITE, sourceRecords: payload.length, existingDuplicates: payload.length - pending.length, addedRegionOptions: requiredRegions, created, failures };
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, failures: failures.slice(0, 10) }, null, 2));
  if (failures.length) process.exitCode = 1;
}

await main();
