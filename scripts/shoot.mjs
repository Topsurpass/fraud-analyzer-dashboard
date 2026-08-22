#!/usr/bin/env node
/**
 * Dev-only: screenshot a list of routes so the UI can actually be looked at.
 * node scripts/shoot.mjs <outDir> [--width=1440] [--height=900] [--wait=3500]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const args = new Map(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((raw) => {
    const [k, v] = raw.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const outDir = process.argv[2]?.startsWith("--") ? "./shots" : (process.argv[2] ?? "./shots");
const width = Number(args.get("width") ?? 1440);
const height = Number(args.get("height") ?? 900);
const wait = Number(args.get("wait") ?? 3500);
const base = String(args.get("base") ?? "http://127.0.0.1:3000");
const routes = String(args.get("routes") ?? "/").split(",");

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 2,
  colorScheme: "dark",
  reducedMotion: args.has("reduced") ? "reduce" : "no-preference",
});
const page = await context.newPage();

const problems = [];
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 300)}`));

for (const route of routes) {
  const name = route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
  const url = base + route;
  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch((e) => {
    problems.push(`goto ${route}: ${e.message.slice(0, 200)}`);
    return null;
  });
  await page.waitForTimeout(wait);
  const file = `${outDir}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log(`${route.padEnd(38)} ${response?.status() ?? "ERR"}  -> ${file}`);
}

if (problems.length) {
  console.log("\nBROWSER PROBLEMS:");
  for (const p of [...new Set(problems)]) console.log("  " + p);
} else {
  console.log("\nno console errors");
}

await browser.close();
