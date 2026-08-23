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

    /*
     * Ask the engine how many rows this query actually returns before deciding
     * what the card owes us. A time-windowed query outside its window returns
     * nothing, and a chart that correctly draws nothing must not be reported as
     * a chart that failed to draw - that would make this lane cry wolf and get
     * ignored, which is worse than not having it.
     */
    const poll = await fetch(`${ENGINE}/queries/${query.id}/poll?force=true`).then((r) =>
      r.json(),
    );
    const rows = poll.row_count ?? 0;
    const card = page.locator(`article[aria-label="${query.name}"]`);

    if (rows === 0) {
      const empty = await card.getByText("No rows in range").count();
      const ok = empty > 0;
      console.log(
        `${ok ? "ok  " : "FAIL"} ${query.chart_type.padEnd(6)} ${query.name.padEnd(28)} 0 rows, empty state shown=${ok}`,
      );
      if (!ok) failures.push(`${query.name} returned no rows but showed no empty state`);
      continue;
    }

    const count = await card.locator(expectation.selector).count();
    const ok = count >= expectation.min;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${query.chart_type.padEnd(6)} ${query.name.padEnd(28)} ${count} ${expectation.selector} (${rows} rows)`,
    );
    if (!ok) failures.push(`${query.name} (${query.chart_type}) has ${rows} rows but drew nothing`);
  }

  /*
   * The alert hatch has to actually paint.
   *
   * It is delivered as a `<defs><pattern>` handed to Recharts as a child, and
   * Recharts decides what to do with its children by scanning their component
   * type - this project has already been bitten twice by marks that silently
   * never rendered. jsdom cannot tell a painted pattern from a dropped one, so
   * the check belongs here: if any card reports a flagged series in its legend,
   * that card's SVG must carry the patterns behind it.
   */
  const hatched = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("article[aria-label]"));
    return cards
      .filter((card) => card.querySelector("svg path[stroke='#e5484d'], svg path[stroke='var(--signal-alert)']"))
      .map((card) => ({
        name: card.getAttribute("aria-label"),
        patterns: card.querySelectorAll("pattern").length,
        hatchedMarks: Array.from(card.querySelectorAll("path[fill^='url(#hatch-']")).length,
      }));
  });
  for (const card of hatched) {
    const ok = card.patterns > 0 && card.hatchedMarks > 0;
    console.log(
      `${ok ? "ok  " : "FAIL"} hatch  ${String(card.name).padEnd(28)} ${card.patterns} pattern(s), ${card.hatchedMarks} hatched mark(s)`,
    );
    if (!ok) failures.push(`${card.name} reports a flagged series but painted no hatch`);
  }
  if (hatched.length === 0) console.log("note: no card has a flagged series right now");

  /*
   * The card menu has to close.
   *
   * It is a `<details>` popover, which has no notion of "outside" on its own -
   * left unguarded it stays open after a choice and stays open when the page
   * behind it is clicked, so two can overlap the cards you were reading. jsdom
   * covers the logic; this covers it with real pointer events and real layout.
   */
  {
    const card = page.locator("article[aria-label]").first();
    const cardName = await card.getAttribute("aria-label");
    const trigger = card.getByLabel(`Actions for ${cardName}`);
    const openPanels = () => page.getByRole("button", { name: "Pie", exact: true }).count();

    const menuChecks = [];
    await trigger.click();
    await page.waitForTimeout(300);
    menuChecks.push(["opens", (await openPanels()) === 1]);

    await page.locator("main").click({ position: { x: 700, y: 760 } });
    await page.waitForTimeout(300);
    menuChecks.push(["closes on an outside click", (await openPanels()) === 0]);

    await trigger.click();
    await page.waitForTimeout(250);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    menuChecks.push(["closes on Escape", (await openPanels()) === 0]);

    const second = page.locator("article[aria-label]").nth(1);
    const secondName = await second.getAttribute("aria-label");
    if (secondName) {
      await trigger.click();
      await page.waitForTimeout(250);
      await second.getByLabel(`Actions for ${secondName}`).click();
      await page.waitForTimeout(350);
      menuChecks.push(["only one open at a time", (await openPanels()) === 1]);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    }

    for (const [label, ok] of menuChecks) {
      console.log(`${ok ? "ok  " : "FAIL"} menu    ${label}`);
      if (!ok) failures.push(`card menu: ${label} failed`);
    }
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
