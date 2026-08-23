#!/usr/bin/env node
/**
 * Dashboards smoke test: is a board really server-owned?
 *
 * The gate suite mocks the engine, so it can prove the client calls the right
 * endpoints and nothing more. The claim that matters here is a different one -
 * a board created in one browser exists for every other browser, and no part of
 * it is hiding in `localStorage`. That claim is only testable across two real
 * browser contexts against a real engine, so it lives in this lane.
 *
 *   node scripts/dev-seed.mjs && npm run dev      # in another shell
 *   node scripts/smoke-dashboards.mjs
 *
 * Flags: --base=<url> (default http://localhost:3000)
 *        --engine=<url> (default http://127.0.0.1:8000)
 *
 * The board it creates is named with a timestamp and deleted on the way out,
 * including after a failure.
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

if (BASE.includes("127.0.0.1")) {
  console.warn("warning: use http://localhost:3000, not 127.0.0.1 - dev chunks 403 otherwise");
}

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures.push(label);
  return ok;
};

/**
 * Open one card's action menu, scoped to that card.
 *
 * `<details>` stays open once clicked, so with two cards on a board the same
 * item name matches twice. Every menu click has to be scoped to its card.
 */
async function openCardMenu(page, name) {
  const card = page.locator(`article[aria-label="${name}"]`).first();
  await card.getByLabel(`Actions for ${name}`).click();
  return card;
}

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const NAME = `Smoke board ${new Date().toISOString().slice(11, 19)}`;
const RENAMED = `${NAME} (renamed)`;

async function engineBoards() {
  return fetch(`${ENGINE}/dashboards`).then((r) => r.json());
}

