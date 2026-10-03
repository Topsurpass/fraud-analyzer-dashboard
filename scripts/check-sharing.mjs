#!/usr/bin/env node
/**
 * Dev-only: check the shared-publishing behaviour in a real browser, as two people.
 *
 *   node scripts/mock-engine.mjs --port=8100 &
 *   ENGINE_BASE_URL=http://127.0.0.1:8100 npm run dev -- --port 3100 &
 *   node scripts/check-sharing.mjs [--base=http://localhost:3100]
 *        [--engine=http://127.0.0.1:8100] [--password=demo] [--no-chrome]
 *
 * Exits 1 on any failure. The mock engine signs in an email that starts with
 * "analyst" as an analyst (Grace) and anything else as the administrator (Ada),
 * and `POST /__reset` puts its publishing state back, so this can be run twice.
 *
 * Held, one section of docs/shared-publishing.md each:
 *
 *  1. Approval. An analyst's publish only asks: the card says "Awaiting approval"
 *     and the menu offers Withdraw, never Publish. The administrator sees it in
 *     /approvals, in the rail count and in the bell, reads the definition (Escape
 *     closes it and focus comes back), rejects with a reason; the author sees the
 *     reason, asks again; the administrator approves; it is published. An analyst
 *     cannot open /approvals and sees no trace of the queue. An administrator's
 *     own menu still publishes at once.
 *  2. Alerts. A viewer sees a published query's findings labelled "Shared by", and
 *     not an unpublished one's. Dismissing hides a row for the viewer alone: the
 *     bell count falls for them, the administrator's view is untouched, and Restore
 *     brings it back. A viewer is offered no Clear, Delete rules or Edit rules.
 *     A published card's flagged link points at a real connection.
 *  4. Definition. A viewer's published card has a menu with View definition, and
 *     not the owner's menu. The dialog shows the SQL and rules read-only, with
 *     nothing to type into, and Escape returns focus to the menu.
 *
 * (Section 3, the reordering, is checked by its own script.)
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

const seen = (locator, timeout = 8_000) =>
  locator.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
const gone = (locator, timeout = 8_000) =>
  locator.first().waitFor({ state: "detached", timeout }).then(() => true, () => false);
const absent = async (locator, wait = 1_200) => {
  await new Promise((resolve) => setTimeout(resolve, wait));
  return (await locator.count()) === 0;
};

await fetch(`${engine}/__reset`, { method: "POST" }).catch(() => undefined);

const browser = await chromium.launch(args.has("no-chrome") ? {} : { channel: "chrome" });

async function person(email) {
  const { token } = await signIn(engine, { email, password });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "switchboard_session", value: token, url: base }]);
  await context.addInitScript((t) => localStorage.setItem("fae.session-token", t), token);
  return { context, page: await context.newPage() };
}
const analyst = await person("analyst@example.com");
const admin = await person("admin@example.com");

const visit = async (page, path, ready) => {
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  if (ready) await page.waitForSelector(ready, { timeout: 15_000 });
  await page.waitForTimeout(600);
};
const cardOf = (page, title) =>
  page.locator("article", { has: page.getByRole("heading", { name: title, exact: true }) });
const openMenu = async (page, card, labelStart) => {
  await card.locator(`summary[aria-label^="${labelStart}"]`).click();
  await page.waitForTimeout(250);
};
const rail = (page) => page.locator('aside a[href="/approvals"]');
const bellText = async (page) => {
  await page.locator("header button[aria-haspopup='menu']").first().click();
  await page.waitForTimeout(300);
  const text = await page.locator("header [role='menu']").innerText();
  await page.keyboard.press("Escape");
  return text;
};
const bellCount = async (page) => {
  const label = await page.locator("header button[aria-haspopup='menu']").first().getAttribute("aria-label");
  return Number((label ?? "").match(/^(\d+)/)?.[1] ?? 0);
};

const CHART = "Processed volume (USD)"; // the analyst's own chart, on /connections/c1
const PUBLISHED_TOOLTIP = /Everyone signed in can see this chart/;

/* 1. approval ------------------------------------------------------------- */
{
  const { page } = analyst;
  await visit(page, "/connections/c1", "article");
  let card = cardOf(page, CHART);

  await openMenu(page, card, "Actions for");
  check(
    await seen(page.getByRole("button", { name: /^Request publishing \(an administrator approves it\)/ })),
    "analyst: the menu offers Request publishing",
  );
  check(
    await absent(page.getByRole("button", { name: /^Publish to the team/ }), 200),
    "analyst: the menu never offers a plain Publish",
  );
  await page.getByRole("button", { name: /^Request publishing/ }).click();

  check(await seen(card.getByText("Awaiting approval")), "analyst: the card says Awaiting approval after asking");
  // The Published badge is found by its tooltip: its text carries a screen-reader
  // sentence, so an exact text match would never find it and this would pass
  // for the wrong reason.
  check(
    await absent(card.getByTitle(PUBLISHED_TOOLTIP), 300),
    "analyst: asking does not publish the chart",
  );
  await openMenu(page, card, "Actions for");
  check(
    await seen(page.getByRole("button", { name: /^Withdraw publish request/ })),
    "analyst: a waiting request can be withdrawn",
  );
  await page.keyboard.press("Escape");
}

