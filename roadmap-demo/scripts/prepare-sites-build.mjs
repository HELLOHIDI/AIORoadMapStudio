#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const index = path.join(dist, "client", "index.html");
const worker = path.join(root, "worker", "index.js");
const hosting = path.join(root, ".openai", "hosting.json");
const migrations = path.join(root, "drizzle");
const catalogOptions = path.join(root, "catalog-options.js");
const catalogReadability = path.join(root, "catalog-readability.js");
const catalogTagPolicy = path.join(root, "catalog-tag-policy.js");
const catalogImport = `import {
  BUSINESS_COMPETITION_TERMS,
  BUSINESS_SUBCATEGORY_OPTIONS,
  FOREIGN_COUNTRY_NAMES,
  INDUSTRY_OPTIONS,
  LEGACY_INVALID_REGION_OPTIONS,
  NON_INDUSTRY_OPTIONS,
  REGION_OPTIONS,
  inferBusinessSubcategories,
} from "../catalog-options.js";`;
const catalogReadabilityImport = 'import { formatCatalogBulletText } from "../catalog-readability.js";';

for (const file of [index, worker, hosting, migrations, catalogOptions, catalogReadability, catalogTagPolicy]) {
  if (!existsSync(file)) throw new Error("Missing Sites build input: " + file);
}

mkdirSync(path.join(dist, "server"), { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });
rmSync(path.join(dist, ".openai", "drizzle"), { recursive: true, force: true });
mkdirSync(path.join(dist, ".openai", "drizzle", "meta"), { recursive: true });
for (const migration of readdirSync(migrations).filter((name) => name.endsWith(".sql"))) {
  copyFileSync(path.join(migrations, migration), path.join(dist, ".openai", "drizzle", migration));
}
copyFileSync(
  path.join(migrations, "meta", "_journal.json"),
  path.join(dist, ".openai", "drizzle", "meta", "_journal.json"),
);
rmSync(path.join(dist, "catalog-options.js"), { force: true });
rmSync(path.join(dist, "server", "catalog-options.js"), { force: true });
const workerTemplate = readFileSync(worker, "utf8").replaceAll("\r\n", "\n");
if (!workerTemplate.includes(catalogImport)) throw new Error("Missing catalog options import in Worker source");
if (!workerTemplate.includes(catalogReadabilityImport)) throw new Error("Missing catalog readability import in Worker source");
const catalogOptionsSource = readFileSync(catalogOptions, "utf8").replaceAll("export const ", "const ");
const catalogReadabilitySource = readFileSync(catalogReadability, "utf8")
  .replace("export function formatCatalogBulletText", "function formatCatalogBulletText")
  .replace("export function classifyCatalogReadability", "function classifyCatalogReadability");
const workerSource = workerTemplate
  .replace(catalogImport, catalogOptionsSource)
  .replace(catalogReadabilityImport, catalogReadabilitySource)
  .replace("export function inferBusinessSubcategories", "function inferBusinessSubcategories")
  .replace("export function validateCatalogProgram", "function validateCatalogProgram")
  .replace("export function validateRoadmapDocumentForStorage", "function validateRoadmapDocumentForStorage");
writeFileSync(path.join(dist, "server", "index.js"), workerSource);
copyFileSync(hosting, path.join(dist, ".openai", "hosting.json"));
copyFileSync(catalogTagPolicy, path.join(dist, "catalog-tag-policy.js"));

console.log("Prepared Sites build: worker, hosting config, and D1 migrations");
