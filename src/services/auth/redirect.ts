/**
 * Where to send somebody after they sign in.
 *
 * `?next=` comes from the URL bar, which means it is attacker-controlled: a
 * link to `/login?next=https://evil.example/harvest` sends a person through a
 * login page they trust and out to a page they do not, with the referrer
 * saying they came from here. That is an open redirect, and the fix is not to
 * sanitise the string but to refuse anything that is not a path on this origin.
 *
 * Only same-origin absolute paths survive. Everything else falls back to the
 * app root, which is never wrong - just less specific than it could have been.
 */
export const DEFAULT_AFTER_LOGIN = "/";

/** A newline, a tab, a NUL: how a value gets split across a header or slipped
 *  past a naive prefix check upstream. No route in this app contains one. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function safeNextPath(raw: string | null | undefined): string {
	if (!raw) return DEFAULT_AFTER_LOGIN;

	// Must be a rooted path. This rejects `https://evil.example`, `//evil.example`
	// (a protocol-relative URL, which browsers treat as absolute), and any bare
	// word that would resolve relative to the current page.
	if (!raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_AFTER_LOGIN;

	// `/\evil.example` is treated as protocol-relative by browsers that
	// normalise the backslash to a slash before parsing.
	if (raw.startsWith("/\\")) return DEFAULT_AFTER_LOGIN;

	if (CONTROL_CHARACTERS.test(raw)) return DEFAULT_AFTER_LOGIN;

	// Never bounce straight back to the screens that produced the redirect, or
	// signing in lands on the login form again.
	const path = raw.split(/[?#]/)[0];
	if (path === "/login" || path === "/change-password") return DEFAULT_AFTER_LOGIN;

	return raw;
}
