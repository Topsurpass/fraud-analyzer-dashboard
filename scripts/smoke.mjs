#!/usr/bin/env node
/**
 * Render smoke test: does every chart type actually put marks on screen?
 *
 * This exists because the gate suite structurally cannot catch the worst bug
 * this project has hit. Recharts computes geometry from real layout, so in
 * jsdom a chart that renders zero bars and a chart that renders ten look
 * identical - both are "a <BarChart /> that mounted without throwing". Twice
 * during development a library-level animation defect left charts permanently
 * blank while every unit test stayed green.
 *
 * So this lane runs a real browser against a real engine and asserts on the
 * actual SVG geometry. It is not a gate test: it needs the dev server and the
 * engine up, and it costs seconds, not milliseconds. Run it before shipping.
 *
 *   node scripts/dev-seed.mjs && npm run dev      # in another shell
 *   node scripts/smoke.mjs
 *
 * Flags: --base=<url> (default http://localhost:3000)
 *        --engine=<url> (default http://127.0.0.1:8000)
 */

import { chromium } from "playwright";

const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [key, value] = raw.replace(/^--/, "").split("=");
    return [key, value ?? true];
  }),
);

const BASE = String(args.get("base") ?? "http://localhost:3000").replace(/\/+$/, "");
const ENGINE = String(args.get("engine") ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

/**
 * `localhost`, not `127.0.0.1`: Next's dev-origin protection answers its own
 * chunks with a 403 to the latter, so the page renders server markup and never
 * hydrates - which looks exactly like a broken app.
 */
if (BASE.includes("127.0.0.1")) {
  console.warn("warning: use http://localhost:3000, not 127.0.0.1 - dev chunks 403 otherwise");
}

/** What counts as "this chart drew something" for each chart type. */
const EXPECTATIONS = {
  line: { selector: "path.recharts-line-curve", min: 1 },
  bar: { selector: "path.recharts-rectangle", min: 1 },
  pie: { selector: "path.recharts-sector", min: 1 },
  number: { selector: ".tnum", min: 1 },
  table: { selector: "tbody tr", min: 1 },
};

async function main() {
  const connections = await fetch(`${ENGINE}/connections`).then((r) => r.json());
  if (!Array.isArray(connections) || connections.length === 0) {
    console.error("no connections on the engine - run: node scripts/dev-seed.mjs");
    process.exit(2);
  }

  const connection = connections[0];
  const queries = await fetch(`${ENGINE}/connections/${connection.id}/queries`).then((r) =>
    r.json(),
  );
  if (queries.length === 0) {
    console.error("no saved queries - run: node scripts/dev-seed.mjs");
    process.exit(2);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error).slice(0, 200)));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("_next/hmr")) {
      consoleErrors.push(message.text().slice(0, 200));
    }
  });

  await page.goto(`${BASE}/connections/${connection.id}`, { waitUntil: "networkidle" });
  // Let every card complete at least one poll and finish its enter animation.
  await page.waitForTimeout(9000);

  const failures = [];
  for (const query of queries) {
    const expectation = EXPECTATIONS[query.chart_type];
    if (!expectation) continue;

    const count = await page
      .locator(`article[aria-label="${query.name}"] ${expectation.selector}`)
      .count();

    const ok = count >= expectation.min;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${query.chart_type.padEnd(6)} ${query.name.padEnd(28)} ${count} ${expectation.selector}`,
    );
    if (!ok) failures.push(`${query.name} (${query.chart_type}) drew nothing`);
  }

  // A card must never fail silently: no card should be showing an error state.
  const stale = await page.locator("text=/^Stale/").count();
  if (stale > 0) failures.push(`${stale} card(s) are in a stale/error state`);

  // And the layout must not overflow horizontally at any width.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(2000);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  console.log(`${overflow ? "FAIL" : "ok  "} mobile  no horizontal overflow at 390px`);
  if (overflow) failures.push("horizontal overflow at 390px");

  await browser.close();

  if (consoleErrors.length > 0) {
    console.log("\nconsole errors:");
    for (const error of [...new Set(consoleErrors)]) console.log("  " + error);
    failures.push(`${new Set(consoleErrors).size} console error(s)`);
  }

  if (failures.length > 0) {
    console.error("\nSMOKE FAILED:");
    for (const failure of failures) console.error("  - " + failure);
    process.exit(1);
  }

  console.log("\nsmoke passed");
}

await main();
