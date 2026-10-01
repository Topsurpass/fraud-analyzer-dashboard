#!/usr/bin/env node
/**
 * Rewrite the generated blocks of docs/query-cookbook.md from the example queries.
 *
 *   node scripts/sync-query-docs.mjs          # rewrite the file
 *   node scripts/sync-query-docs.mjs --check  # exit 1 if it is out of date
 *
 * Run it after changing scripts/lib/chart-examples.mjs. The test suite runs the
 * same check, so a stale doc fails the build rather than misleading a reader.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { examples } from "./lib/chart-examples.mjs";
import { renderDoc } from "./lib/query-docs.mjs";

const path = fileURLToPath(new URL("../docs/query-cookbook.md", import.meta.url));
const current = readFileSync(path, "utf8");
const next = renderDoc(current, examples());

if (process.argv.includes("--check")) {
  if (next !== current) {
    console.error("docs/query-cookbook.md is out of date. Run: node scripts/sync-query-docs.mjs");
    process.exit(1);
  }
  console.log("docs/query-cookbook.md is up to date");
} else if (next !== current) {
  writeFileSync(path, next);
  console.log("docs/query-cookbook.md updated");
} else {
  console.log("docs/query-cookbook.md already up to date");
}
