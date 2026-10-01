#!/usr/bin/env node
/**
 * Dev-only: watch a card get flagged and move to the top, in a real browser.
 *
 *   MOCK_POLL_MS=2000 node scripts/mock-engine.mjs --port=8100 &
 *   ENGINE_BASE_URL=http://127.0.0.1:8100 npm run dev -- --port 3100 &
 *   node scripts/check-reorder.mjs [--base=http://localhost:3100] [--engine=http://127.0.0.1:8100]
 *
 * Exits 1 on any failure. The mock engine's `POST /__flag?query=<id>&rows=<n>`
 * makes a query flag n rows from its next poll, which is the moment under test.
 *
 * Held to the rules in docs/shared-publishing.md, section 3:
 *   - a card that becomes flagged rises to the top and glides (a transform
 *     animation of 250 to 450 ms that ends at the identity transform);
 *   - polls that change nothing move nothing;
 *   - an open card menu holds the order, and it applies when the menu closes;
 *   - reduced motion reorders without animating;
 *   - clearing the flags sends the card back to its place, smoothly.
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
const route = String(args.get("route") ?? "/connections/c1");

const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(what);
};
/** The query behind a card, found by the chart's name, so the check never guesses. */
async function queryFor(title, connection = route.split("/")[2]) {
  const res = await fetch(`${engine}/connections/${connection}/queries`, { headers: { authorization: `Bearer ${token}` } });
  const queries = await res.json();
  const found = queries.find((q) => q.charts.some((c) => c.name === title) || q.name === title);
  if (!found) throw new Error(`no query behind a card titled "${title}"`);
  return found.id;
}
const flag = (query, rows) => fetch(`${engine}/__flag?query=${query}&rows=${rows}`, { method: "POST" });
const reset = () => fetch(`${engine}/__flag?reset=1`, { method: "POST" });

const { token } = await signIn(engine, { email: "check@example.com", password: "demo" });
const browser = await chromium.launch({ channel: "chrome" });

async function openBoard({ reducedMotion = "no-preference" } = {}) {
  await reset();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion });
  await context.addCookies([{ name: "switchboard_session", value: token, url: base }]);
  await context.addInitScript((t) => localStorage.setItem("fae.session-token", t), token);
  // Record every animation the page starts, so the glide can be asserted on
  // rather than guessed from screenshots.
  await context.addInitScript(() => {
    window.__anims = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const frames = Array.isArray(keyframes) ? keyframes : [];
      const transform = frames.some((f) => f && typeof f.transform === "string" && /translate/.test(f.transform));
      window.__anims.push({
        title: this.getAttribute?.("aria-label") ?? "",
        transform,
        from: frames[0]?.transform ?? null,
        to: frames[frames.length - 1]?.transform ?? null,
        duration: typeof options === "number" ? options : options?.duration,
      });
      return original.call(this, keyframes, options);
    };
  });
  const page = await context.newPage();
  await page.goto(base + route, { waitUntil: "networkidle" });
  await page.waitForSelector("article");
  // Past the settle window, and through a poll or two, so the board is calm.
  await page.waitForTimeout(6500);
  return { context, page };
}

const titles = (page) => page.$$eval("article", (cards) => cards.map((c) => c.getAttribute("aria-label")));
const glides = (page) => page.evaluate(() => window.__anims.filter((a) => a.transform));
async function waitForOrder(page, predicate, timeoutMs = 9000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const order = await titles(page);
    if (predicate(order)) return order;
    await page.waitForTimeout(150);
  }
  return titles(page);
}

/* 1. a card becomes flagged, rises, and glides ------------------------------ */
{
  const { context, page } = await openBoard();
  const before = await titles(page);
  const target = before.at(-1);
  check(before.length >= 4, "board has cards to reorder", `${before.length} cards`);

  await page.evaluate(() => (window.__anims.length = 0));
  const targetQuery = await queryFor(target);
  await flag(targetQuery, 3);
  const after = await waitForOrder(page, (order) => order[0] === target);
  check(after[0] === target, "the newly flagged card is first", `"${target}" ${before.indexOf(target)} -> ${after.indexOf(target)}`);

  const moved = await glides(page);
  check(moved.length > 0, "cards glide into place (transform animations started)", `${moved.length} animations`);
  check(
    moved.every((a) => a.duration >= 250 && a.duration <= 450),
    "each glide lasts 250 to 450 ms",
    [...new Set(moved.map((a) => a.duration))].join(", "),
  );
  check(moved.every((a) => /translate\(0(px)?, 0(px)?\)/.test(a.to)), "each glide ends at the identity transform");

  await page.waitForTimeout(700);
  const resting = await page.$$eval("article", (cards) => cards.map((c) => getComputedStyle(c).transform));
  check(resting.every((t) => t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)"), "nothing is left displaced afterwards");

  /* 2. polls that change nothing move nothing -------------------------------- */
  await page.evaluate(() => (window.__anims.length = 0));
  const steady = await titles(page);
  await page.waitForTimeout(8000);
  check(JSON.stringify(await titles(page)) === JSON.stringify(steady), "unchanged polls leave the order alone");
  check((await glides(page)).length === 0, "unchanged polls start no animation");

  /* 3. clearing the flags sends the card back, smoothly ---------------------- */
  await page.evaluate(() => (window.__anims.length = 0));
  await flag(targetQuery, 0);
  const back = await waitForOrder(page, (order) => order.indexOf(target) > 1);
  check(back.indexOf(target) > 1, "a card whose flags clear leaves the top", `now at ${back.indexOf(target)}`);
  check((await glides(page)).length > 0, "and it glides back");
  await context.close();
}

/* 4. an open menu holds the order, closing it applies it --------------------- */
{
  const { context, page } = await openBoard();
  const before = await titles(page);
  const flaggedLater = before.at(-2);

  // Open the first card's actions menu (the last summary in the card header).
  await page.locator("article").first().locator("details > summary").last().click();
  await page.waitForTimeout(200);
  await page.evaluate(() => (window.__anims.length = 0));
  await flag(await queryFor(flaggedLater), 2);
  await page.waitForTimeout(8000);
  const held = await titles(page);
  check(JSON.stringify(held) === JSON.stringify(before), "an open menu holds the order", `"${flaggedLater}" stayed put`);
  check((await glides(page)).length === 0, "nothing glides while it is held");

  await page.keyboard.press("Escape");
  const released = await waitForOrder(page, (order) => JSON.stringify(order) !== JSON.stringify(before), 4000);
  check(JSON.stringify(released) !== JSON.stringify(before), "the order applies as soon as the menu closes");
  check(released[0] === flaggedLater, "with the card that was flagged meanwhile now first", `"${released[0]}"`);
  await context.close();
}

/* 5. reduced motion reorders without animating ------------------------------- */
{
  const { context, page } = await openBoard({ reducedMotion: "reduce" });
  const before = await titles(page);
  const target = before.at(-1);
  await page.evaluate(() => (window.__anims.length = 0));
  await flag(await queryFor(target), 3);
  const after = await waitForOrder(page, (order) => order[0] === target);
  check(after[0] === target, "reduced motion: the card still moves to the top");
  check((await glides(page)).length === 0, "reduced motion: with no animation");
  await context.close();
}

await reset();
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall reorder checks passed");
process.exit(failures.length ? 1 : 0);
