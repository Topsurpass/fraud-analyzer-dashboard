#!/usr/bin/env node
/**
 * Dev-only: screenshot a list of routes so the UI can actually be looked at.
 * node scripts/shoot.mjs <outDir> [--width=1440] [--height=900] [--wait=3500]
 *
 * Every route but /login sits behind a session, so pass --password (or set
 * FAE_SMOKE_PASSWORD) to shoot anything else. Without one it shoots signed out,
 * which is the right behaviour for capturing the login screen itself.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { DEFAULT_EMAIL, seedSession, signIn } from "./lib/session.mjs";

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
const engine = String(args.get("engine") ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
const email = String(args.get("email") ?? DEFAULT_EMAIL);
const password = args.get("password") === undefined ? undefined : String(args.get("password"));

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 2,
  colorScheme: "dark",
  reducedMotion: args.has("reduced") ? "reduce" : "no-preference",
});
// Signed out unless a password is given: that is what makes the login screen
// shootable, and every other route redirects to it and says so plainly.
if (password || process.env.FAE_SMOKE_PASSWORD) {
  const { token } = await signIn(engine, { email, password });
  await seedSession(context, token);
}

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
