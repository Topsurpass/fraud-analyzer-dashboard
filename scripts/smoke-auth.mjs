#!/usr/bin/env node
/**
 * Sign-in, roles, and account management, in a real browser.
 *
 * The gate suite proves each piece in isolation against a mocked engine: the
 * capability table, the guards, the pages. What it structurally cannot prove is
 * that the two halves agree - that the role the engine enforces and the role
 * the interface draws are the same role, and that a screen the rail hides is
 * also a screen the engine refuses. Every assertion in the gate lane is written
 * against a mock, which is to say against my own understanding of the engine,
 * and that is precisely the thing worth checking against the engine itself.
 *
 * So this lane signs in as a real administrator and a real analyst, and checks
 * both sides of every rule: what each one is shown, and what each one is
 * refused when they ask the engine directly.
 *
 *   node scripts/dev-seed.mjs && npm run dev     # in another shell
 *   node scripts/smoke-auth.mjs --password=...
 *
 * Flags: --base=<url>     (default http://localhost:3000)
 *        --engine=<url>   (default http://127.0.0.1:8000)
 *        --email / --password  the administrator to run as
 *                              (or set FAE_SMOKE_EMAIL / FAE_SMOKE_PASSWORD)
 *
 * It creates two throwaway accounts to work with and deactivates them at the
 * end. Accounts are never deleted by the engine - an audit trail that can lose
 * its subject is not one - so a rerun makes new ones rather than reusing them.
 */

import { chromium } from "playwright";
import { DEFAULT_EMAIL, authed, seedSession, signIn } from "./lib/session.mjs";

const args = new Map(
	process.argv.slice(2).map((raw) => {
		const [key, value] = raw.replace(/^--/, "").split("=");
		return [key, value ?? true];
	}),
);

