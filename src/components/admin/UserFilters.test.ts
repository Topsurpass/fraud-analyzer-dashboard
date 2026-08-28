import { describe, expect, it } from "vitest";
import type { UserRead } from "@/contracts/api";
import {
	EMPTY_USER_QUERY,
	activeAdminCount,
	filterUsers,
	isLastActiveAdmin,
	matchesUserQuery,
} from "./UserFilters";

function user(over: Partial<UserRead> = {}): UserRead {
	return {
		id: "u1",
		email: "ada@example.com",
		full_name: "Ada Lovelace",
		role: "analyst",
		is_active: true,
		must_change_password: false,
		last_login_at: null,
		created_at: "2026-08-01T00:00:00Z",
		...over,
	};
}

const ADA = user();
const GRACE = user({ id: "u2", email: "grace@navy.example", full_name: "Grace Hopper", role: "admin" });
const ALAN = user({ id: "u3", email: "alan@example.com", full_name: "Alan Turing", is_active: false });

describe("matchesUserQuery", () => {
	it("matches everything when nothing is set", () => {
		for (const person of [ADA, GRACE, ALAN]) {
			expect(matchesUserQuery(person, EMPTY_USER_QUERY)).toBe(true);
		}
	});

	it("finds a substring of the name or the email, either case", () => {
		// People search for the local part of an address as often as a surname,
		// and a prefix match on the whole email finds neither.
		expect(matchesUserQuery(ADA, { ...EMPTY_USER_QUERY, text: "love" })).toBe(true);
		expect(matchesUserQuery(ADA, { ...EMPTY_USER_QUERY, text: "ADA@" })).toBe(true);
		expect(matchesUserQuery(ADA, { ...EMPTY_USER_QUERY, text: "grace" })).toBe(false);
	});

	it("ignores surrounding whitespace in the search box", () => {
		expect(matchesUserQuery(ADA, { ...EMPTY_USER_QUERY, text: "  ada  " })).toBe(true);
	});

	it("filters by role", () => {
		expect(matchesUserQuery(GRACE, { ...EMPTY_USER_QUERY, role: "admin" })).toBe(true);
		expect(matchesUserQuery(ADA, { ...EMPTY_USER_QUERY, role: "admin" })).toBe(false);
	});

	it("filters by whether the account can sign in", () => {
		expect(matchesUserQuery(ALAN, { ...EMPTY_USER_QUERY, status: "inactive" })).toBe(true);
		expect(matchesUserQuery(ALAN, { ...EMPTY_USER_QUERY, status: "active" })).toBe(false);
		expect(matchesUserQuery(ADA, { ...EMPTY_USER_QUERY, status: "active" })).toBe(true);
	});

	it("requires every set filter, not any of them", () => {
		const query = { text: "ada", role: "admin" as const, status: "all" as const };
		expect(matchesUserQuery(ADA, query)).toBe(false);
	});
});

describe("filterUsers", () => {
	it("keeps the engine's ordering", () => {
		// The engine returns newest first, and the page does not re-sort. A
		// filter that reordered would move rows under the cursor as you type.
		const people = [ADA, GRACE, ALAN];
		expect(filterUsers(people, EMPTY_USER_QUERY)).toEqual(people);
		expect(filterUsers(people, { ...EMPTY_USER_QUERY, text: "a" }).map((p) => p.id)).toEqual([
			"u1",
			"u2",
			"u3",
		]);
	});
});

describe("the last administrator", () => {
	it("counts only administrators who can actually sign in", () => {
		const deactivatedAdmin = user({ id: "u4", role: "admin", is_active: false });
		expect(activeAdminCount([ADA, GRACE, ALAN, deactivatedAdmin])).toBe(1);
	});

	it("flags the only active administrator", () => {
		// The engine refuses the change with LAST_ADMIN; saying so on the control
		// beats saying it in a 409 after the click.
		expect(isLastActiveAdmin(GRACE, [ADA, GRACE, ALAN])).toBe(true);
	});

	it("does not flag one of several", () => {
		const second = user({ id: "u5", role: "admin" });
		expect(isLastActiveAdmin(GRACE, [GRACE, second])).toBe(false);
	});

	it("never flags an analyst, or an admin who is already deactivated", () => {
		expect(isLastActiveAdmin(ADA, [ADA])).toBe(false);
		const deactivatedAdmin = user({ id: "u6", role: "admin", is_active: false });
		expect(isLastActiveAdmin(deactivatedAdmin, [deactivatedAdmin])).toBe(false);
	});
});
