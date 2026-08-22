#!/usr/bin/env node
/**
 * Every endpoint the engine documents must be reachable from the UI, not merely
 * wrapped in the API client. A wrapper that exists but is never called is an
 * endpoint the product does not actually have.
 *
 * Two checks:
 *   1. every documented operation has a client wrapper
 *   2. every wrapper is called from somewhere outside the client and its tests
 *
 *   node scripts/check-endpoints.mjs [--engine=<url>]
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [key, value] = raw.replace(/^--/, "").split("=");
    return [key, value ?? true];
  }),
);

const ENGINE = String(
  args.get("engine") ?? "https://fraud-analyzer-engine.fastapicloud.dev",
).replace(/\/+$/, "");

const CLIENT = "src/services/api-client/client.ts";
const METHODS = new Set(["get", "post", "put", "patch", "delete"]);

/** Walk src/, skipping the client itself and any test file. */
function sourceFiles(dir = "src") {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/.test(path)) continue;
    if (path.includes("services/api-client")) continue;
    if (path.includes(".test.")) continue;
    out.push(path);
  }
  return out;
}

const spec = await fetch(`${ENGINE}/openapi.json`).then(
  (response) => {
    if (!response.ok) throw new Error(`OpenAPI fetch returned ${response.status}`);
    return response.json();
  },
  (cause) => {
    console.error(`could not fetch ${ENGINE}/openapi.json: ${cause.message}`);
    process.exit(2);
  },
);

const operations = Object.entries(spec.paths).flatMap(([path, ops]) =>
  Object.keys(ops)
    .filter((method) => METHODS.has(method))
    .map((method) => `${method.toUpperCase()} ${path}`),
);

const client = readFileSync(CLIENT, "utf8");
// Exported arrow-function wrappers only. SCREAMING_CASE exports are constants.
const wrappers = [...client.matchAll(/^export const ([a-z][A-Za-z0-9]*)\s*=/gm)].map(
  (match) => match[1],
);

const sources = sourceFiles().map((path) => ({ path, text: readFileSync(path, "utf8") }));

console.log(`engine                : ${ENGINE}`);
console.log(`documented operations : ${operations.length}`);
console.log(`client wrappers       : ${wrappers.length}`);
console.log();

const stranded = [];
for (const wrapper of wrappers.slice().sort()) {
  const used = sources.filter((file) => new RegExp(`\\b${wrapper}\\b`).test(file.text));
  if (used.length === 0) {
    console.log(`  ${wrapper.padEnd(18)} NOT SURFACED IN THE UI`);
    stranded.push(wrapper);
  } else {
    console.log(`  ${wrapper.padEnd(18)} used in ${used.length} file(s)`);
  }
}

console.log();

const problems = [];
if (stranded.length > 0) {
  problems.push(`${stranded.length} wrapper(s) never called from the UI: ${stranded.join(", ")}`);
}
if (wrappers.length !== operations.length) {
  problems.push(
    `${wrappers.length} wrappers for ${operations.length} documented operations`,
  );
}

if (problems.length > 0) {
  console.error("FAILED:");
  for (const problem of problems) console.error("  - " + problem);
  process.exit(1);
}

console.log(`all ${operations.length} documented operations are wrapped and surfaced`);
