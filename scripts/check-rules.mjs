#!/usr/bin/env node
/**
 * Dev-only: the flag rules view, held to its acceptance rubric in a real browser.
 *
 *   MOCK_POLL_MS=2000 node scripts/mock-engine.mjs --port=8100 &
 *   ENGINE_BASE_URL=http://127.0.0.1:8100 npm run dev -- --port 3100 &
 *   node scripts/check-rules.mjs [--base=http://localhost:3100] [--engine=http://127.0.0.1:8100]
 *
 * Exits 1 on any failure. It seeds four rules on the mock's `q_table` through the
 * API, so the check owns its data, and then looks at the rules the way a person
 * does:
 *
 *  1. Collapsed by default: one line per rule, each with its severity, name, an
 *     on/off switch and the sentence it stands for (list conditions by name, never
 *     an id), and the four of them together take a fraction of the old height.
 *  2. Opening: a click or the keyboard opens one rule; only one is open; a new rule
 *     opens at once with focus in its name.
 *  3. The editor: a condition is one aligned row, "and" is stated between them, a
 *     validation message sits under the field it is about, unsaved changes are
 *     marked, and an empty editor explains what a rule is.
 *  5. Fit: no sideways scroll and no control outside its panel at 390px and 1440px,
 *     every control has a name, text has enough contrast in light and dark, and
 *     focus lands on a control that still exists after each action.
 *  4. The read-only dialog uses the same sentence and holds no control.
 */
import { chromium } from "playwright";
import { signIn } from "./lib/session.mjs";

const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [k, v] = raw.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const base = String(args.get("base") ?? "http://localhost:3100").replace(/\/+$/, "");
const engine = String(args.get("engine") ?? "http://127.0.0.1:8100").replace(/\/+$/, "");
const password = String(args.get("password") ?? "demo");

const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(what);
};

const admin = (await signIn(engine, { email: "admin@example.com", password })).token;
const analyst = (await signIn(engine, { email: "analyst@example.com", password })).token;
const api = (token, path, init = {}) =>
  fetch(engine + path, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });

const lists = await (await api(admin, "/lists")).json();
const SEED = [
  {
    name: "Very large transfer",
    severity: "high",
    enabled: true,
    conditions: [
      { column_name: "amount", operator: "gte", value: "500000" },
      { column_name: "response_code", operator: "eq", value: "00" },
    ],
  },
  {
    name: "Terminal on the watchlist",
    severity: "high",
    enabled: true,
    conditions: [{ column_name: "terminal_id", operator: "in_list", list_id: lists[0]?.id }],
  },
  {
    name: "Mid-range risk",
    severity: "medium",
    enabled: true,
    conditions: [{ column_name: "risk_score", operator: "between", value: "70", value2: "100" }],
  },
  {
    name: "Missing beneficiary",
    severity: "low",
    enabled: false,
    conditions: [
      { column_name: "beneficiary", operator: "is_null" },
      { column_name: "amount", operator: "gt", value: "10000" },
      { column_name: "country", operator: "in", value: "NG, GH, KE, ZA, EG, MA, TZ" },
    ],
  },
];
await api(admin, "/queries/q_table/flag-rules", { method: "PUT", body: JSON.stringify({ rules: SEED }) });

const browser = await chromium.launch(args.has("no-chrome") ? {} : { channel: "chrome" });

async function open(token, path, { width, height, scheme = "light" }) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  await context.addCookies([{ name: "switchboard_session", value: token, url: base }]);
  const page = await context.newPage();
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  return { context, page };
}

const lines = (page) => page.getByRole("button", { name: /^(Edit|Close) rule / });
// The rules are written in a workspace dialog now (the page only summarises them).
const panelOf = (page) => page.getByRole("dialog", { name: "Flag rules" });

/** Contrast ratio of the rules' sentence text against what it sits on. */
const contrastOf = (page) =>
  page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const rgba = (css) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const backdrop = (el) => {
      for (let node = el; node; node = node.parentElement) {
        const c = rgba(getComputedStyle(node).backgroundColor);
        if (c.a > 0.95) return c;
      }
      return rgba(getComputedStyle(document.body).backgroundColor);
    };
    const worst = { ratio: 99, text: "" };
    const enabled = [...document.querySelectorAll('ul[aria-label="Flag rules"] > li')].filter(
      (li) => li.querySelector('[role="switch"][aria-checked="true"]'),
    );
    for (const li of enabled) {
      for (const span of li.querySelectorAll("button span span span, button span span")) {
        if (!span.textContent.trim() || span.children.length) continue;
        const fg = rgba(getComputedStyle(span).color);
        const bg = backdrop(span);
        const [a, b] = [lum(fg), lum(bg)];
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (ratio < worst.ratio) {
          worst.ratio = ratio;
          worst.text = span.textContent.trim().slice(0, 30);
        }
      }
    }
    return worst;
  });

