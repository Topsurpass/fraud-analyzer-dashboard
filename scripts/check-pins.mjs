#!/usr/bin/env node
/**
 * Dev-only: pinning, and published cards ranked with the board's own, in a real browser.
 *
 *   MOCK_POLL_MS=2000 node scripts/mock-engine.mjs --port=8100 &
 *   ENGINE_BASE_URL=http://127.0.0.1:8100 npm run dev -- --port 3100 &
 *   node scripts/check-pins.mjs [--base=http://localhost:3100] [--engine=http://127.0.0.1:8100]
 *
 * Exits 1 on any failure. Held to these rules:
 *   - a pin moves a card to the top at once, with a glide, and Unpin gives it back;
 *   - a pinned card keeps its place when a poll flags it or another card;
 *   - pins survive a reload and belong to one person;
 *   - on an analyst's board the team's published cards share ONE grid with the
 *     board's own cards, are marked "Shared by <name>", rank with them (a flagged
 *     published card rises above quiet own cards) and can be pinned too.
 */
import { chromium } from "playwright";
import { signIn } from "./lib/session.mjs";

const args = new Map(process.argv.slice(2).map((raw) => { const [k, v] = raw.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const base = String(args.get("base") ?? "http://localhost:3100").replace(/\/+$/, "");
const engine = String(args.get("engine") ?? "http://127.0.0.1:8100").replace(/\/+$/, "");

const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(what);
};
const post = (path, token) => fetch(engine + path, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });
const flag = (query, rows) => post(`/__flag?query=${query}&rows=${rows}`);

await post("/__reset").catch(() => undefined);
await post("/__flag?reset=1");
const admin = (await signIn(engine, { email: "admin@example.com", password: "demo" })).token;
const analyst = (await signIn(engine, { email: "analyst@example.com", password: "demo" })).token;
const browser = await chromium.launch({ channel: "chrome" });

async function open(token, path, { reducedMotion = "no-preference" } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1800 }, reducedMotion });
  await context.addCookies([{ name: "switchboard_session", value: token, url: base }]);
  await context.addInitScript((t) => localStorage.setItem("fae.session-token", t), token);
  await context.addInitScript(() => {
    window.__anims = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const frames = Array.isArray(keyframes) ? keyframes : [];
      window.__anims.push({ transform: frames.some((f) => f && /translate/.test(String(f.transform ?? ""))), duration: typeof options === "number" ? options : options?.duration });
      return original.call(this, keyframes, options);
    };
  });
  const page = await context.newPage();
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForSelector("article");
  await page.waitForTimeout(6500);
  return { context, page };
}
const titles = (page) => page.$$eval("article", (cards) => cards.map((c) => c.getAttribute("aria-label")));
const glides = (page) => page.evaluate(() => window.__anims.filter((a) => a.transform));
const reset = (page) => page.evaluate(() => (window.__anims.length = 0));
async function waitFor(page, predicate, timeoutMs = 9000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { const order = await titles(page); if (predicate(order)) return order; await page.waitForTimeout(150); }
  return titles(page);
}
async function queryFor(token, connection, title) {
  const res = await fetch(`${engine}/connections/${connection}/queries`, { headers: { authorization: `Bearer ${token}` } });
  return (await res.json()).find((q) => q.charts.some((c) => c.name === title)).id;
}
const pinButton = (page, title) => page.locator("article", { has: page.getByRole("heading", { name: title, exact: true }) }).getByRole("button", { name: new RegExp(`^(Pin ${title.replace(/[()]/g, "\\$&")} to the top|Unpin ${title.replace(/[()]/g, "\\$&")})$`) });

/* 1. pinning on a connection board ------------------------------------------ */
{
  const { context, page } = await open(admin, "/connections/c1");
  const before = await titles(page);
  const target = before.at(-1);
  const second = before.at(-2);

  await reset(page);
  await pinButton(page, target).click();
  const after = await waitFor(page, (o) => o[0] === target, 3000);
  check(after[0] === target, "pinning a card moves it to the top at once", `"${target}" ${before.indexOf(target)} -> ${after.indexOf(target)}`);
  check((await glides(page)).length > 0, "and it glides there");
  check((await pinButton(page, target).getAttribute("aria-pressed")) === "true", "the button reports pressed");

  await pinButton(page, second).click();
  const two = await waitFor(page, (o) => o[1] === second, 3000);
  check(two[0] === target && two[1] === second, "a second pin goes below the first: pin order is kept", two.slice(0, 2).join(" / "));

  // A poll flags a card further down, and one of the pinned cards.
  await flag(await queryFor(admin, "c1", before[0]), 2);
  await flag(await queryFor(admin, "c1", target), 3);
  await page.waitForTimeout(9000);
  const flagged = await titles(page);
  check(flagged[0] === target && flagged[1] === second, "pinned cards keep their places when polls flag cards, even a pinned one", flagged.slice(0, 3).join(" / "));
  check(flagged[2] === before[0], "and the card flagged meanwhile ranks just below the pins", `third is "${flagged[2]}"`);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("article");
  await page.waitForTimeout(2500);
  const reloaded = await titles(page);
  check(reloaded[0] === target && reloaded[1] === second, "pins survive a reload", reloaded.slice(0, 2).join(" / "));

  await reset(page);
  await pinButton(page, target).click();
  const unpinned = await waitFor(page, (o) => o[0] !== target, 3000);
  check(unpinned[0] !== target, "unpinning gives the card back to the ranking", `now at ${unpinned.indexOf(target)}`);
  check((await glides(page)).length > 0, "and it glides back");
  await context.close();
}

