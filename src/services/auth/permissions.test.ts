import { describe, expect, it } from "vitest";
import type { UserRead, UserRole } from "@/contracts/api";
import {
	ADMIN_ONLY_REASON,
	CAPABILITIES,
	ROLE_CAPABILITIES,
	can,
	isAdmin,
	reasonToRefuse,
	type Capability,
} from "./permissions";

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

/**
 * The table below is transcribed from the engine's routers, and is the thing
 * this file exists to protect. Each entry names an endpoint and the guard that
 * router hangs on it, so a reviewer can check one column against one Python
 * file rather than reading both codebases at once.
 *
 * `require_admin` means the engine answers 403 for an analyst; `require_user`
 * means any signed-in account may call it and the engine scopes the *rows* by
 * ownership rather than refusing the call.
 */
const ENGINE_GUARDS: Array<[Capability, "require_admin" | "require_user", string]> = [
	["connections.view", "require_user", "GET /connections"],
	["connections.create", "require_admin", "POST /connections"],
	["connections.edit", "require_admin", "PUT /connections/{id}"],
	["connections.delete", "require_admin", "DELETE /connections/{id}"],
	["connections.test", "require_admin", "POST /connections/{id}/test"],
	["connections.pause", "require_admin", "POST /connections/{id}/disconnect and /reconnect"],
	["queries.write", "require_user", "POST /connections/{id}/queries"],
	["queries.run", "require_user", "POST /queries/{id}/run"],
	["flagRules.write", "require_user", "PUT /queries/{id}/flag-rules"],
	["dashboards.write", "require_user", "POST /dashboards"],
	["users.manage", "require_admin", "POST /users"],
	["auditLog.view", "require_admin", "GET /audit-log"],
];

describe("the capability table mirrors the engine", () => {
	it("names every capability exactly once", () => {
		expect(ENGINE_GUARDS.map(([capability]) => capability).sort()).toEqual(
			[...CAPABILITIES].sort(),
		);
	});

	it.each(ENGINE_GUARDS)(
		"%s is %s on the engine (%s)",
		(capability, guard) => {
			const admin = can(user({ role: "admin" }), capability);
			const analyst = can(user({ role: "analyst" }), capability);

			// An admin holds everything, whichever guard it is: `require_admin`
			// passes an admin, and so does `require_user`.
			expect(admin).toBe(true);
			expect(analyst).toBe(guard === "require_user");
		},
	);

	it("gives an admin every capability there is", () => {
		expect([...ROLE_CAPABILITIES.admin].sort()).toEqual([...CAPABILITIES].sort());
	});

	it("gives an analyst no capability an admin lacks", () => {
		for (const capability of ROLE_CAPABILITIES.analyst) {
			expect(ROLE_CAPABILITIES.admin).toContain(capability);
		}
	});

	it("covers both roles the engine defines and no others", () => {
		const roles: UserRole[] = ["admin", "analyst"];
		expect(Object.keys(ROLE_CAPABILITIES).sort()).toEqual([...roles].sort());
	});
});

describe("can", () => {
	it("grants nothing to a signed-out visitor", () => {
		for (const capability of CAPABILITIES) {
			expect(can(null, capability)).toBe(false);
			expect(can(undefined, capability)).toBe(false);
		}
	});

	it("grants nothing to a deactivated account, whatever its role", () => {
		const suspended = user({ role: "admin", is_active: false });
		for (const capability of CAPABILITIES) {
			expect(can(suspended, capability)).toBe(false);
		}
	});

	it("grants nothing while a password change is outstanding", () => {
		/*
		 * The engine refuses this account every endpoint but /auth/me and
		 * /auth/change-password, so an interface that still offered actions
		 * would be offering guaranteed 403s. An admin is the case that matters:
		 * the role says yes and the gate says no, and the gate wins.
		 */
		const gated = user({ role: "admin", must_change_password: true });
		for (const capability of CAPABILITIES) {
			expect(can(gated, capability)).toBe(false);
		}
	});
});

describe("reasonToRefuse", () => {
	it("is null when the capability is held", () => {
		expect(reasonToRefuse(user({ role: "admin" }), "users.manage")).toBeNull();
	});

	it("tells an analyst it needs an administrator, in the engine's words", () => {
		expect(reasonToRefuse(user(), "users.manage")).toBe(ADMIN_ONLY_REASON);
	});

	it("distinguishes signed out from not allowed", () => {
		// A client that conflates these either sends a permitted user to log in
		// or shows an access error to somebody who simply is not signed in.
		expect(reasonToRefuse(null, "connections.view")).toBe("Sign in to continue.");
		expect(reasonToRefuse(user(), "connections.create")).toBe(ADMIN_ONLY_REASON);
	});

	it("names deactivation and the password gate separately", () => {
		expect(reasonToRefuse(user({ is_active: false }), "queries.run")).toMatch(/deactivated/i);
		expect(reasonToRefuse(user({ must_change_password: true }), "queries.run")).toMatch(
			/new password/i,
		);
	});
});

describe("isAdmin", () => {
	it("is true only for an active administrator past the password gate", () => {
		expect(isAdmin(user({ role: "admin" }))).toBe(true);
		expect(isAdmin(user({ role: "analyst" }))).toBe(false);
		expect(isAdmin(user({ role: "admin", is_active: false }))).toBe(false);
		expect(isAdmin(user({ role: "admin", must_change_password: true }))).toBe(false);
		expect(isAdmin(null)).toBe(false);
	});
});
