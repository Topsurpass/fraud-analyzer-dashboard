import { NextResponse, type NextRequest } from "next/server";
import { sessionCookie } from "@/lib/session";

/**
 * Exchanges credentials for a session, without the token ever reaching the
 * browser.
 *
 * The engine answers with `{token, user}`. This handler keeps `token`
 * server-side, folded into an httpOnly cookie, and the response body carries
 * only `user`. That split is the entire reason the BFF exists: a browser that
 * never holds the token cannot leak it, no matter what an XSS bug on the page
 * manages to run.
 *
 * A local `engineBase()` rather than a shared import, matching the catch-all
 * proxy at `src/app/api/[...path]/route.ts` - that file's contents are fixed
 * by the plan this task follows, so this one stays consistent with it rather
 * than pulling it onto a shared helper the plan did not ask for.
 *
 * Unlike the proxy and `/api/auth/logout`, this route does not require the
 * CSRF header. There is no session cookie yet for a forged cross-site request
 * to ride, and "login CSRF" - tricking a victim's browser into signing into
 * an attacker-chosen account - needs the attacker's own valid credentials to
 * do anything, which puts it outside what this header is defending against.
 */

function engineBase(): string {
  const base = process.env.ENGINE_BASE_URL?.trim();
  if (!base) {
    throw new Error("ENGINE_BASE_URL is not set. Add it to .env.local.");
  }
  return base.replace(/\/+$/, "");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text();
  const contentType = request.headers.get("content-type") ?? "application/json";

  const upstream = await fetch(`${engineBase()}/auth/login`, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
    // Login is never appropriate to cache, and a cached 401 would lock a
    // corrected password out until the cache expired.
    cache: "no-store",
  });

  const text = await upstream.text();

  if (!upstream.ok) {
    // Forwarded byte-for-byte: the engine deliberately gives a lockout a
    // different message than a bad password, and the login form needs that
    // distinction. Rewriting it here would throw the distinction away.
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  }

  let parsed: { token?: unknown; user?: unknown } = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // A 2xx with an unparseable body means something between here and the
    // engine is broken, not that the credentials were wrong - a 502 says so.
    return NextResponse.json(
      {
        error_code: "BAD_GATEWAY",
        message: "The engine returned an unreadable response.",
        detail: null,
      },
      { status: 502 },
    );
  }

  if (typeof parsed.token !== "string" || !parsed.token || parsed.user === undefined) {
    // Belt and braces: if the engine's contract ever drifts and a login
    // response arrives without a token, failing loudly beats silently setting
    // an empty cookie and reporting success.
    return NextResponse.json(
      {
        error_code: "BAD_GATEWAY",
        message: "The engine did not return a session.",
        detail: null,
      },
      { status: 502 },
    );
  }

  // The response body is the user object itself - not `{token, user}`, not
  // `{user}`. Anything beyond the user object is one field away from being
  // "and also here is the token again", which is exactly the leak this route
  // exists to prevent.
  const response = NextResponse.json(parsed.user, {
    status: upstream.status,
    headers: { "cache-control": "no-store" },
  });
  response.cookies.set(sessionCookie(parsed.token));
  return response;
}
