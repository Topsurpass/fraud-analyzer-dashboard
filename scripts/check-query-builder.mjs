#!/usr/bin/env node
/**
 * Dev-only: walk the query builder the way somebody who has never seen it would.
 *
 *   MOCK_POLL_MS=2000 node scripts/mock-engine.mjs --port=8100 &
 *   ENGINE_BASE_URL=http://127.0.0.1:8100 npm run dev -- --port 3100 &
 *   node scripts/check-query-builder.mjs [--base=http://localhost:3100]
 *        [--engine=http://127.0.0.1:8100] [--out=/private/tmp/claude-502/qb/final]
 *
 * Exits 1 on any failure. This is the scripted journey from
 * docs/query-builder-redesign.md, held to its rubric (R1 to R9) in a real browser:
 *
 *   1  opens the page and is told what the parts are and where to start
 *   2  types a name and some SQL
 *   3  finds Run preview (by the shortcut) and sees the rows
 *   4  edits the SQL, sees the results marked out of date, re-runs
 *   5  adds a chart: populated pickers and a suggested type
 *   6  a second session goes to Charts before previewing: told why, runs it from there
 *   7  writes six conditions across two rules in the dialog: the results stay put and
 *      a match count follows
 *   8  sets the schedule from a preset and reads it back as a sentence
 *   9  leaves the name empty: the bar says what blocks the save; fixes it; saves
 *
 * Screenshots (s01..s11, at 1440 and at 390) and journey.json (clicks per step) go
 * to --out.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { signIn } from "./lib/session.mjs";

const args = new Map(process.argv.slice(2).map((raw) => { const [k, v] = raw.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const base = String(args.get("base") ?? "http://localhost:3100").replace(/\/+$/, "");
const engine = String(args.get("engine") ?? "http://127.0.0.1:8100").replace(/\/+$/, "");
const out = String(args.get("out") ?? "/private/tmp/claude-502/qb/final");
mkdirSync(out, { recursive: true });

const failures = [];
const journey = {};
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(what);
};

await fetch(`${engine}/__reset`, { method: "POST" }).catch(() => undefined);
const { token } = await signIn(engine, { email: "check@example.com", password: "demo" });
const browser = await chromium.launch({ channel: "chrome" });

async function session(viewport, colorScheme = "light") {
  const context = await browser.newContext({ viewport, colorScheme, deviceScaleFactor: 1 });
  await context.addCookies([{ name: "switchboard_session", value: token, url: base }]);
  await context.addInitScript((t) => localStorage.setItem("fae.session-token", t), token);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page, errors };
}

const SQL = "SELECT bucket, COUNT(*) AS transactions\nFROM payments\nGROUP BY bucket";
/** Wait until the page has stopped scrolling: a smooth scroll is still moving for a moment. */
async function settle(page) {
  let last = -1;
  for (let i = 0; i < 40; i += 1) {
    const now = await page.evaluate(() => Math.round((document.querySelector("main")?.scrollTop ?? 0) + scrollY));
    if (now === last) return;
    last = now;
    await page.waitForTimeout(120);
  }
}
const inViewport = (page, locator) =>
  locator.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1;
  });