/* 2. pins belong to one person ----------------------------------------------- */
{
  const first = await open(admin, "/connections/c1");
  const target = (await titles(first.page)).at(-1);
  await pinButton(first.page, target).click();
  await first.page.waitForTimeout(600);
  await first.context.close();

  const other = await open(analyst, "/connections/c1");
  const order = await titles(other.page);
  check(order[0] !== target || order.length === 0, "another person's board does not show the first person's pin", `first is "${order[0]}"`);
  await other.context.close();
  await post("/__flag?reset=1");
}

/* 3. published cards are ranked with the board's own -------------------------- */
{
  for (const id of ["ch_volume", "ch_mix", "ch_stack", "ch_biaxial"]) await post(`/queries/charts/${id}/publish`, admin);
  const boards = await (await fetch(`${engine}/dashboards`, { headers: { authorization: `Bearer ${analyst}` } })).json();
  const mine = boards.find((b) => b.owner_email?.startsWith("analyst")) ?? boards.at(-1);
  const { context, page } = await open(analyst, `/dashboards/${mine.id}`);

  const grids = await page.$$eval("article", (cards) => new Set(cards.map((c) => c.parentElement)).size);
  check(grids === 1, "own and shared cards are in one grid", `${grids} grid(s)`);
  check((await page.getByText("Published by the team").count()) === 0, "there is no separate Published by the team section");
  const chips = await page.getByText(/^Shared by /).count();
  const cards = (await titles(page)).length;
  check(chips >= 1 && chips < cards, "shared cards are marked Shared by <name>, own cards are not", `${chips} of ${cards}`);

  const before = await titles(page);
  // Flag a published card that is currently last.
  const published = await (await fetch(`${engine}/queries/charts/published`, { headers: { authorization: `Bearer ${analyst}` } })).json();
  const publishedNames = new Set(published.map((c) => c.name));
  const target = [...before].reverse().find((t) => publishedNames.has(t));
  const targetQuery = published.find((c) => c.name === target).query_id;
  await reset(page);
  await flag(targetQuery, 3);
  const risen = await waitFor(page, (o) => o[0] === target);
  check(risen[0] === target, "a flagged published card rises above the board's own cards", `"${target}" ${before.indexOf(target)} -> 0`);
  check((await glides(page)).length > 0, "and glides there");

  // Pin an own card: it stays above the flagged published one.
  const own = before.find((t) => !publishedNames.has(t));
  if (own) {
    await pinButton(page, own).click();
    const pinned = await waitFor(page, (o) => o[0] === own, 3000);
    check(pinned[0] === own && pinned[1] === target, "a pinned own card sits above the flagged published card", pinned.slice(0, 2).join(" / "));
  }
  // A shared card can be pinned too.
  const sharedOther = before.find((t) => publishedNames.has(t) && t !== target);
  await pinButton(page, sharedOther).click();
  const sharedPinned = await waitFor(page, (o) => o.indexOf(sharedOther) <= 1, 3000);
  check(sharedPinned.indexOf(sharedOther) <= 1, "a shared card can be pinned as well", `"${sharedOther}" at ${sharedPinned.indexOf(sharedOther)}`);
  await context.close();
}

/* 4. reduced motion pins without animating ------------------------------------ */
{
  const { context, page } = await open(admin, "/connections/c1", { reducedMotion: "reduce" });
  const target = (await titles(page)).at(-1);
  await reset(page);
  await pinButton(page, target).click();
  const after = await waitFor(page, (o) => o[0] === target, 3000);
  check(after[0] === target, "reduced motion: the pin still moves the card");
  check((await glides(page)).length === 0, "reduced motion: with no animation");
  await context.close();
}

await post("/__reset").catch(() => undefined);
await post("/__flag?reset=1");
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall pin checks passed");
process.exit(failures.length ? 1 : 0);
