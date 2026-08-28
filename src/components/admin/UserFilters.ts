import type { UserRead, UserRole } from "@/contracts/api";

/**
 * Filtering the account list.
 *
 * Pulled out of the component and given no React in it at all, because "which
 * rows match" is the one part of that screen that is the same answer every
 * time it is asked. Testing it through the rendered page would mean typing into
 * a box to assert on a substring match.
 */
export type StatusFilter = "all" | "active" | "inactive";
export type RoleFilter = "all" | UserRole;

export interface UserQuery {
	text: string;
	role: RoleFilter;
	status: StatusFilter;
}

export const EMPTY_USER_QUERY: UserQuery = { text: "", role: "all", status: "all" };

/**
 * Case-insensitive substring over name and email.
 *
 * Substring rather than prefix: people search for the local part of an address
 * ("dami") as often as for a surname, and a prefix match on the whole email
 * finds neither. Not fuzzy - a fuzzy match on a list of colleagues returns the
 * wrong person confidently, which is worse than returning nothing.
 */
export function matchesUserQuery(user: UserRead, query: UserQuery): boolean {
	if (query.role !== "all" && user.role !== query.role) return false;
	if (query.status === "active" && !user.is_active) return false;
	if (query.status === "inactive" && user.is_active) return false;

	const text = query.text.trim().toLowerCase();
	if (!text) return true;
	return (
		user.full_name.toLowerCase().includes(text) || user.email.toLowerCase().includes(text)
	);
}

export function filterUsers(users: readonly UserRead[], query: UserQuery): UserRead[] {
	return users.filter((user) => matchesUserQuery(user, query));
}

/**
 * How many active administrators there are.
 *
 * The engine refuses to remove the last one (`LAST_ADMIN`), and the interface
 * uses this to explain the refusal before somebody triggers it rather than
 * after: a disabled control with "this is the only administrator" attached is a
 * better answer than a 409 with the same words.
 */
export function activeAdminCount(users: readonly UserRead[]): number {
	return users.filter((user) => user.is_active && user.role === "admin").length;
}

/**
 * Whether changing this account would strip the installation of its last
 * administrator. Mirrors `user_service.guard_last_admin` on the engine, which
 * is the half that actually decides.
 */
export function isLastActiveAdmin(user: UserRead, users: readonly UserRead[]): boolean {
	return user.is_active && user.role === "admin" && activeAdminCount(users) <= 1;
}