{
  const { page } = admin;
  await visit(page, "/approvals", "main");
  const row = page.locator("li", { has: page.getByRole("heading", { name: CHART }) });
  check(await seen(row), "admin: /approvals lists the request");
  check(
    (await row.innerText()).includes("Grace Hopper") && (await row.innerText()).includes("Payments (prod)"),
    "admin: the request names who asked and the connection",
  );
  check((await rail(page).innerText()).includes("1"), "admin: the rail shows 1 waiting");
  check((await bellText(page)).includes("1 chart awaiting approval"), "admin: the bell mentions it");

  // Read the definition before deciding: the same read-only dialog a viewer gets.
  await row.getByRole("button", { name: "View definition" }).click();
  const dialog = page.locator("dialog[open]");
  check(await seen(dialog.locator('[aria-label="SQL"]')), "admin: the definition shows the SQL");
  check(
    (await dialog.locator('[aria-label="SQL"]').innerText()).includes("SELECT"),
    "admin: the SQL is the query's own text",
  );
  check(
    (await dialog.locator("input, textarea, select").count()) === 0,
    "admin: the definition has nothing to type into",
  );
  await page.keyboard.press("Escape");
  check(await gone(page.locator("dialog[open]"), 3_000), "admin: Escape closes the definition");
  check(
    (await page.evaluate(() => document.activeElement?.textContent ?? "")).includes("View definition"),
    "admin: focus returns to the button that opened it",
  );

  await row.getByRole("button", { name: "Reject" }).click();
  await row.getByLabel(/Reason/).fill("Needs a narrower window");
  await row.getByRole("button", { name: "Send rejection" }).click();
  check(await gone(row), "admin: a rejected request leaves the queue");
  check(
    (await page.getByRole("status").innerText()).includes("Rejected"),
    "admin: the page confirms the rejection",
  );
  check(
    await seen(page.getByText("Nothing is waiting")) && (await rail(page).innerText()).trim() === "Approvals",
    "admin: the rail count is gone once nothing waits",
  );
}

{
  const { page } = analyst;
  await visit(page, "/connections/c1", "article");
  const card = cardOf(page, CHART);
  check(await seen(card.getByText("Not approved")), "analyst: the card says Not approved");
  check(
    (await card.getByRole("status").innerText()).includes("Needs a narrower window"),
    "analyst: the card shows the administrator's reason",
  );
  await openMenu(page, card, "Actions for");
  check(
    await seen(page.getByRole("button", { name: "Request publishing again" })),
    "analyst: the menu offers to ask again",
  );
  await page.getByRole("button", { name: "Request publishing again" }).click();
  check(await seen(card.getByText("Awaiting approval")), "analyst: asking again makes it pending again");
}

{
  const { page } = admin;
  await visit(page, "/approvals", "main");
  const row = page.locator("li", { has: page.getByRole("heading", { name: CHART }) });
  check(await seen(row), "admin: the second request is listed");

  // The bait and switch: the definition moves after the administrator loaded the
  // row (an author who withdrew, edited the SQL and asked again). Approving from
  // the stale view must be refused, and the request must still be waiting.
  await fetch(`${engine}/__edit?query=q_volkpi`, { method: "POST" });
  await row.getByRole("button", { name: "Approve" }).click();
  check(
    await seen(page.getByRole("alert").filter({ hasText: "changed since it was reviewed" })),
    "admin: approving a definition that changed after it was shown is refused",
  );
  check(await seen(row), "admin: the request is still waiting after the refusal");

  // Reviewed again, the row carries the new fingerprint and the approval goes through.
  await row.getByRole("button", { name: "Approve" }).click();
  check(await gone(row), "admin: an approved request leaves the queue");
  check(
    (await page.getByRole("status").innerText()).includes("Approved"),
    "admin: the page confirms the approval",
  );
}

{
  const { page } = analyst;
  await visit(page, "/connections/c1", "article");
  const card = cardOf(page, CHART);
  check(await seen(card.getByTitle(PUBLISHED_TOOLTIP)), "analyst: the approved chart reads Published");
  await openMenu(page, card, "Actions for");
  check(await seen(page.getByRole("button", { name: /^Unpublish/ })), "analyst: the menu offers Unpublish");
  await page.keyboard.press("Escape");

  await visit(page, "/approvals", "main");
  check(await seen(page.getByText("Administrators only")), "analyst: /approvals says Administrators only");
  check(await absent(rail(page), 300), "analyst: no Approvals link in the rail");
  check(!(await bellText(page)).includes("awaiting approval"), "analyst: nothing about the queue in the bell");
}

{
  const { page } = admin;
  await visit(page, "/connections/c2", "article");
  const card = cardOf(page, "Flagged transactions");
  await openMenu(page, card, "Actions for");
  check(
    await seen(page.getByRole("button", { name: /^Publish to the team \(freezes the query\)/ })),
    "admin: the menu still publishes at once",
  );
  check(
    await absent(page.getByRole("button", { name: /^Request publishing/ }), 200),
    "admin: the menu does not ask for approval of itself",
  );
  await page.keyboard.press("Escape");
}

