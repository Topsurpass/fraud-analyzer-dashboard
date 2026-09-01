import type { NextRequest } from "next/server";

/**
 * The session cookie, and the rules that make it worth having.
 *
 * `httpOnly` is the whole point: script on the page cannot read it, so an XSS
 * bug that would otherwise be a full account takeover cannot lift the session.
 * `sameSite: "lax"` stops a cross-site form post from riding it, and the proxy
 * additionally requires a custom header on mutating requests, which a
 * cross-site form cannot set and a cross-origin fetch cannot send without
 * passing preflight.
 *
 * `secure` is on except in development, where there is no TLS on localhost and
 * a secure cookie would simply never be stored.
 */
export const SESSION_COOKIE = "switchboard_session";

const MAX_AGE_SECONDS = 12 * 60 * 60;

export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

/** Same attributes, empty and expired. A cookie cleared with different
 *  attributes than it was set with is not cleared at all. */
export function clearedCookie() {
  return { ...sessionCookie(""), maxAge: 0 };
}

export function readSession(request: NextRequest): string | null {
  return request.cookies.get(SESSION_COOKIE)?.value ?? null;
}
