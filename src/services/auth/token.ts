/**
 * Where the session token lives.
 *
 * Two stores on purpose, and they answer different questions. The module-level
 * variable is what `request()` reads on every call: that path is synchronous
 * and runs hundreds of times a minute during polling, so it must not touch
 * `localStorage`, which is a synchronous main-thread disk read. `localStorage`
 * is only what survives a reload, so it is read once at boot and written on
 * change.
 *
 * Deliberately not a cookie. The engine reads `Authorization: Bearer` and
 * nothing else (see `app/routers/auth.py::_bearer`), and it is configured with
 * `allow_credentials=False`, so a cookie would never be sent to it. It also
 * means this app has no CSRF surface on the engine: a cross-site form post
 * carries cookies, never a header this code has to attach by hand.
 *
 * The trade-off that comes with that choice, stated rather than left implicit:
 * a token in `localStorage` is readable by any script that gets to run on this
 * origin, where an httpOnly cookie is not. The engine cannot use httpOnly
 * cookies as it stands, so the mitigation is upstream - a strict CSP and no
 * third-party scripts on this origin - not a different store here.
 */

const STORAGE_KEY = "fae.session-token";

let token: string | null = null;
let hydrated = false;

type Listener = (token: string | null) => void;
const listeners = new Set<Listener>();

function storage(): Storage | null {
	// Server render, and browsers that refuse storage in a private window. A
	// throwing accessor is the documented behaviour in the second case, so the
	// access itself is guarded, not just the absence of `window`.
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
}

/**
 * The token, reading it out of storage on first call.
 *
 * Lazily rather than at module load: this module is imported by the API client,
 * which is imported during server rendering, and a module-load-time read would
 * run in an environment with no `window` and cache `null` for the session.
 */
export function getToken(): string | null {
	if (!hydrated) {
		hydrated = true;
		token = storage()?.getItem(STORAGE_KEY) ?? null;
	}
	return token;
}

export function setToken(next: string | null): void {
	hydrated = true;
	if (token === next) return;
	token = next;

	const store = storage();
	try {
		if (next === null) store?.removeItem(STORAGE_KEY);
		else store?.setItem(STORAGE_KEY, next);
	} catch {
		// A full or blocked quota must not break signing in. The session still
		// works for this tab; it just will not survive a reload.
	}

	for (const listener of listeners) listener(next);
}

export function clearToken(): void {
	setToken(null);
}

/**
 * Notify on change, including changes made in another tab.
 *
 * The cross-tab half matters for one case in particular: signing out in one tab
 * must not leave a second tab holding a live-looking interface whose every
 * request 401s. `storage` events fire only in *other* tabs, which is exactly
 * the half this cannot see on its own.
 */
export function subscribeToken(listener: Listener): () => void {
	listeners.add(listener);

	const onStorage = (event: StorageEvent) => {
		if (event.key !== null && event.key !== STORAGE_KEY) return;
		// `key === null` is a whole-storage clear, which drops the token too.
		const next = event.key === null ? (storage()?.getItem(STORAGE_KEY) ?? null) : event.newValue;
		if (next === token) return;
		token = next;
		hydrated = true;
		for (const each of listeners) each(next);
	};

	if (typeof window !== "undefined") window.addEventListener("storage", onStorage);

	return () => {
		listeners.delete(listener);
		if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
	};
}

/** Test seam. Drops the in-memory copy so the next read hits storage again. */
export function resetTokenForTests(): void {
	token = null;
	hydrated = false;
	listeners.clear();
}
