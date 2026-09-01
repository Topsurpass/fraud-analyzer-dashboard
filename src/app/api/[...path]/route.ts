import { NextResponse, type NextRequest } from "next/server";
import { clearedCookie, readSession } from "@/lib/session";

/**
 * Everything the browser asks of the engine passes through here.
 *
 * The browser never holds the session token. It holds an httpOnly cookie this
 * handler reads server-side and exchanges for a bearer header, so script on
 * the page cannot lift the session even if an XSS bug lets it run.
 *
 * ENGINE_BASE_URL is deliberately NOT prefixed NEXT_PUBLIC_. A public variable
 * is inlined into the client bundle, which would publish the engine's address
 * and undo the private-network property this whole design rests on.
 */

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * A header a cross-site form post cannot set, and a cross-origin fetch cannot
 * send without passing preflight. Paired with SameSite=Lax on the cookie it
 * closes CSRF without a token round trip.
 */
const CSRF_HEADER = "x-switchboard-request";

function engineBase(): string {
  const base = process.env.ENGINE_BASE_URL?.trim();
  if (!base) {
    // Failing loudly beats proxying to undefined and reporting a network error
    // the operator cannot act on.
    throw new Error("ENGINE_BASE_URL is not set. Add it to .env.local.");
  }
  return base.replace(/\/+$/, "");
}

async function proxy(request: NextRequest, path: string[]): Promise<NextResponse> {
  const token = readSession(request);
  if (!token) {
    // Answered here rather than at the engine: an unauthenticated caller
    // should cost nothing downstream.
    return NextResponse.json(
      { error_code: "NOT_AUTHENTICATED", message: "Sign in to continue.", detail: null },
      { status: 401 },
    );
  }

  if (MUTATING.has(request.method) && request.headers.get(CSRF_HEADER) !== "1") {
    return NextResponse.json(
      { error_code: "FORBIDDEN", message: "Missing request header.", detail: null },
      { status: 403 },
    );
  }

  const url = new URL(`${engineBase()}/${path.join("/")}`);
  url.search = request.nextUrl.search;

  const headers = new Headers();
  headers.set("authorization", `Bearer ${token}`);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body: MUTATING.has(request.method) ? await request.text() : undefined,
    // Never let a proxied answer be cached: one analyst's rows must not be
    // served to the next.
    cache: "no-store",
  });

  const body = await upstream.text();
  const response = new NextResponse(body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });

  // The engine rejected the session, so the cookie is worthless. Leaving it
  // set makes every later request retry a dead session forever.
  if (upstream.status === 401) response.cookies.set(clearedCookie());

  return response;
}

type Context = { params: Promise<{ path: string[] }> };

async function handler(request: NextRequest, context: Context) {
  const { path } = await context.params;
  return proxy(request, path);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
