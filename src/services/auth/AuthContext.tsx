"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { UserRead } from "@/contracts/api";
import { ApiError, changePassword, login, logout, me } from "@/services/api-client";
import type { Capability } from "./permissions";
import { can as hasCapability } from "./permissions";

/**
 * Who is signed in, for the whole app.
 *
 * One fetch at the root rather than per page: `/auth/me` answers the same
 * question on every screen, and a page-level fetch would mean the rail renders
 * before it knows whether to show the admin section - a control appearing a
 * beat after the page, in the one part of the interface where "appeared late"
 * and "was not allowed" have to look different.
 */
export type AuthStatus =
	/** The first `/auth/me` has not answered yet. */
	| "loading"
	/** The engine has no session to answer for, or refused the one the cookie carried. */
	| "signedOut"
	/** Signed in, and free to use the app. */
	| "signedIn"
	/**
	 * Signed in, but the engine refuses everything except `/auth/me` and
	 * `/auth/change-password` until the password is changed. A distinct state
	 * rather than a flag on `signedIn`, because every route guard has to treat
	 * it as "not usable yet" and a boolean invites the guard that forgets.
	 */
	| "mustChangePassword";

export interface AuthValue {
	status: AuthStatus;
	user: UserRead | null;
	/** True while a sign-in, sign-out or password change is in flight. */
	busy: boolean;
	signIn: (email: string, password: string) => Promise<UserRead>;
	signOut: () => Promise<void>;
	changeOwnPassword: (currentPassword: string, newPassword: string) => Promise<void>;
	/** Re-read `/auth/me`, keeping the current user on screen while it runs. */
	refresh: () => void;
	/** `can(user, capability)`, bound to the signed-in user. */
	can: (capability: Capability) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * One resolved answer about one `/auth/me` read.
 *
 * Keyed on the nonce alone (`String(nonce)`) rather than on `${token}#${nonce}`
 * the way this used to be keyed: the session now lives in an httpOnly cookie
 * that this code cannot read, so there is nothing client-side left to fold
 * into the key except "which generation of the question this is the answer
 * to". Holding the user alongside `ok` is what still lets `status` below be
 * *derived* rather than reset in an effect - when the nonce changes there is a
 * new question in flight, but the old answer stays on screen until the new
 * one lands.
 */
interface Session {
	key: string;
	user: UserRead | null;
	/** False when the engine would not identify the current session. */
	ok: boolean;
}

function statusFor(user: UserRead): AuthStatus {
	return user.must_change_password ? "mustChangePassword" : "signedIn";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [session, setSession] = useState<Session | null>(null);
	const [nonce, setNonce] = useState(0);
	const [busy, setBusy] = useState(false);

	const wanted = String(nonce);
	const resolvedKey = session?.key ?? null;

	/*
	 * Runs at least once, unconditionally, on mount. There is no token to gate
	 * on any more: an httpOnly cookie is invisible to this code by design, so
	 * "is anybody signed in" is a question only the engine can answer, and the
	 * first render has no way to know without asking. `session` starts `null`
	 * on both the server and the first client render - there is no external
	 * store being read here the way the old token read was, so unlike that
	 * read there is nothing that can disagree between the two and produce a
	 * hydration mismatch.
	 */
	useEffect(() => {
		if (resolvedKey === wanted) return;

		const controller = new AbortController();
		let live = true;

		me({ signal: controller.signal })
			.then((user) => {
				if (live) setSession({ key: wanted, user, ok: true });
			})
			.catch((cause) => {
				if (!live) return;
				if (cause instanceof ApiError && cause.kind === "aborted") return;
				/*
				 * A refresh that fails keeps the user it already knew: the engine
				 * being briefly unreachable is not evidence that anybody signed
				 * out, and blanking the app over it would log people out of a
				 * working session on a dropped packet. A *first* load that fails
				 * is different - there is no previous answer to fall back on, so
				 * it resolves to signed out and the login screen offers a retry.
				 */
				setSession((previous) =>
					previous && previous.ok
						? { ...previous, key: wanted }
						: { key: wanted, user: null, ok: false },
				);
			});

		return () => {
			live = false;
			controller.abort();
		};
	}, [wanted, resolvedKey]);

	const user = session?.user ?? null;

	const status: AuthStatus =
		session === null
			? "loading"
			: session.ok && session.user
				? statusFor(session.user)
				: "signedOut";

	const signIn = useCallback(
		async (email: string, password: string) => {
			setBusy(true);
			try {
				const nextUser = await login({ email, password });
				/*
				 * Seeded under the key the effect above is already looking for, so
				 * the app does not spend a second round trip asking who just signed
				 * in. There is nothing to store beyond that: the engine set the
				 * session cookie on this same response, server-side, and the browser
				 * cannot read it - that is the entire point of the BFF proxy this
				 * migration moves onto.
				 */
				setSession({ key: wanted, user: nextUser, ok: true });
				return nextUser;
			} finally {
				setBusy(false);
			}
		},
		[wanted],
	);

	const signOut = useCallback(async () => {
		setBusy(true);
		try {
			// Best effort. A sign-out that fails because the network is down and
			// leaves somebody looking signed in is the worst of both.
			await logout().catch(() => undefined);
		} finally {
			/*
			 * Set directly rather than cleared to `null`. The call above just told
			 * the server to drop the cookie, so there is nothing left to resolve -
			 * `ok: true` with no user reads as signed out below, without spending
			 * another `/auth/me` round trip that could only confirm what this call
			 * already caused.
			 */
			setSession({ key: wanted, user: null, ok: true });
			setBusy(false);
		}
	}, [wanted]);

	const refresh = useCallback(() => setNonce((count) => count + 1), []);

	const changeOwnPassword = useCallback(
		async (currentPassword: string, newPassword: string) => {
			setBusy(true);
			try {
				await changePassword({
					current_password: currentPassword,
					new_password: newPassword,
				});

				/*
				 * Re-read here and await it, rather than bumping the nonce and
				 * letting the effect catch up. The caller navigates as soon as
				 * this resolves, and `AuthGate` sends `mustChangePassword`
				 * straight back to this screen - so a refresh that had not landed
				 * yet would bounce the user back to the form they just completed.
				 *
				 * The engine keeps this session alive through the change (it
				 * revokes every *other* one), so the same cookie is still the
				 * right one to ask with - the browser attaches it on its own,
				 * there is nothing here that needs to re-supply it.
				 */
				const updated = await me();
				// Stored under the key the effect is already looking for, so this
				// counts as that fetch rather than racing a second one.
				setSession({ key: wanted, user: updated, ok: true });
			} finally {
				setBusy(false);
			}
		},
		[wanted],
	);

	const value = useMemo<AuthValue>(
		() => ({
			status,
			user,
			busy,
			signIn,
			signOut,
			changeOwnPassword,
			refresh,
			can: (capability: Capability) => hasCapability(user, capability),
		}),
		[status, user, busy, signIn, signOut, changeOwnPassword, refresh],
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
	const value = useContext(AuthContext);
	if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
	return value;
}

/** The signed-in user, or null. Shorthand for the common read. */
export function useUser(): UserRead | null {
	return useAuth().user;
}

/** Whether the signed-in user holds a capability. */
export function useCan(capability: Capability): boolean {
	return useAuth().can(capability);
}