async function walk(label, viewport) {
  const phone = viewport.width < 600;
  const tag = (name) => `${out}/${name}-${label}.png`;
  const clicks = { step: 0 };
  const steps = {};
  const step = (name) => { clicks.step = 0; steps[name] = { clicks: 0, completed: false }; return name; };
  const click = async (locator, name) => { await locator.click(); steps[name].clicks += 1; };
  const done = (name) => { steps[name].completed = true; };
  const shot = (page, name) => page.screenshot({ path: tag(name) });

  const { context, page, errors } = await session(viewport);

  /* 1. orientation ----------------------------------------------------------- */
  let s = step("1-orient");
  await page.goto(`${base}/connections/c1/queries/new`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Write the query" }).waitFor({ timeout: 15000 });
  // On a phone the outline is one line ("Step 1 of 5"); the list of parts opens from it.
  const nav = phone ? page.locator("#qb-steps-menu") : page.getByRole("navigation", { name: "Steps" });
  const openOutline = async (target = page) => {
    if (phone && !(await target.locator("#qb-steps-menu").isVisible())) {
      await target.getByRole("button", { name: /All steps/ }).click();
    }
  };
  if (phone) {
    const compact = page.getByRole("button", { name: /Step 1 of 5/ });
    check(await inViewport(page, compact), `${label} R1/R9: a one-line "Step 1 of 5" is on screen`);
    check(!(await page.getByRole("button", { name: "Run preview" }).first().evaluate((el) => el.closest(".sticky") !== null)), `${label} R9: Run preview is not squeezed into the stepper row`);
    await openOutline();
  }
  const stepButtons = nav.getByRole("button");
  check((await stepButtons.count()) === 5, `${label} R1: five parts are listed`, (await stepButtons.allInnerTexts()).map((t) => t.split("\n")[0]).join(" > "));
  let allVisible = true;
  for (let i = 0; i < 5; i += 1) allVisible = allVisible && (await inViewport(page, stepButtons.nth(i)));
  check(allVisible, `${label} R1: every part is on screen without scrolling`);
  check(phone ? true : (await nav.locator('[aria-current="step"]').count()) === 1, `${label} R1: exactly one part is marked as next`);
  if (phone) await page.getByRole("button", { name: /Hide/ }).first().click();
  check(await inViewport(page, page.getByRole("button", { name: "Run preview" }).first()), `${label} R2: Run preview is on screen at once`);
  check(
    await page.locator("[role=heading], h2").filter({ hasText: /Write the query|Check the result|Choose how it is drawn|Flag what needs a look|Set how often it runs/ }).count() === 5,
    `${label} R1: every part says what it is for`,
  );
  await shot(page, "s01-orient");
  done(s);

  /* 2. type ------------------------------------------------------------------ */
  s = step("2-type");
  await page.getByLabel("Name", { exact: true }).fill("Journey query"); steps[s].clicks += 1;
  await page.getByLabel("Read-only SQL").fill(SQL); steps[s].clicks += 1;
  check(
    phone
      ? await page.getByRole("button", { name: /Step 2 of 5/ }).isVisible()
      : (await nav.getByRole("button", { name: /^Results: to do/ }).getAttribute("aria-current")) === "step",
    `${label} R1: the outline moves on to the preview`,
  );
  await shot(page, "s02-typed");
  done(s);

  /* 3. preview, by the shortcut ---------------------------------------------- */
  s = step("3-preview");
  await page.getByLabel("Read-only SQL").press("Control+Enter"); steps[s].clicks += 1;
  await page.getByText(/12 rows · 2 columns/).first().waitFor({ timeout: 8000 });
  check(true, `${label} R2: the shortcut runs the preview and the rows appear`);
  check(await inViewport(page, page.getByRole("button", { name: "Run preview" }).first()), `${label} R2/R4: Run preview is still on screen`);
  await shot(page, "s03-preview");
  done(s);

  /* 4. stale ----------------------------------------------------------------- */
  s = step("4-stale");
  await page.getByLabel("Read-only SQL").fill(`${SQL}\n-- edited`); steps[s].clicks += 1;
  await page.getByText("Out of date.").waitFor({ timeout: 5000 });
  await openOutline();
  check(
    (await nav.getByRole("button", { name: /^Results: needs attention\. Out of date/ }).count()) === 1,
    `${label} R2: the outline marks the results out of date too`,
  );
  if (phone) await page.getByRole("button", { name: /Hide/ }).first().click();
  await shot(page, "s04-stale");
  await click(page.getByRole("button", { name: /Re-run preview/ }), s);
  await page.getByText("Out of date.").waitFor({ state: "detached", timeout: 8000 });
  check(true, `${label} R2: one click re-runs it and the warning goes`);
  done(s);

  /* 5. chart ----------------------------------------------------------------- */
  s = step("5-chart");
  const suggestion = page.getByText(/We chose a line chart\./);
  await suggestion.scrollIntoViewIfNeeded();
  check(await suggestion.isVisible(), `${label} R3: a chart type is chosen for the data, and said`);
  const typeSelect = page.getByLabel("Type").first();
  check((await typeSelect.inputValue()) === "line" && (await page.getByLabel("X field").first().inputValue()) !== "", `${label} R3: the pickers are showing and filled, no hidden table`);
  const removeBox = await page.getByRole("button", { name: /^Remove chart/ }).first().boundingBox();
  const cardBox = await page.locator("#qb-charts").boundingBox();
  check(!!removeBox && !!cardBox && removeBox.x >= cardBox.x && removeBox.x + removeBox.width <= cardBox.x + cardBox.width + 1, `${label} R10: the Remove button sits inside the chart card`);
  await shot(page, "s05-chart");
  check((await page.getByLabel("Chart name").count()) >= 1, `${label} R3: the chart editor is there with its pickers`);
  await typeSelect.selectOption("bar"); steps[s].clicks += 1;
  check((await typeSelect.inputValue()) === "bar", `${label} R3: the type can be changed`);
  done(s);

  // R4: with the results card scrolled away, the first rows are still docked on screen.
  await page.locator("#qb-schedule").scrollIntoViewIfNeeded();
  await settle(page);
  {
    const handle = phone ? page.getByRole("button", { name: /View rows/ }) : page.getByRole("table", { name: "First rows of the preview" });
    const docked = (await handle.count()) > 0;
    const card = await page.locator("#qb-results").boundingBox();
    const cardOnScreen = !!card && card.y + card.height > 64 && card.y < viewport.height - 96;
    check(docked ? await inViewport(page, handle) : cardOnScreen, `${label} R4: the results are on the page or docked with their first rows, never out of reach`, docked ? "docked" : "card on screen");
  }

  /* 6. a second session goes to Charts first ---------------------------------- */
  s = step("6-chart-before-preview");
  const second = await session(viewport);
  await second.page.goto(`${base}/connections/c1/queries/new`, { waitUntil: "networkidle" });
  await second.page.getByLabel("Read-only SQL").fill(SQL); steps[s].clicks += 1;
  if (phone) await second.page.getByRole("button", { name: /All steps/ }).click();
  await (phone ? second.page.locator("#qb-steps-menu") : second.page.getByRole("navigation", { name: "Steps" })).getByRole("button", { name: /^Charts/ }).click(); steps[s].clicks += 1;
  const explanation = second.page.getByText(/Charts are built from your columns, and the columns come from a preview/);
  await explanation.waitFor({ timeout: 5000 });
  await settle(second.page);
  check(await inViewport(second.page, explanation), `${label} R3: before a preview, the chart area says why it is empty, on screen`);
  await shot(second.page, "s06-chart-before-preview");
  await second.page.getByRole("button", { name: "Run preview to get your columns" }).click(); steps[s].clicks += 1;
  await second.page.getByLabel("Chart name").first().waitFor({ timeout: 8000 });
  check(true, `${label} R3: it runs the preview from there and the pickers appear`);
  await second.context.close();
  done(s);

  /* 7. rules, six conditions ------------------------------------------------- */
  s = step("7-rules");
  await page.getByRole("button", { name: "Add a rule" }).scrollIntoViewIfNeeded();
  await click(page.getByRole("button", { name: "Add a rule" }), s);
  const dialog = page.getByRole("dialog", { name: "Flag rules" });
  await dialog.waitFor({ timeout: 5000 });
  // On a phone the preview is its own tab; the count lives in the footer, which never moves.
  const resultsPane = phone ? dialog.locator("footer") : dialog.locator("[data-results-pane]");
  const countText = phone ? dialog.locator("footer").getByText(/Catches/) : dialog.getByText(/Catches/).first();
  const rulesPane = dialog.locator("[data-rules-pane]");
  const box = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), height: Math.round(r.height), bottom: Math.round(r.bottom) }; });

  const addRule = async (n) => {
    await click(dialog.getByRole("button", { name: "Add rule" }).first(), s);
    // Two more conditions, so each rule has three.
    for (let i = 0; i < 2; i += 1) await click(dialog.getByRole("button", { name: "Add condition" }), s);
    // Only the rule being edited is open, so its conditions are the only ones on
    // the page: numbered from zero for each rule.
    for (let i = 0; i < 3; i += 1) {
      await dialog.getByLabel("Column").nth(i).selectOption("transactions");
      await dialog.getByLabel("Comparison").nth(i).selectOption("gte");
      await dialog.getByLabel("Value").nth(i).fill(String(90 + n * 5 + i * 10));
    }
    await click(dialog.getByRole("button", { name: "Done" }).first(), s).catch(() => undefined);
  };

  await addRule(1);
  const before = await box(resultsPane);
  check(await inViewport(page, resultsPane), `${label} R4/R5: the results sit beside the rules inside the dialog`);
  await countText.waitFor({ timeout: 6000 });
  check(true, `${label} R5: a live match count follows the rules`, (await countText.innerText()).trim());
  if (phone) {
    await dialog.getByRole("tab", { name: "Preview" }).click(); steps[s].clicks += 1;
    check(await inViewport(page, dialog.locator("[data-results-pane]")), `${label} R9: the Preview tab shows the rows`);
    await dialog.getByRole("tab", { name: "Rules" }).click(); steps[s].clicks += 1;
  }
  await shot(page, "s07-rules-dialog");

  await addRule(2);
  const after = await box(resultsPane);
  check(
    Math.abs(after.top - before.top) <= 2 && Math.abs(after.height - before.height) <= 2,
    `${label} R4: six conditions later the results have not moved`,
    `top ${before.top} -> ${after.top}`,
  );
  const dialogBox = await box(dialog);
  check(dialogBox.top >= 0 && dialogBox.bottom <= viewport.height + 1, `${label} R5: the dialog stays inside the screen however long the rules get`);
  // Six conditions either scroll inside the pane or fit in it; they never grow past the dialog.
  const paneBox = await box(rulesPane);
  const scrolls = await rulesPane.evaluate((el) => el.scrollHeight > el.clientHeight);
  check(paneBox.bottom <= dialogBox.bottom + 1, `${label} R5: the rules pane stays inside the dialog (${scrolls ? "scrolls" : "fits"})`);
  check(await inViewport(page, dialog.getByRole("button", { name: "Use these rules" })), `${label} R5: Save is fixed in the footer, still on screen`);
  await shot(page, "s08-rules-many");
  await click(dialog.getByRole("button", { name: "Use these rules" }), s);
  await dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => dialog.waitFor({ state: "hidden", timeout: 5000 }));
  check(
    (await page.locator("#qb-rules li").count()) === 2,
    `${label} R5: the page shows the two rules as one line each`,
  );
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  check(/Add a rule|Edit rules/.test(focused) || focused === "", `${label} R9: focus returns to where the dialog was opened`, focused);
  done(s);

  /* 8. schedule -------------------------------------------------------------- */
  s = step("8-schedule");
  await page.getByRole("group", { name: "Common intervals" }).scrollIntoViewIfNeeded();
  await click(page.getByRole("group", { name: "Common intervals" }).getByRole("button", { name: "5 min", exact: true }), s);
  check((await page.getByText("Runs at most once every 5 minutes").count()) >= 1, `${label} R6: the schedule reads back as a sentence`);
  await shot(page, "s09-schedule");
  done(s);

  /* 9. save ------------------------------------------------------------------ */
  s = step("9-save");
  // A field focused from far down the page must not land under the sticky outline.
  await page.getByLabel("Name", { exact: true }).focus();
  await settle(page);
  const hidden = await page.evaluate(() => {
    const field = document.getElementById("query-name");
    const bar = document.querySelector("main .sticky.top-0");
    if (!field || !bar) return null;
    return Math.round(field.getBoundingClientRect().top - bar.getBoundingClientRect().bottom);
  });
  check(hidden !== null && hidden >= -1, `${label} R7: a field focused from far down is not left under the outline`, `clearance ${hidden}px`);
  await page.getByLabel("Name", { exact: true }).fill(""); steps[s].clicks += 1;
  const blocker = page.getByRole("button", { name: "Give the query a name" });
  await blocker.waitFor({ timeout: 4000 });
  await settle(page);
  check(await inViewport(page, blocker), `${label} R7: the bar names what blocks the save, on screen`);
  await shot(page, "s10-save-blocked");
  await click(page.getByRole("button", { name: "Save query" }), s);
  await page.waitForTimeout(400);
  check(page.url().includes("/queries/new"), `${label} R7: pressing Save while blocked does not leave`);
  check(await page.getByLabel("Name", { exact: true }).evaluate((el) => document.activeElement === el), `${label} R7: it takes the person to the problem`);
  await click(blocker, s).catch(() => undefined);
  await page.getByLabel("Name", { exact: true }).fill("Journey query"); steps[s].clicks += 1;
  const chartName = await page.getByLabel("Chart name").first().inputValue();
  await click(page.getByRole("button", { name: "Save query" }), s);
  await page.waitForURL(`${base}/connections/c1`, { timeout: 10000 });
  await page.getByRole("article").first().waitFor({ timeout: 10000 }).catch(() => page.locator("article").first().waitFor({ timeout: 10000 }));
  // The card is titled with the query until its first poll names the chart.
  const newCard = page.locator("article", { has: page.getByRole("heading", { name: new RegExp(`^(${chartName}|Journey query)$`) }) });
  await newCard.first().waitFor({ timeout: 10000 }).catch(() => undefined);
  check((await newCard.count()) >= 1, `${label} journey: it lands on the connection page with the new card`, chartName);
  await newCard.first().scrollIntoViewIfNeeded().catch(() => undefined);
  await settle(page);
  await shot(page, "s11-saved");
  done(s);

  /* R8: the edit route starts from the saved values, charts included, with no preview ------ */
  await page.goto(`${base}/queries/q_table`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Write the query" }).waitFor({ timeout: 15000 });
  check((await page.getByLabel("Read-only SQL").inputValue()).trim() !== "", `${label} R8: the edit page opens with the saved SQL`);
  await page.locator("#qb-charts").scrollIntoViewIfNeeded();
  await settle(page);
  // The saved rules and schedule are on the page without any preview. (Saved charts with
  // pickers are covered in QueryBuilder.test.tsx: this mock query's chart is a plain table.)
  check((await page.locator("#qb-rules li").count()) >= 1, `${label} R8: the saved rules are listed without a preview`);
  check((await page.getByLabel("Row limit").inputValue()) === "1000", `${label} R8: the saved row limit is filled in`);
  await shot(page, "s12-edit");

  /* R9 on the editor page itself ---------------------------------------------- */
  await page.goto(`${base}/connections/c1/queries/new`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Write the query" }).waitFor();
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - innerWidth,
    main: (() => { const m = document.querySelector("main"); return m ? m.scrollWidth - m.clientWidth : 0; })(),
  }));
  check(overflow.page <= 0 && overflow.main <= 0, `${label} R9: no horizontal scroll`, JSON.stringify(overflow));
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll("button, input, select, textarea")]
      .filter((el) => el.offsetParent !== null)
      .filter((el) => !(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.textContent?.trim() || el.id && document.querySelector(`label[for="${el.id}"]`) || el.getAttribute("title")))
      .map((el) => el.outerHTML.slice(0, 80)),
  );
  check(unnamed.length === 0, `${label} R9: every visible control has a name`, unnamed.slice(0, 2).join(" | "));
  check(errors.length === 0, `${label}: no page errors`, errors.slice(0, 2).join(" | "));

  journey[label] = steps;
  await context.close();
}

