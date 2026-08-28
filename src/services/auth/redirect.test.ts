import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_LOGIN, safeNextPath } from "./redirect";

/**
 * `?next=` is attacker-controlled: it is a query parameter on a public page, so
 * anybody can put anything in it and send the link to a colleague. The whole
 * point of this function is that the answer is a path on this origin or the
 * root - never a destination somebody else chose.
 */
describe("safeNextPath", () => {
	it("keeps a same-origin path, query string and all", () => {
		expect(safeNextPath("/connections/c1/flagged")).toBe("/connections/c1/flagged");
		expect(safeNextPath("/dashboards/d1?card=q7")).toBe("/dashboards/d1?card=q7");
		expect(safeNextPath("/queries/q1#rules")).toBe("/queries/q1#rules");
	});

	it("falls back when there is nothing to go back to", () => {
		expect(safeNextPath(null)).toBe(DEFAULT_AFTER_LOGIN);
		expect(safeNextPath(undefined)).toBe(DEFAULT_AFTER_LOGIN);
		expect(safeNextPath("")).toBe(DEFAULT_AFTER_LOGIN);
	});

	it("refuses an absolute URL to another origin", () => {
		expect(safeNextPath("https://evil.example/harvest")).toBe(DEFAULT_AFTER_LOGIN);
		expect(safeNextPath("http://evil.example")).toBe(DEFAULT_AFTER_LOGIN);
	});

	it("refuses a protocol-relative URL", () => {
		// `//evil.example` is an absolute URL to a browser, and it starts with a
		// slash - which is why a naive `startsWith("/")` check is not enough.
		expect(safeNextPath("//evil.example/harvest")).toBe(DEFAULT_AFTER_LOGIN);
	});

	it("refuses the backslash form browsers normalise into one", () => {
		expect(safeNextPath("/\\evil.example")).toBe(DEFAULT_AFTER_LOGIN);
	});

	it("refuses a scheme that is not a path at all", () => {
		expect(safeNextPath("javascript:alert(1)")).toBe(DEFAULT_AFTER_LOGIN);
		expect(safeNextPath("data:text/html,<script>alert(1)</script>")).toBe(DEFAULT_AFTER_LOGIN);
	});

	it("refuses a value carrying control characters", () => {
		expect(safeNextPath("/ok\nLocation: https://evil.example")).toBe(DEFAULT_AFTER_LOGIN);
		expect(safeNextPath("/ok\tmore")).toBe(DEFAULT_AFTER_LOGIN);
		expect(safeNextPath("/ok\u0000")).toBe(DEFAULT_AFTER_LOGIN);
	});

	it("refuses a relative path with no leading slash", () => {
		expect(safeNextPath("connections")).toBe(DEFAULT_AFTER_LOGIN);
		expect(safeNextPath("../admin/users")).toBe(DEFAULT_AFTER_LOGIN);
	});

	it("does not bounce back to the screens that redirect here", () => {
		// Otherwise signing in from /login?next=/login lands on the login form.
		expect(safeNextPath("/login")).toBe(DEFAULT_AFTER_LOGIN);
		expect(safeNextPath("/login?next=%2Fadmin")).toBe(DEFAULT_AFTER_LOGIN);
		expect(safeNextPath("/change-password")).toBe(DEFAULT_AFTER_LOGIN);
	});

	it("does not confuse a path that merely starts with those names", () => {
		expect(safeNextPath("/login-history")).toBe("/login-history");
	});
});
