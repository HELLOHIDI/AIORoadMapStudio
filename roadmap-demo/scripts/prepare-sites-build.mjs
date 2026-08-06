#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const index = path.join(dist, "client", "index.html");
const worker = path.join(root, "worker", "index.js");
const hosting = path.join(root, ".openai", "hosting.json");
const migrations = path.join(root, "drizzle");
const catalogOptions = path.join(root, "catalog-options.js");

for (const file of [index, worker, hosting, migrations, catalogOptions]) {
  if (!existsSync(file)) throw new Error("Missing Sites build input: " + file);
}

mkdirSync(path.join(dist, "server"), { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });
mkdirSync(path.join(dist, ".openai", "drizzle"), { recursive: true });
copyFileSync(worker, path.join(dist, "server", "index.js"));
copyFileSync(catalogOptions, path.join(dist, "catalog-options.js"));
copyFileSync(hosting, path.join(dist, ".openai", "hosting.json"));
for (const migration of readdirSync(migrations).filter((name) => name.endsWith(".sql"))) {
  copyFileSync(path.join(migrations, migration), path.join(dist, ".openai", "drizzle", migration));
}

console.log("Prepared Sites build: worker, hosting config, and D1 migrations");