const BASE = String(args.get("base") ?? "http://localhost:3000").replace(/\/+$/, "");
const ENGINE = String(args.get("engine") ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
const EMAIL = String(args.get("email") ?? DEFAULT_EMAIL);
const PASSWORD = args.get("password") === undefined ? undefined : String(args.get("password"));

if (BASE.includes("127.0.0.1")) {
	console.warn("warning: use http://localhost:3000, not 127.0.0.1 - dev chunks 403 otherwise");
}

const failures = [];
const check = (ok, label, detail = "") => {
	console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures.push(label);
	return ok;
};

/** Unique per run: accounts are never deleted, so names cannot be reused. */
const RUN = Date.now().toString(36);
const ANALYST_EMAIL = `smoke-analyst-${RUN}@example.com`;
const SECOND_EMAIL = `smoke-second-${RUN}@example.com`;

/** Next hydrates after the HTML lands; typing before that sets a DOM node and
 *  never React state, which looks exactly like a form that ignores you. */
async function ready(page) {
	await page.waitForLoadState("networkidle");
	await page.waitForTimeout(700);
}

/**
 * Wait for a redirect to land, rather than sleeping and hoping.
 *
 * Every redirect here is decided in an effect after the session resolves, and
 * two of them wait on the engine first - `/auth/change-password` runs Argon2,
 * which is deliberately slow. A fixed sleep long enough for a loaded machine is
 * dead time on a fast one and still flaky on a slow one; waiting for the URL is
 * neither. Returns whether it arrived, so the check reports the truth either
 * way instead of throwing.
 */
async function landsOn(page, pathname, timeout = 20_000) {
	try {
		await page.waitForURL((url) => new URL(url).pathname === pathname, { timeout });
		return true;
	} catch {
		return false;
	}
}

async function signInThroughTheForm(page, email, password) {
	await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
	await ready(page);
	await page.fill("#login-email", email);
	await page.fill("#login-password", password);
	await page.click('button[type="submit"]');
}

async function main() {
	const { token, user } = await signIn(ENGINE, { email: EMAIL, password: PASSWORD });
	const api = authed(token);
	if (user.role !== "admin") {
		console.error(`${user.email} is ${user.role}; this lane needs an administrator.`);
		process.exit(2);
	}
	console.log(`signed in as ${user.email} (${user.role})\n`);

	const browser = await chromium.launch();

	/* ------------------------------------------------ the gate, signed out */

	const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const anonPage = await anon.newPage();

	await anonPage.goto(`${BASE}/account`, { waitUntil: "networkidle" });
	check(
		await landsOn(anonPage, "/login"),
		"a signed-out visitor is sent to sign in",
		anonPage.url().replace(BASE, ""),
	);
	check(
		new URL(anonPage.url()).searchParams.get("next") === "/account",
		"and the page they wanted is remembered",
	);

	// The open-redirect guard, against a real browser rather than a unit test.
	await anonPage.goto(`${BASE}/login?next=https%3A%2F%2Fevil.example%2Fharvest`, {
		waitUntil: "networkidle",
	});
	await ready(anonPage);
	await anonPage.fill("#login-email", EMAIL);
	await anonPage.fill("#login-password", PASSWORD ?? process.env.FAE_SMOKE_PASSWORD ?? "");
	await anonPage.click('button[type="submit"]');
	await landsOn(anonPage, "/", 30_000);
	check(
		new URL(anonPage.url()).origin === new URL(BASE).origin,
		"signing in cannot be redirected off this origin",
		new URL(anonPage.url()).origin,
	);

	// Its own context: the page above signed in successfully, and a signed-in
	// visitor is sent off the login screen before they can type anything.
	const wrongContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const wrong = await wrongContext.newPage();
	await wrong.goto(`${BASE}/login`, { waitUntil: "networkidle" });
	await ready(wrong);
	await wrong.fill("#login-email", EMAIL);
	await wrong.fill("#login-password", "definitely-not-the-password");
	await wrong.click('button[type="submit"]');
	await wrong.waitForSelector('[role="alert"]', { timeout: 10_000 }).catch(() => {});
	const refusal = await wrong.locator('[role="alert"]').first().textContent();
	check(Boolean(refusal && refusal.trim()), "a wrong password is refused in words", refusal?.trim());
	check(
		(await wrong.inputValue("#login-password")) === "",
		"and the password field is cleared for the next try",
	);
	await wrongContext.close();
	await anon.close();

	/* --------------------------------------------- the administrator's view */

	const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	await seedSession(adminContext, token);
	const admin = await adminContext.newPage();

	await admin.goto(`${BASE}/`, { waitUntil: "networkidle" });
	await ready(admin);
	check(
		await admin.locator('nav[aria-label="Primary"] h2', { hasText: "Administration" }).isVisible(),
		"an administrator sees the administration section",
	);
	check(
		await admin.locator('a[href="/connections/new"]').first().isVisible(),
		"and may add a connection",
	);

	await admin.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
	await ready(admin);
	check(
		await admin.locator('input[aria-label="Search people"]').isVisible(),
		"and can open the account list",
	);

	/* ------------------------------------------- opening an account for real */

	await admin.click('button:has-text("Add person")');
	await admin.fill("#new-user-name", "Smoke Analyst");
	await admin.fill("#new-user-email", ANALYST_EMAIL);
	await admin.selectOption("#new-user-role", "analyst");
	await admin.click('button:has-text("Create account")');

	await admin.waitForSelector('[role="dialog"]', { timeout: 20_000 });
	const temporary = (
		await admin.locator('[role="dialog"] p.font-mono').first().textContent()
	)?.trim();
	check(
		Boolean(temporary && temporary.length >= 12),
		"the temporary password is shown once, in full",
		temporary ? `${temporary.length} characters` : "missing",
	);

	// Escape must not dismiss it: the password exists nowhere else.
	await admin.keyboard.press("Escape");
	check(
		await admin.locator('[role="dialog"]').isVisible(),
		"and a stray keypress cannot throw it away",
	);
	await admin.click('button:has-text("I have copied it")');

	/* ----------------------------------------- the new account's first sign-in */

	const newbieContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const newbie = await newbieContext.newPage();
	await signInThroughTheForm(newbie, ANALYST_EMAIL, temporary);
	check(
		await landsOn(newbie, "/change-password", 30_000),
		"a temporary password lands on the change screen",
		new URL(newbie.url()).pathname,
	);

	// The gate is a gate: it must not be walkable around by typing a URL.
	await newbie.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
	await ready(newbie);
	check(
		new URL(newbie.url()).pathname === "/change-password",
		"and no other page is reachable until it is done",
		new URL(newbie.url()).pathname,
	);

	const CHOSEN = `smoke-chosen-${RUN}-password`;
	await newbie.fill("#current-password", temporary);
	await newbie.fill("#new-password", CHOSEN);
	await newbie.fill("#confirm-password", CHOSEN);
	await newbie.click('button[type="submit"]');
	check(
		// Argon2 on the engine, then a re-read of /auth/me, then the redirect.
		await landsOn(newbie, "/", 30_000),
		"choosing a password lets them into the app",
		new URL(newbie.url()).pathname,
	);
	await ready(newbie);

	/* --------------------------------------------------- the analyst's view */

	check(
		!(await newbie
			.locator('nav[aria-label="Primary"] h2', { hasText: "Administration" })
			.isVisible()
			.catch(() => false)),
		"an analyst is not shown the administration section",
	);
	check(
		(await newbie.locator('a[href="/connections/new"]').count()) === 0,
		"nor offered a new connection",
	);

	await newbie.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
	await ready(newbie);
	const refusalText = (await newbie.locator("body").innerText()).toLowerCase();
	check(
		refusalText.includes("administrator account"),
		"and is told why when they reach the page by URL",
	);
	check(
		!refusalText.includes(ANALYST_EMAIL.toLowerCase()),
		"without the account list leaking into the refusal",
	);

	/* ----------------------------- the engine agrees, which is the half that counts */

	const analystSession = await fetch(`${ENGINE}/auth/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email: ANALYST_EMAIL, password: CHOSEN }),
	}).then((r) => r.json());
	const asAnalyst = authed(analystSession.token);

	const refusals = [
		["GET /users", await asAnalyst(`${ENGINE}/users`)],
		["GET /audit-log", await asAnalyst(`${ENGINE}/audit-log`)],
		[
			"POST /connections",
			await asAnalyst(`${ENGINE}/connections`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "nope", db_type: "sqlite", sqlite_path: "/tmp/nope.db" }),
			}),
		],
	];
	for (const [what, response] of refusals) {
		check(response.status === 403, `the engine refuses an analyst ${what}`, `HTTP ${response.status}`);
	}

	// The other half: what an analyst *is* allowed, so this is not just proving
	// that a broken token refuses everything.
	const allowed = await asAnalyst(`${ENGINE}/connections`);
	check(allowed.status === 200, "and still lets them list connections", `HTTP ${allowed.status}`);

	const anonymous = await fetch(`${ENGINE}/connections`);
	check(
		anonymous.status === 401,
		"an unauthenticated caller gets 401, not 403",
		`HTTP ${anonymous.status}`,
	);

	/* --------------------------------------------------------- the audit log */

	await admin.goto(`${BASE}/admin/audit-log`, { waitUntil: "networkidle" });
	await ready(admin);
	const log = await admin.locator("body").innerText();
	check(
		log.includes(ANALYST_EMAIL),
		"the audit log records the account that was just opened",
	);
	check(
		!log.includes(temporary),
		"and never records the password that was issued with it",
	);

	/* ------------------------------------- the last administrator is protected */

	// Not bound: the teardown finds both throwaway accounts by email, which
	// survives this call having been made on an earlier, half-finished run.
	await api(`${ENGINE}/users`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email: SECOND_EMAIL, full_name: "Smoke Second", role: "admin" }),
	});

	await admin.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
	await ready(admin);
	await admin.fill('input[aria-label="Search people"]', SECOND_EMAIL);
	await admin.waitForTimeout(400);
	const secondRow = admin.locator('[role="row"]', { hasText: SECOND_EMAIL }).first();
	check(
		await secondRow.locator('button:has-text("Deactivate")').isEnabled(),
		"a second administrator can be deactivated",
	);

	// Deactivate it, then confirm the remaining one cannot be.
	await secondRow.locator('button:has-text("Deactivate")').click();
	await admin.waitForTimeout(2000);
	await admin.fill('input[aria-label="Search people"]', EMAIL);
	await admin.waitForTimeout(400);
	const ownRow = admin.locator('[role="row"]', { hasText: EMAIL }).first();
	check(
		await ownRow.locator('button:has-text("Deactivate")').isDisabled(),
		"the last active administrator cannot lock the installation out",
	);
	check(
		(await ownRow.locator("select").isDisabled()) === true,
		"and cannot demote themselves to analyst either",
	);

	/* ------------------------------------------------------------------ tidy up */

	// Before the sign-out below, deliberately: this lane and the browser share
	// one token, and signing out revokes it - so every call here would 401.
	// Accounts are never deleted (an audit trail that can lose its subject is
	// not one), so tidying up means deactivating.
	const everyone = await api(`${ENGINE}/users`).then((r) => r.json());
	for (const email of [ANALYST_EMAIL, SECOND_EMAIL]) {
		const account = Array.isArray(everyone)
			? everyone.find((entry) => entry.email === email)
			: null;
		if (!account || !account.is_active) continue;
		await api(`${ENGINE}/users/${account.id}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ is_active: false }),
		}).catch(() => {});
	}

	/* ------------------------------------------------------------- signing out */

	await admin.click('button[aria-haspopup="menu"]');
	await admin.click('[role="menuitem"]:has-text("Sign out")');
	check(
		await landsOn(admin, "/login"),
		"signing out returns to the login screen",
		new URL(admin.url()).pathname,
	);
	const leftover = await admin.evaluate(() => window.localStorage.getItem("fae.session-token"));
	check(leftover === null, "and takes the stored token with it");

	// The engine's half of the same act: the token must be dead there too, or
	// "signed out" only means "this browser forgot".
	const afterSignOut = await authed(token)(`${ENGINE}/auth/me`);
	check(
		afterSignOut.status === 401,
		"and the engine no longer recognises that session",
		`HTTP ${afterSignOut.status}`,
	);

	await browser.close();

	console.log();
	if (failures.length > 0) {
		console.error(`auth smoke FAILED (${failures.length}):`);
		for (const failure of failures) console.error("  - " + failure);
		process.exit(1);
	}
	console.log("auth smoke passed");
}

main().catch((cause) => {
	console.error(cause);
	process.exit(1);
});
