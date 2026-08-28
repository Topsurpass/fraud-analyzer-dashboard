"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import type { UserRead } from "@/contracts/api";
import { ApiError, changePassword, login, logout, me } from "@/services/api-client";
import { clearToken, getToken, setToken, subscribeToken } from "./token";
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
	/** A token exists and `/auth/me` has not answered for it yet. */
	| "loading"
	/** No token, or the engine would not tell us who it belongs to. */
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
 * One resolved answer about one token.
 *
 * Keyed by `${token}#${nonce}` so a deliberate refresh re-runs while an
 * unchanged token does not. Holding the token alongside the user is what lets
 * the status below be *derived* rather than cleared in an effect: when the
 * token changes, every field of the old session is stale by construction and
 * there is nothing to reset.
 */
interface Session {
	key: string;
	token: string;
	user: UserRead | null;
	/** False when the engine would not identify this token. */
	ok: boolean;
}

function statusFor(user: UserRead): AuthStatus {
	return user.must_change_password ? "mustChangePassword" : "signedIn";
}

/** The server has no token, and neither does the first client render. */
const NO_TOKEN_ON_SERVER = () => null;

export function AuthProvider({ children }: { children: React.ReactNode }) {
	/*
	 * The token is external state - the request layer drops it on a 401, and
	 * another tab can sign out - so it is read through the hook built for
	 * exactly that. It also settles hydration: the server snapshot is `null`, so
	 * the first client render agrees with the server and the real value arrives
	 * on subscription rather than as a mismatch.
	 */
	const token = useSyncExternalStore(subscribeToken, getToken, NO_TOKEN_ON_SERVER);

	const [session, setSession] = useState<Session | null>(null);
	const [nonce, setNonce] = useState(0);
	const [busy, setBusy] = useState(false);

	const wanted = `${token ?? ""}#${nonce}`;
	const resolvedKey = session?.key ?? null;

	useEffect(() => {
		if (token === null || resolvedKey === wanted) return;

		const controller = new AbortController();
		let live = true;

		me({ signal: controller.signal })
			.then((user) => {
				if (live) setSession({ key: wanted, token, user, ok: true });
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
					previous && previous.token === token && previous.ok
						? { ...previous, key: wanted }
						: { key: wanted, token, user: null, ok: false },
				);
			});

		return () => {
			live = false;
			controller.abort();
		};
	}, [token, wanted, resolvedKey]);

	const current = session && session.token === token ? session : null;
	const user = current?.user ?? null;

	const status: AuthStatus =
		token === null
			? "signedOut"
			: current === null
				? "loading"
				: current.ok && current.user
					? statusFor(current.user)
					: "signedOut";

	const signIn = useCallback(async (email: string, password: string) => {
		setBusy(true);
		try {
			const response = await login({ email, password });
			// Seeded before the token is set, so the effect above sees a session
			// that already matches and the app does not spend a second round trip
			// asking who just signed in.
			setSession({ key: `${response.token}#0`, token: response.token, user: response.user, ok: true });
			setNonce(0);
			setToken(response.token);
			return response.user;
		} finally {
			setBusy(false);
		}
	}, []);

	const signOut = useCallback(async () => {
		setBusy(true);
		try {
			// Best effort. A sign-out that fails because the network is down and
			// leaves somebody looking signed in is the worst of both.
			await logout().catch(() => undefined);
		} finally {
			setSession(null);
			clearToken();
			setBusy(false);
		}
	}, []);

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
				 * revokes every *other* one), so the existing token is still the
				 * right one to ask with.
				 */
				const settled = getToken();
				if (settled !== null) {
					const updated = await me();
					// Stored under the key the effect is already looking for, so
					// this counts as that fetch rather than racing a second one.
					setSession({ key: wanted, token: settled, user: updated, ok: true });
				}
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