/* 1 to 3 and 5: the editor, at both widths ------------------------------------ */
for (const [width, height, name] of [
  [1440, 1000, "1440px"],
  [390, 900, "390px"],
]) {
  const { context, page } = await open(admin, "/queries/q_table", { width, height });
  await page.getByRole("button", { name: "Edit rules" }).click();
  const panel = panelOf(page);
  await panel.waitFor();
  const all = lines(page);

  /* 1. collapsed by default */
  check((await all.count()) === 4, `${name}: four rules are four lines`, `${await all.count()} lines`);
  const states = await all.evaluateAll((els) => els.map((el) => el.getAttribute("aria-expanded")));
  check(states.every((s) => s === "false"), `${name}: every rule starts collapsed`);
  check((await page.getByLabel("Rule name").count()) === 0, `${name}: no editing field shows until a rule is opened`);
  const text = await all.evaluateAll((els) => els.map((el) => el.textContent ?? ""));
  check(/HIGH|high/i.test(text[0]) && text[0].includes("Very large transfer"), `${name}: a line carries its severity and name`);
  check(
    text[0].includes("amount is at least 500000 and response_code equals 00"),
    `${name}: and the sentence it stands for`,
    text[0].replace(/\s+/g, " ").slice(0, 110),
  );
  check(
    /terminal_id is in the list/.test(text[1]) && !/[0-9a-f]{8}-[0-9a-f]{4}|\bl\d+\b/.test(text[1].replace(/Blocked/g, "")),
    `${name}: a list is named, never shown as an id`,
    text[1].replace(/\s+/g, " ").slice(0, 90),
  );
  check(text[2].includes("risk_score is between 70 and 100"), `${name}: a between reads naturally`);
  check(text[3].includes("beneficiary is empty") && text[3].includes("and 2 more"), `${name}: a long member list is counted, not spelled out`);
  check((await panel.getByRole("switch").count()) === 4, `${name}: each rule has an on/off switch`);
  const sw = await panel.getByRole("switch").evaluateAll((els) => els.map((el) => el.getAttribute("aria-checked")));
  check(sw.join() === "true,true,true,false", `${name}: and it shows which are on`, sw.join());
  const listBox = await page.locator('ul[aria-label="Flag rules"]').boundingBox();
  const budget = width > 600 ? 330 : 520; // the old view took 1500px and more
  check(listBox.height <= budget, `${name}: four rules take ${Math.round(listBox.height)}px, not a screenful`, `budget ${budget}px`);

  /* 5. fit while collapsed */
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no sideways scroll, collapsed`);

  /* 2. opening */
  await all.nth(0).click();
  check((await all.nth(0).getAttribute("aria-expanded")) === "true", `${name}: a click opens a rule`);
  check(await page.getByLabel("Rule name").evaluate((el) => el === document.activeElement), `${name}: focus lands in its name`);
  await all.nth(1).click();
  check(
    (await all.nth(0).getAttribute("aria-expanded")) === "false" && (await page.getByLabel("Rule name").count()) === 1,
    `${name}: only one rule is open at a time`,
  );
  await all.nth(1).focus();
  await page.keyboard.press("Enter");
  check((await all.nth(1).getAttribute("aria-expanded")) === "false", `${name}: Enter closes it from the keyboard`);
  await page.keyboard.press("Space");
  check((await all.nth(1).getAttribute("aria-expanded")) === "true", `${name}: Space opens it again`);

  /* 3. the open editor */
  await all.nth(0).click();
  const cols = page.getByLabel("Column");
  const ops = page.getByLabel("Comparison");
  const vals = page.getByLabel("Value");
  const [bc, bo, bv] = [await cols.first().boundingBox(), await ops.first().boundingBox(), await vals.first().boundingBox()];
  if (width > 600) {
    check(Math.abs(bc.y - bo.y) < 2 && Math.abs(bo.y - bv.y) < 2, `${name}: a condition is one aligned row`, `tops ${[bc.y, bo.y, bv.y].map(Math.round).join("/")}`);
    check(bc.x < bo.x && bo.x < bv.x, `${name}: column, then comparison, then value`);
  } else {
    check(bc.width > 250 && bo.width > 250, `${name}: a condition stacks full width on a phone`);
  }
  check((await panel.getByText("and", { exact: true }).count()) >= 1, `${name}: "and" is stated between conditions`);
  check(await panel.getByRole("button", { name: "Add condition" }).isVisible(), `${name}: Add condition is there`);
  check(await panel.getByRole("button", { name: /^Remove condition/ }).first().isVisible(), `${name}: a condition can be removed`);

  /* 5. fit while open */
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no sideways scroll, open`);
  const clipped = await panel.evaluate((root) => {
    const box = root.getBoundingClientRect();
    return [...root.querySelectorAll("button, input, select")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.left < box.left - 1 || r.right > box.right + 1))
      .map(({ el }) => el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 20));
  });
  check(clipped.length === 0, `${name}: no control sticks out of its panel`, clipped.join(", "));
  const unnamed = await panel.evaluate((root) =>
    [...root.querySelectorAll("button, input, select, [role='switch']")]
      .filter((el) => {
        const labelled = el.getAttribute("aria-label") || el.getAttribute("title") || (el.labels && el.labels[0]?.textContent?.trim()) || el.textContent?.trim();
        return !labelled;
      })
      .map((el) => el.outerHTML.slice(0, 60)),
  );
  check(unnamed.length === 0, `${name}: every control has a name`, unnamed.join(" | "));

  /* 2 and 3: unsaved changes, validation, focus */
  await page.getByLabel("Rule name").fill("Very large transfer!");
  check(await page.getByText("Unsaved changes", { exact: true }).isVisible(), `${name}: an edit is marked as unsaved`);
  check((await lines(page).first().textContent()).includes("Edited"), `${name}: and the rule itself says Edited`);

  await panel.getByRole("button", { name: "Add condition" }).click();
  const newColumn = page.getByLabel("Column").last();
  check(await newColumn.evaluate((el) => el === document.activeElement), `${name}: Add condition focuses the new column`);
  const msg = panel.getByText("Pick a column.");
  check(await msg.isVisible(), `${name}: a missing column is said so`);
  const [bn, bm] = [await newColumn.boundingBox(), await msg.boundingBox()];
  check(bm.y > bn.y && bm.y - (bn.y + bn.height) < 40 && Math.abs(bm.x - bn.x) < 40, `${name}: the message sits under the field it is about`, `gap ${Math.round(bm.y - (bn.y + bn.height))}px`);
  await panel.getByRole("button", { name: /^Remove condition 3/ }).click();
  check(await page.getByLabel("Column").nth(1).evaluate((el) => el === document.activeElement), `${name}: removing a condition keeps focus in the rule`);

  await panel.getByRole("button", { name: "Done" }).click();
  check(await lines(page).first().evaluate((el) => el === document.activeElement && el.getAttribute("aria-expanded") === "false"), `${name}: Done closes it and returns focus to its line`);

  await panel.getByRole("button", { name: "Add rule" }).click();
  check((await lines(page).count()) === 5, `${name}: Add rule adds a rule`);
  check(await page.getByLabel("Rule name").evaluate((el) => el === document.activeElement && el.value === "Rule 5"), `${name}: and opens it with focus in its name`);
  check((await lines(page).last().textContent()).includes("New"), `${name}: marked New`);
  await panel.getByRole("button", { name: /^Remove rule Rule 5/ }).click();
  check(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Edit rule") ?? false), `${name}: removing a rule leaves focus on a rule, not the page`);
  await page.screenshot({ path: `/private/tmp/claude-502/rules/check-${width}.png`, fullPage: true });
  await context.close();
}

