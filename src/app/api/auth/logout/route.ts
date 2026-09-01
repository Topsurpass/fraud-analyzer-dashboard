import { NextResponse, type NextRequest } from "next/server";
import { clearedCookie, readSession } from "@/lib/session";

/**
 * Ends the session, locally first.
 *
 * The engine keeps its own record of live sessions and is worth telling, but
 * "the engine is unreachable" must never mean "the sign-out button did
 * nothing" - somebody who clicks it has to end up signed out of *this*
 * browser regardless of what the engine says or whether it answers at all.
 * The cookie is cleared unconditionally; the engine call is best effort.
 *
 * Guarded by the same CSRF header the catch-all proxy requires on every
 * mutating request (see `src/app/api/[...path]/route.ts`). Logout is not
 * itself a route the proxy handles - it is its own handler because it must
 * clear the cookie even when the engine 401s or times out, which the proxy's
 * "only clear on a 401 response" rule does not cover - but it carries the
 * same session cookie and the same SameSite=Lax gap a cross-site form could
 * otherwise exploit to force a sign-out, so it is held to the same rule.
 */

const CSRF_HEADER = "x-switchboard-request";

function engineBase(): string {
  const base = process.env.ENGINE_BASE_URL?.trim();
  if (!base) {
    throw new Error("ENGINE_BASE_URL is not set. Add it to .env.local.");
  }
  return base.replace(/\/+$/, "");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get(CSRF_HEADER) !== "1") {
    return NextResponse.json(
      { error_code: "FORBIDDEN", message: "Missing request header.", detail: null },
      { status: 403 },
    );
  }

  const token = readSession(request);

  if (token) {
    try {
      await fetch(`${engineBase()}/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
    } catch {
      // Unreachable engine must not block signing out of this browser. There
      // is nothing useful to do with this failure beyond not letting it
      // propagate: the cookie clears below either way.
    }
  }

  const response = NextResponse.json(
    { ok: true },
    { headers: { "cache-control": "no-store" } },
  );
  response.cookies.set(clearedCookie());
  return response;
}
