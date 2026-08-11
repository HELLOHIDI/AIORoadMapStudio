import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCatalogReadability } from "../catalog-readability.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = process.env.CATALOG_SITE ?? "https://aio-roadmap-studio.fbgmlwo1029384756.chatgpt.site";
const AUTH_TOKEN = process.env.CATALOG_AUTH_TOKEN;
const APPLY = process.argv.includes("--apply");
const REPORT_PATH = path.join(ROOT, "output", APPLY ? "catalog-readability-apply.json" : "catalog-readability-dry-run.json");
const DRY_RUN_PATH = path.join(ROOT, "output", "catalog-readability-dry-run.json");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const siteUrl = new URL(SITE);
if (AUTH_TOKEN && (siteUrl.protocol !== "https:" || !siteUrl.hostname.endsWith(".chatgpt.site"))) {
  throw new Error("CATALOG_AUTH_TOKEN can only be used with an HTTPS Sites hostname.");
}

async function request(pathname, init = {}, attempts = 5) {
  let error;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${SITE}${pathname}`, {
        ...init,
        headers: { ...init.headers, ...(AUTH_TOKEN ? { "OAI-Sites-Authorization": `Bearer ${AUTH_TOKEN}` } : {}) },
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    } catch (caught) {
      error = caught;
      if (attempt < attempts) await sleep(attempt * 500);
    }
  }
  throw error;
}

async function fetchCatalog() {
  const items = [];
  for (let offset = 0; ; offset += 100) {
    const page = await request(`/api/catalog-programs?limit=100&offset=${offset}`);
    items.push(...page.items);
    if (items.length >= page.total || !page.items.length) return items;
  }
}

function changeFor(item) {
  const target = classifyCatalogReadability(item.target);
  const details = classifyCatalogReadability(item.details);
  const kinds = [target.kind, details.kind];
  const kind = kinds.includes("safe-rewrite") ? "safe-rewrite"
    : kinds.includes("whitespace-only") ? "whitespace-only"
      : "ambiguous-keep-prose";
  return {
    id: item.id, title: item.title, kind, beforeHash: hash([item.target, item.details]),
    before: { target: item.target, details: item.details }, after: { target: target.value, details: details.value },
  };
}

async function main() {
  const records = await fetchCatalog();
  const changes = records.map(changeFor);
  const actionable = changes.filter(({ kind }) => kind !== "ambiguous-keep-prose");
  const report = {
    generatedAt: new Date().toISOString(), site: SITE, mode: APPLY ? "apply" : "dry-run", total: records.length,
    counts: Object.fromEntries(["safe-rewrite", "whitespace-only", "ambiguous-keep-prose"].map((kind) => [kind, changes.filter((change) => change.kind === kind).length])),
    changes: actionable, preserved: changes.filter(({ kind }) => kind === "ambiguous-keep-prose").map(({ id, title }) => ({ id, title })),
    samples: changes.filter(({ kind }) => kind !== "ambiguous-keep-prose").slice(0, 20),
  };
  if (APPLY) {
    const dryRun = JSON.parse(await fs.readFile(DRY_RUN_PATH, "utf8"));
    if (dryRun.site !== SITE) throw new Error("Dry-run report site does not match CATALOG_SITE.");
    const planned = dryRun.changes ?? [];
    let applied = 0;
    const skipped = [];
    for (const change of planned) {
      const item = records.find(({ id }) => id === change.id);
      if (!item || hash([item.target, item.details]) !== change.beforeHash) { skipped.push(change.id); continue; }
      await request(`/api/catalog-programs/${item.id}`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: item.category, title: item.title, link: item.link, amountKrw: item.amountKrw,
          startMonth: item.startMonth, endMonth: item.endMonth, target: change.after.target, details: change.after.details,
          industries: item.industries, regions: item.regions, mainPackage: item.mainPackage,
        }),
      });
      applied += 1;
    }
    report.applied = applied;
    report.skipped = skipped;
    report.planned = planned.length;
  }
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    mode: report.mode, total: report.total, counts: report.counts, changes: report.changes.length,
    preserved: report.preserved.length, applied: report.applied ?? 0, skipped: report.skipped?.length ?? 0,
  }, null, 2));
}

await main();