async function main() {
  const connections = await fetch(`${ENGINE}/connections`).then((r) => r.json());
  if (!Array.isArray(connections) || connections.length === 0) {
    console.error("no connections on the engine - run: node scripts/dev-seed.mjs");
    process.exit(2);
  }
  const connection = connections.find((c) => c.status === "ok") ?? connections[0];
  const queries = await fetch(`${ENGINE}/connections/${connection.id}/queries`).then((r) =>
    r.json(),
  );
  if (queries.length === 0) {
    console.error("no saved queries - run: node scripts/dev-seed.mjs");
    process.exit(2);
  }
  const query = queries[0];
  const second = queries.find((q) => q.id !== query.id) ?? null;

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  const consoleErrors = [];
  // The last check asks for a board id the engine does not have, and the
  // browser logs every 404 response as a console error. Silence is the right
  // expectation everywhere else, so the collector is muted only for that step
  // rather than the 404 being filtered out by text, which would also hide a
  // real one.
  let expectingErrors = false;
  page.on("pageerror", (error) => {
    if (!expectingErrors) consoleErrors.push(String(error).slice(0, 200));
  });
  page.on("console", (message) => {
    if (expectingErrors) return;
    if (message.type() === "error" && !message.text().includes("_next/hmr")) {
      consoleErrors.push(message.text().slice(0, 200));
    }
  });

  let boardId = null;

  try {
    // --- create -----------------------------------------------------------
    await page.goto(`${BASE}/dashboards/new`, { waitUntil: "networkidle" });
    await page.getByLabel(/name/i).first().fill(NAME);
    await page.getByRole("button", { name: /create/i }).first().click();
    // A client-side router.push fires no load event, so waitForURL's default
    // wait would sit here until it timed out on a navigation that already
    // happened.
    await page.waitForFunction(
      () => /^\/dashboards\/[0-9a-f-]{8,}$/.test(location.pathname),
      undefined,
      { timeout: 15_000 },
    );
    boardId = new URL(page.url()).pathname.split("/").pop();

    const afterCreate = await engineBoards();
    check(
      afterCreate.some((b) => b.id === boardId && b.name === NAME),
      "create writes through to the engine",
      `id=${boardId}`,
    );

    // The claim under test: none of this is in browser storage.
    const stored = await page.evaluate(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        out[key] = (localStorage.getItem(key) ?? "").slice(0, 120);
      }
      return out;
    });
    const leaked = Object.entries(stored).filter(
      ([key, value]) => /dashboard/i.test(key) || value.includes(NAME),
    );
    check(leaked.length === 0, "nothing about the board is in localStorage", JSON.stringify(leaked));

    // --- add a card -------------------------------------------------------
    await page.goto(`${BASE}/connections/${connection.id}`, { waitUntil: "networkidle" });
    const card = page.locator(`article[aria-label="${query.name}"]`).first();
    // Both popovers are <details>/<summary>, so their trigger is not a button
    // role - it is named by aria-label.
    await card.getByLabel("Add to dashboard").click();
    await page.getByRole("button", { name: new RegExp(`Add to ${escapeRe(NAME)}`) }).click();
    await page.waitForTimeout(1500);

    const afterAdd = (await engineBoards()).find((b) => b.id === boardId);
    check(
      afterAdd?.query_ids.includes(query.id) === true,
      "adding a card writes the query id to the board",
      `query_ids=${JSON.stringify(afterAdd?.query_ids)}`,
    );

    // --- deep link from a browser that has never listed this board --------
    const fresh = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const cold = await fresh.newPage();
    await cold.goto(`${BASE}/dashboards/${boardId}`, { waitUntil: "networkidle" });
    await cold.waitForTimeout(6000);
    const coldTitle = await cold.getByText(NAME).count();
    const coldCard = await cold.locator(`article[aria-label="${query.name}"]`).count();
    const coldMissing = await cold.getByText("This dashboard does not exist").count();
    check(
      coldTitle > 0 && coldCard > 0 && coldMissing === 0,
      "a cold browser resolves the board by id",
      `title=${coldTitle} card=${coldCard} missing=${coldMissing}`,
    );

    // And the card on it is live, not a husk.
    const marks = await cold
      .locator(
        `article[aria-label="${query.name}"] :is(path.recharts-line-curve, path.recharts-rectangle, path.recharts-sector, tbody tr, .tnum)`,
      )
      .count();
    check(marks > 0, "the card on the board actually draws", `${marks} marks`);
    await fresh.close();

    // --- reorder ----------------------------------------------------------
    if (second) {
      await page.goto(`${BASE}/connections/${connection.id}`, { waitUntil: "networkidle" });
      await page.locator(`article[aria-label="${second.name}"]`).first()
        .getByLabel("Add to dashboard").click();
      await page.getByRole("button", { name: new RegExp(`Add to ${escapeRe(NAME)}`) }).click();
      await page.waitForTimeout(1500);

      const before = (await engineBoards()).find((b) => b.id === boardId);
      check(
        JSON.stringify(before?.query_ids) === JSON.stringify([query.id, second.id]),
        "cards land in the order they were added",
        `query_ids=${JSON.stringify(before?.query_ids)}`,
      );

      await page.goto(`${BASE}/dashboards/${boardId}`, { waitUntil: "networkidle" });
      const firstCard = await openCardMenu(page, query.name);
      await firstCard.getByRole("button", { name: "Move later" }).click();
      await page.waitForTimeout(1500);

      const after = (await engineBoards()).find((b) => b.id === boardId);
      check(
        JSON.stringify(after?.query_ids) === JSON.stringify([second.id, query.id]),
        "reordering writes the whole new order through",
        `query_ids=${JSON.stringify(after?.query_ids)}`,
      );

      // Take it back off so the remove/delete steps below stay as written.
      const extraCard = await openCardMenu(page, second.name);
      await extraCard.getByRole("button", { name: /remove from this board/i }).click();
      await page.waitForTimeout(1500);
    } else {
      console.log("skip reorder: the seed has only one query on this connection");
    }

    // --- rename -----------------------------------------------------------
    await page.goto(`${BASE}/dashboards/${boardId}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^rename$/i }).click();
    await page.getByLabel("Dashboard name").fill(RENAMED);
    await page.getByRole("button", { name: /^save$/i }).click();
    await page.waitForTimeout(1500);
    const afterRename = (await engineBoards()).find((b) => b.id === boardId);
    check(afterRename?.name === RENAMED, "rename writes through", `name=${afterRename?.name}`);
    check(
      (await page.getByText(RENAMED).count()) > 0,
      "the renamed board is on screen without a reload",
    );

    // --- remove the card from the board -----------------------------------
    const onlyCard = await openCardMenu(page, query.name);
    await onlyCard.getByRole("button", { name: /remove from this board/i }).click();
    await page.waitForTimeout(1500);
    const afterRemove = (await engineBoards()).find((b) => b.id === boardId);
    check(
      afterRemove?.query_ids.length === 0,
      "removing a card writes through",
      `query_ids=${JSON.stringify(afterRemove?.query_ids)}`,
    );

    // --- delete -----------------------------------------------------------
    await page.getByRole("button", { name: /^delete$/i }).click();
    await page.getByRole("button", { name: /delete board/i }).click();
    await page.waitForTimeout(1500);
    const afterDelete = await engineBoards();
    check(
      !afterDelete.some((b) => b.id === boardId),
      "delete removes the board from the engine",
    );
    boardId = null;

    // --- a board that is gone says so, a broken engine does not ------------
    expectingErrors = true;
    await page.goto(`${BASE}/dashboards/00000000-0000-0000-0000-000000000000`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);
    check(
      (await page.getByText("This dashboard does not exist").count()) > 0,
      "an unknown board id reads as missing, not as an error",
    );
  } finally {
    /*
     * Never leave a smoke board behind, even on a failure - and match by name
     * rather than by the captured id, because a failure early enough (the
     * create navigation timing out, say) leaves a board on the engine that this
     * script never learned the id of.
     */
    const mine = await engineBoards()
      .then((boards) => boards.filter((b) => b.id === boardId || b.name.startsWith(NAME)))
      .catch(() => []);
    for (const leftover of mine) {
      await fetch(`${ENGINE}/dashboards/${leftover.id}`, { method: "DELETE" }).catch(() => {});
    }
    await browser.close();
  }

  if (consoleErrors.length > 0) {
    console.log("\nconsole errors:");
    for (const error of [...new Set(consoleErrors)]) console.log("  " + error);
    failures.push(`${new Set(consoleErrors).size} console error(s)`);
  }

  if (failures.length > 0) {
    console.error("\nDASHBOARDS SMOKE FAILED:");
    for (const failure of failures) console.error("  - " + failure);
    process.exit(1);
  }
  console.log("\ndashboards smoke passed");
}

await main();
