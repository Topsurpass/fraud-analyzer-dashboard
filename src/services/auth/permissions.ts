import type { UserRead, UserRole } from "@/contracts/api";

/**
 * What each role may do, as one table.
 *
 * This exists because the alternative is `user.role === "admin"` written in
 * fourteen components. That form has two failure modes and both are silent:
 * a screen that forgets the check ships an action which 403s on click, and a
 * screen that checks the wrong way round hides a control from the person whose
 * job it is. Neither shows up in a review of the component doing it, because
 * the rule is not written down anywhere to compare against.
 *
 * The table below IS the rule, and it mirrors the engine's dependencies file
 * for file: every capability marked admin-only here is a route the engine
 * guards with `require_admin` (see `app/security/deps.py` and the router
 * modules), and every capability both roles hold is a route guarded only by
 * `require_user`. The engine is the control; this is what stops the interface
 * offering an action the engine will refuse.
 *
 * Ownership is deliberately NOT modelled here. An analyst may edit *their own*
 * saved query and not somebody else's, but which rows those are is a fact
 * about data, not about roles - the engine scopes the list it returns (see
 * `saved_query_service.visible_to`), so a query the analyst can see is a query
 * the analyst may act on, and a second client-side rule would only be able to
 * disagree with it.
 */
export type Capability =
	/* Connections: analysts query these databases, so they see the list. Every
	   change to one is admin-only, symmetric with delete. */
	| "connections.view"
	| "connections.create"
	| "connections.edit"
	| "connections.delete"
	| "connections.test"
	| "connections.pause"
	/* Saved queries, flag rules and dashboards: any signed-in user, scoped by
	   ownership on the engine. */
	| "queries.write"
	| "queries.run"
	| "flagRules.write"
	| "dashboards.write"
	/* Administration. */
	| "users.manage"
	| "auditLog.view";

/** Every capability, so a test can prove the table below covers all of them. */
export const CAPABILITIES: readonly Capability[] = [
	"connections.view",
	"connections.create",
	"connections.edit",
	"connections.delete",
	"connections.test",
	"connections.pause",
	"queries.write",
	"queries.run",
	"flagRules.write",
	"dashboards.write",
	"users.manage",
	"auditLog.view",
];

const ANALYST: readonly Capability[] = [
	"connections.view",
	"queries.write",
	"queries.run",
	"flagRules.write",
	"dashboards.write",
];

const ADMIN: readonly Capability[] = CAPABILITIES;

export const ROLE_CAPABILITIES: Record<UserRole, readonly Capability[]> = {
	admin: ADMIN,
	analyst: ANALYST,
};

/**
 * Why a capability is refused, in the words the engine would use.
 *
 * A disabled control with no reason is worse than no control: the person can
 * see the thing they want and is told nothing about why it will not move. The
 * engine's own message for a role refusal is "This needs an administrator
 * account." and it is repeated here so both halves of the system say the same
 * sentence.
 */
export const ADMIN_ONLY_REASON = "This needs an administrator account.";

/**
 * Whether this user holds this capability.
 *
 * A null user (signed out, or still being resolved at boot) holds nothing.
 * That is the safe direction: a control briefly hidden during a page load is a
 * flicker, where a control briefly shown is an action somebody can click.
 *
 * An inactive account holds nothing either. The engine refuses its session
 * outright, so a deactivated user who still has a page open should see the
 * interface stop offering actions rather than collect 401s one click at a time.
 */
export function can(user: UserRead | null | undefined, capability: Capability): boolean {
	if (!user || !user.is_active) return false;
	// A must_change_password account is refused every endpoint but /auth/me and
	// /auth/change-password, so it genuinely holds no capability - the interface
	// must not offer one. See `require_user` in the engine's `security/deps.py`.
	if (user.must_change_password) return false;
	return ROLE_CAPABILITIES[user.role]?.includes(capability) ?? false;
}

/** `can`, inverted, with the reason to show when it is false. Null when allowed. */
export function reasonToRefuse(
	user: UserRead | null | undefined,
	capability: Capability,
): string | null {
	if (can(user, capability)) return null;
	if (!user) return "Sign in to continue.";
	if (!user.is_active) return "This account has been deactivated.";
	if (user.must_change_password) return "Choose a new password before continuing.";
	return ADMIN_ONLY_REASON;
}

/** Whether this user may reach a route. Used by the rail and the page guards. */
export function isAdmin(user: UserRead | null | undefined): boolean {
	return can(user, "users.manage");
}
