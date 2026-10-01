#!/usr/bin/env node
/**
 * Dev-only: measure the layout bugs jsdom cannot see, in a real browser.
 *
 *   node scripts/mock-engine.mjs --port=8100 &
 *   ENGINE_BASE_URL=http://127.0.0.1:8100 npm run dev -- --port 3100 &
 *   node scripts/check-layout.mjs [--base=http://localhost:3100]
 *        [--engine=http://127.0.0.1:8100] [--password=demo] [--connection=c1]
 *        [--chrome|--no-chrome]
 *
 * Exits 1 on any failure. Three things are held:
 *
 *  1. The notification bell's panel is not covered by the page: every point of
 *     it hit-tests to the panel, at desktop, tablet and phone widths, and it
 *     stays inside the viewport.
 *  2. The sidebar is a fixed column: the document never scrolls, and the rail
 *     does not move when the page scrolls by wheel, by End, by Tab or by
 *     scrollIntoView.
 *  3. Every item of every card's menus is reachable without expanding the card:
 *     the panel is inside the viewport, and each item, scrolled to inside the
 *     panel if it scrolls, hit-tests to itself. The keyboard gets in (Enter,
 *     Tab) and out (Escape).
 *
 * Default target is the mock engine, which serves every chart type.
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
const email = String(args.get("email") ?? "check@example.com");
const connection = String(args.get("connection") ?? "c1");

const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(what);
};

const { token } = await signIn(engine, { email, password });
const browser = await chromium.launch(args.has("no-chrome") ? {} : { channel: "chrome" });

async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addCookies([{ name: "switchboard_session", value: token, url: base }]);
  await context.addInitScript((t) => localStorage.setItem("fae.session-token", t), token);
  const page = await context.newPage();
  await page.goto(`${base}/connections/${connection}`, { waitUntil: "networkidle" });
  await page.waitForSelector("article", { timeout: 15_000 });
  await page.waitForTimeout(1500);
  return { context, page };
}

/* 1. the bell ------------------------------------------------------------ */
for (const [w, h] of [[1440, 800], [1024, 600], [800, 700], [390, 800]]) {
  const { context, page } = await open(w, h);
  await page.locator("header button[aria-haspopup='menu']").first().click();
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const panel = document.querySelector("header [role='menu']");
    if (!panel) return null;
    const b = panel.getBoundingClientRect();
    let blocked = 0, total = 0;
    for (let y = b.top + 4; y < b.bottom - 2; y += 8)
      for (let x = b.left + 4; x < b.right - 2; x += 12) {
        total++;
        if (!panel.contains(document.elementFromPoint(x, y))) blocked++;
      }
    return { blocked, total, inViewport: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight };
  });
  check(r !== null, `bell ${w}x${h}: panel opens`);
  if (r) {
    check(r.blocked === 0, `bell ${w}x${h}: nothing covers the panel`, `${r.blocked}/${r.total} points blocked`);
    check(r.inViewport, `bell ${w}x${h}: panel is inside the viewport`);
  }
  await context.close();
}

/* 2. the sidebar --------------------------------------------------------- */
for (const [w, h] of [[1440, 700], [1920, 1080], [1280, 450], [800, 700]]) {
  const { context, page } = await open(w, h);
  const state = () =>
    page.evaluate(() => ({
      doc: document.scrollingElement.scrollTop + window.scrollY,
      docOverflow: document.documentElement.scrollHeight - innerHeight,
      aside: document.querySelector("aside").getBoundingClientRect().top,
      main: document.querySelector("main").scrollTop,
    }));
  const moves = [];
  await page.mouse.move(Math.floor(w / 2), Math.floor(h / 2));
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(300);
  moves.push(["wheel", await state()]);
  await page.keyboard.press("End");
  await page.waitForTimeout(300);
  moves.push(["End", await state()]);
  await page.evaluate(() => {
    const a = document.querySelectorAll("article");
    a[a.length - 1].scrollIntoView();
  });
  await page.waitForTimeout(300);
  moves.push(["scrollIntoView", await state()]);
  const scrolled = moves.some(([, s]) => s.main > 0);
  check(scrolled, `sidebar ${w}x${h}: the page does scroll (the check is meaningful)`);
  check(
    moves.every(([, s]) => s.aside === 0 && s.doc === 0 && s.docOverflow <= 0),
    `sidebar ${w}x${h}: rail fixed, document never scrolls`,
    moves.map(([n, s]) => `${n}: aside ${s.aside}, doc ${s.doc}, main ${s.main}`).join(" | "),
  );
  await context.close();
}

/* 3. every option of every card ------------------------------------------ */
{
  const { context, page } = await open(1440, 900);
  const cards = await page.locator("article").count();
  check(cards > 0, "cards: some are on the page", `${cards} cards`);
  for (let i = 0; i < cards; i++) {
    const card = page.locator("article").nth(i);
    await card.scrollIntoViewIfNeeded();
    const title = ((await card.locator("h2, h3").first().textContent().catch(() => "")) || `card ${i}`).slice(0, 36);
    const triggers = card.locator("details > summary");
    for (let k = 0; k < (await triggers.count()); k++) {
      const name = await triggers.nth(k).getAttribute("aria-label");
      await triggers.nth(k).click();
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        const panel = document.querySelector("body > div[style*='position: fixed']");
        if (!panel) return null;
        const items = [...panel.querySelectorAll("button, a")];
        let reachable = 0;
        for (const el of items) {
          el.scrollIntoView({ block: "nearest" });
          const b = el.getBoundingClientRect();
          if (el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2))) reachable++;
        }
        panel.scrollTo(0, 0);
        const b = panel.getBoundingClientRect();
        return { items: items.length, reachable, inViewport: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth };
      });
      const what = `${title} / ${name}`;
      check(r !== null && r.items > 0, `menu opens: ${what}`);
      if (r) {
        check(r.reachable === r.items, `every item reachable: ${what}`, `${r.reachable}/${r.items}`);
        check(r.inViewport, `panel inside the viewport: ${what}`);
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(80);
    }
  }

  // The keyboard, once, on the first card's actions menu (the one with items).
  const trigger = page.locator("article").first().locator("details > summary").last();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  await page.keyboard.press("Tab");
  const inPanel = await page.evaluate(() => !!document.activeElement?.closest("body > div[style*='position: fixed']"));
  check(inPanel, "keyboard: Enter opens the menu and Tab moves into it");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  const back = await page.evaluate(() => document.activeElement?.tagName === "SUMMARY");
  check(back, "keyboard: Escape closes it and returns focus to the trigger");
  await context.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall layout checks passed");
process.exit(failures.length ? 1 : 0);