/* 2. alerts --------------------------------------------------------------- */
const sectionOf = (page, name) =>
  page.locator("section", { has: page.getByRole("heading", { name: new RegExp(name) }) });
{
  const { page } = analyst;
  await visit(page, "/connections/c1/flagged", "main table");
  const shared = sectionOf(page, "Declined spike");
  const own = sectionOf(page, "Large amounts");

  check(await seen(shared), "viewer: a published query's findings are visible");
  check(
    (await shared.getByRole("heading").first().innerText()).includes("Shared by Ada Lovelace"),
    "viewer: the section says who shares it",
  );
  check(
    (await sectionOf(page, "Card testing").count()) === 0,
    "viewer: an unpublished query's findings are not visible",
  );
  check(
    (await shared.getByRole("button", { name: /^Clear$|Delete rules/ }).count()) === 0 &&
      (await shared.getByRole("link", { name: /Edit rules/ }).count()) === 0,
    "viewer: no Clear, Delete rules or Edit rules on a shared section",
  );
  check(
    (await own.getByRole("button", { name: /^Clear$/ }).count()) === 1 &&
      (await own.getByRole("link", { name: /Edit rules/ }).count()) === 1,
    "viewer: their own section keeps every control",
  );

  const before = await bellCount(page);
  await shared.getByRole("button", { name: /^Dismiss flagged row \d+$/ }).first().click();
  await page.waitForTimeout(1_500);
  const after = await bellCount(page);
  check(after === before - 1, "viewer: dismissing a row lowers their own bell count by one", `${before} -> ${after}`);
  check(
    await seen(sectionOf(page, "Declined spike").getByRole("button", { name: "Restore 1" })),
    "viewer: Restore offers the dismissed row back",
  );
}
{
  const { page } = admin;
  await visit(page, "/connections/c1/flagged", "main table");
  check(
    await seen(sectionOf(page, "Declined spike").getByRole("button", { name: "Dismiss all 40" })),
    "admin: the viewer's dismissal did not hide anything from the administrator",
  );
}
{
  const { page } = analyst;
  await visit(page, "/connections/c1/flagged", "main table");
  await sectionOf(page, "Declined spike").getByRole("button", { name: "Restore 1" }).click();
  check(
    await seen(sectionOf(page, "Declined spike").getByRole("button", { name: "Dismiss all 40" })),
    "viewer: Restore brings the row back for them",
  );
}

/* 2 and 4. a published card, on the analyst's own board ----------------------- */
{
  const { page } = analyst;
  await visit(page, "/dashboards/d3", "article");
  const card = cardOf(page, "Highest risk transactions");
  check(await seen(card), "viewer: the board carries what the team published");
  // Shared cards are ranked with the board's own now, so each says why it is there.
  check(await seen(card.getByText(/^Shared by /)), "viewer: the published card says who shared it");

  const link = card.locator('a[aria-label^="Review"]');
  check(await seen(link), "viewer: the published card shows its flagged count as a link");
  const href = (await link.getAttribute("href")) ?? "";
  check(
    href === "/connections/c1/flagged" && !href.includes("undefined"),
    "viewer: the flagged link points at a real connection",
    href,
  );

  check(
    (await card.locator('summary[aria-label^="Actions for"]').count()) === 0,
    "viewer: a published card does not get the owner's menu",
  );
  const hasMenu = await seen(card.locator('summary[aria-label^="Chart options for"]'), 3_000);
  check(hasMenu, "viewer: a published card has a menu of its own");
  if (hasMenu) await viewerDefinition(page, card);
}

async function viewerDefinition(page, card) {
  await openMenu(page, card, "Chart options for");
  const items = await page.locator("body > div[style*='position: fixed'] button").allInnerTexts();
  check(items.length === 1 && items[0] === "View definition", "viewer: the menu holds only View definition", items.join("|"));

  await page.getByRole("button", { name: "View definition" }).click();
  const dialog = page.locator("dialog[open]");
  check(await seen(dialog.locator('[aria-label="SQL"]')), "viewer: the definition opens with the SQL");
  const text = await dialog.innerText();
  check(
    text.includes("Read-only.") && text.includes("belongs to Ada Lovelace"),
    "viewer: it says read-only and whose it is",
  );
  check(text.includes("MFBs Terminal"), "viewer: a rule that uses a list names the list");
  check(
    (await dialog.locator("input, textarea, select").count()) === 0 &&
      (await dialog.locator("button").allInnerTexts()).every((t) => ["Copy", "Close", ""].includes(t.trim())),
    "viewer: nothing in the dialog edits anything",
  );
  await page.keyboard.press("Escape");
  check(await gone(page.locator("dialog[open]"), 3_000), "viewer: Escape closes the definition");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  check(focused.startsWith("Chart options for"), "viewer: focus returns to the card's menu", focused);
}

await fetch(`${engine}/__reset`, { method: "POST" }).catch(() => undefined);
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall sharing checks passed");
process.exit(failures.length ? 1 : 0);
