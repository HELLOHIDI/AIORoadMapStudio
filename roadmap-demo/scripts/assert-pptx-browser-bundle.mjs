#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clientRoot = resolve(projectRoot, "dist/client");
const textExtensions = new Set([".js", ".mjs", ".cjs", ".map"]);

async function collectTextBundles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectTextBundles(path);
    return textExtensions.has(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}

const bundleFiles = await collectTextBundles(clientRoot);
assert.ok(bundleFiles.length > 0, "The production client bundle is missing");

const offenders = [];
for (const file of bundleFiles) {
  const source = await readFile(file, "utf8");
  if (source.includes("image-size")) offenders.push(file);
}

assert.deepEqual(
  offenders,
  [],
  `The browser bundle must not include the vulnerable image-size parser: ${offenders.join(", ")}`,
);
console.log(`Verified ${bundleFiles.length} browser bundle files: image-size is absent`);
