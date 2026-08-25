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
  // Two windows means two curves. min: 2 is the point of the check - one curve
  // is the failure this chart type has that the others do not, and it is
  // invisible to a "did anything draw" assertion.
  compare: { selector: "path.recharts-line-curve", min: 2 },
  // A row header per category, same as the heatmap: the marks are positioned
  // divs with no class of their own.
  movers: { selector: "th[scope=row]", min: 1 },
  // A row header per category. The coloured swatches are divs with no class of
  // their own, so the row headers are what proves the grid was built.
  heatmap: { selector: "th[scope=row]", min: 1 },
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
  /*
   * One query owns many charts, and each chart is its own card. Iterating
   * queries alone stopped working when chart configuration moved off
   * SavedQuery: `query.chart_type` became undefined, every expectation lookup
   * missed, and this lane quietly asserted nothing at all while still printing
   * a pass. Flatten to charts so the unit checked is the unit rendered.
   */
  const cards = queries.flatMap((query) =>
    (query.charts ?? []).map((chart) => ({ query, chart })),
  );
  if (cards.length === 0) {
    console.error("no charts on any query - run: node scripts/dev-seed.mjs");
    process.exit(2);
  }

  for (const { query, chart } of cards) {
    const expectation = EXPECTATIONS[chart.chart_type];
    if (!expectation) {
      // A chart type with no expectation is a hole in this lane, not a skip.
      failures.push(`${chart.name} is a ${chart.chart_type} chart with no smoke expectation`);
      continue;
    }

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
    const card = page.locator(`article[aria-label="${chart.name}"]`);

    if (rows === 0) {
      const empty = await card.getByText("No rows in range").count();
      const ok = empty > 0;
      console.log(
        `${ok ? "ok  " : "FAIL"} ${chart.chart_type.padEnd(8)} ${chart.name.padEnd(28)} 0 rows, empty state shown=${ok}`,
      );
      if (!ok) failures.push(`${chart.name} returned no rows but showed no empty state`);
      continue;
    }

    const count = await card.locator(expectation.selector).count();
    const ok = count >= expectation.min;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${chart.chart_type.padEnd(8)} ${chart.name.padEnd(28)} ${count} ${expectation.selector} (${rows} rows)`,
    );
    if (!ok) {
      failures.push(
        `${chart.name} (${chart.chart_type}) has ${rows} rows but drew ${count} ${expectation.selector}`,
      );
    }
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

    /*
     * Only meaningful with a second card to open. Counting first rather than
     * reading `nth(1)` straight: on a connection with one saved query that
     * read blocks for the full timeout and then throws, which killed the whole
     * lane over a check that simply did not apply.
     */
    const second = page.locator("article[aria-label]").nth(1);
    const secondName =
      (await page.locator("article[aria-label]").count()) > 1
        ? await second.getAttribute("aria-label")
        : null;
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

  /*
   * The preview panel has to clip.
   *
   * `max-h-80` alone capped the panel's box and clipped nothing, so a 100-row
   * preview painted straight down over the Flag rules panel below it - heading,
   * help text and all. jsdom cannot see this: it has no layout, so a table that
   * overflows its parent and one that scrolls inside it are the same DOM. Only
   * a real browser can say whether one panel is covering another.
   */
  {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`${BASE}/connections/${connection.id}/queries/new`, {
      waitUntil: "networkidle",
    });
    // A fill before hydration lands on the DOM node only, never on React state,
    // and Preview then no-ops on empty SQL.
    await page.waitForTimeout(1500);

    const runPreview = async (sql) => {
      await page.locator("#query-sql").fill(sql);
      await page.waitForTimeout(150);
      await page.getByRole("button", { name: "Preview" }).first().click();
      await page.locator("table").first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(300);
    };

    const measure = () =>
      page.evaluate(() => {
        const sections = [...document.querySelectorAll("section")];
        const byTitle = (title) =>
          sections.find(
            (section) =>
              section.querySelector(":scope > header h2")?.textContent?.trim() === title,
          );
        const preview = byTitle("Preview");
        const rules = byTitle("Flag rules");
        // A capped box that clips nothing still reports scrollHeight past its
        // clientHeight, so overflowing and scrolling look identical here unless
        // the overflow style is part of what makes something a scroller.
        const scroller = [...preview.querySelectorAll("div")].find(
          (node) =>
            node.scrollHeight > node.clientHeight + 1 &&
            getComputedStyle(node).overflowY !== "visible",
        );

        // What is actually on screen where the Flag rules panel is: if a preview
        // cell answers at those coordinates, it is painting over the rules.
        const box = rules.getBoundingClientRect();
        let coveredPoints = 0;
        for (let y = box.top + 4; y < Math.min(box.bottom, innerHeight) - 4; y += 12) {
          for (let x = box.left + 8; x < box.right - 8; x += 40) {
            const at = document.elementFromPoint(x, y);
            if (at && preview.contains(at)) coveredPoints += 1;
          }
        }

        let scrolled = false;
        if (scroller) {
          scroller.scrollTop = 120;
          scrolled = scroller.scrollTop > 0;
          scroller.scrollTop = 0;
        }

        return {
          previewHeight: Math.round(preview.getBoundingClientRect().height),
          rulesOnScreen: box.top < innerHeight,
          coveredPoints,
          scroller: scroller
            ? {
                clientHeight: scroller.clientHeight,
                scrollHeight: scroller.scrollHeight,
                focusable: scroller.tabIndex >= 0,
                scrolled,
              }
            : null,
        };
      });

    await runPreview(
      "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 120)" +
        " SELECT n AS row_no, n * 7 AS amount FROM seq",
    );
    await page
      .locator('section:has(> header h2:text-is("Flag rules"))')
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const many = await measure();

    const previewChecks = [
      ["long preview scrolls instead of overflowing", many.scroller !== null && many.scroller.scrolled],
      ["long preview never covers the Flag rules panel", many.coveredPoints === 0],
      ["the scroll area is keyboard reachable", many.scroller !== null && many.scroller.focusable],
    ];

    // The cap is a max, not a height: a two-row preview stays two rows tall.
    await runPreview("SELECT 1 AS row_no, 2 AS amount");
    const few = await measure();
    previewChecks.push(["a short preview is not padded to the cap", few.previewHeight < 200]);

    for (const [label, ok] of previewChecks) {
      console.log(`${ok ? "ok  " : "FAIL"} preview ${label}`);
      if (!ok) failures.push(`preview panel: ${label} failed`);
    }
    if (many.scroller) {
      console.log(
        `     preview ${many.scroller.clientHeight}px visible of ${many.scroller.scrollHeight}px, short preview ${few.previewHeight}px tall`,
      );
    }
  }

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