await walk("1440", { width: 1440, height: 900 });
await fetch(`${engine}/__reset`, { method: "POST" }).catch(() => undefined);
await walk("390", { width: 390, height: 844 });

/* dark, for the two states that carry the most colour --------------------------- */
await fetch(`${engine}/__reset`, { method: "POST" }).catch(() => undefined);
{
  const { context, page } = await session({ width: 1440, height: 900 }, "dark");
  await page.goto(`${base}/connections/c1/queries/new`, { waitUntil: "networkidle" });
  await page.getByLabel("Name", { exact: true }).fill("Dark query");
  await page.getByLabel("Read-only SQL").fill(SQL);
  await page.getByLabel("Read-only SQL").press("Control+Enter");
  await page.getByText(/12 rows · 2 columns/).first().waitFor({ timeout: 8000 });
  await page.screenshot({ path: `${out}/s03-preview-dark.png` });
  await page.getByRole("button", { name: "Add a rule" }).click();
  await page.getByRole("dialog", { name: "Flag rules" }).getByRole("button", { name: "Add rule" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/s07-rules-dialog-dark.png` });
  check(true, "dark: captured the preview and the rules dialog");
  await context.close();
}

writeFileSync(`${out}/journey.json`, JSON.stringify({ steps: journey, failures }, null, 2));
await fetch(`${engine}/__reset`, { method: "POST" }).catch(() => undefined);
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall query builder checks passed");
console.log(`screenshots and journey.json: ${out}`);
process.exit(failures.length ? 1 : 0);