/* contrast, light and dark ------------------------------------------------------ */
for (const scheme of ["light", "dark"]) {
  const { context, page } = await open(admin, "/queries/q_table", { width: 1440, height: 1000, scheme });
  const worst = await contrastOf(page);
  check(worst.ratio >= 4.5, `${scheme}: rule text has contrast of at least 4.5`, `worst ${worst.ratio.toFixed(2)} on "${worst.text}"`);
  await context.close();
}

/* 3. the empty editor ----------------------------------------------------------- */
{
  const { context, page } = await open(admin, "/connections/c1/queries/new", { width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Add a rule" }).click();
  await panelOf(page).waitFor();
  check(await page.getByText(/nothing on this query will be flagged/i).isVisible(), "empty: says nothing will be flagged");
  check(await page.getByText(/amount is at least 500000 and response_code equals 00/).isVisible(), "empty: explains a rule with an example");
  await page.getByRole("button", { name: "Add your first rule" }).click();
  check((await lines(page).count()) === 1 && (await page.getByLabel("Rule name").evaluate((el) => el === document.activeElement)), "empty: Add your first rule opens one, with focus in its name");
  await context.close();
}

/* 4. the read-only dialog ------------------------------------------------------- */
{
  const { context, page } = await open(analyst, "/dashboards/d3", { width: 1000, height: 1100 });
  const card = page.locator("article", { hasText: "Highest risk transactions" }).first();
  await card.locator("details > summary").last().click();
  await page.getByRole("button", { name: /View definition/i }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.waitFor({ state: "visible", timeout: 8000 });
  const items = dialog.locator('section[aria-label="Flag rules"] li');
  // The dialog opens, then fetches the definition; wait for the rules, not the frame.
  await items.first().waitFor({ state: "visible", timeout: 8000 });
  check((await items.count()) === 4, "dialog: lists the four rules");
  const first = (await items.first().textContent()) ?? "";
  check(first.includes("amount is at least 500000 and response_code equals 00"), "dialog: with the same sentence the editor shows", first.replace(/\s+/g, " ").slice(0, 100));
  check((await dialog.locator('section[aria-label="Flag rules"]').locator("button, input, select, textarea, a, [role='switch']").count()) === 0, "dialog: and holds no control in the rules");
  check(/terminal_id is in the list/.test((await items.nth(1).textContent()) ?? ""), "dialog: a list is named there too");
  await page.screenshot({ path: "/private/tmp/claude-502/rules/check-dialog.png" });
  await context.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall rules checks passed");
process.exit(failures.length ? 1 : 0);
