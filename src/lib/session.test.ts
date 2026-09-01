import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, clearedCookie, readSession, sessionCookie } from "./session";

afterEach(() => {
  vi.unstubAllEnvs();
});

function requestWithCookie(cookieHeader?: string): NextRequest {
  return new NextRequest("http://localhost/api/connections", {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}

describe("sessionCookie", () => {
  it("is httpOnly, so script on the page cannot read the session", () => {
    expect(sessionCookie("token-value").httpOnly).toBe(true);
  });

  it("is sameSite lax, so a cross-site form post cannot ride it", () => {
    expect(sessionCookie("token-value").sameSite).toBe("lax");
  });

  it("carries the token as the cookie value under the fixed name", () => {
    const cookie = sessionCookie("token-value");
    expect(cookie.name).toBe(SESSION_COOKIE);
    expect(cookie.value).toBe("token-value");
  });

  it("is scoped to the whole app with path /", () => {
    expect(sessionCookie("token-value").path).toBe("/");
  });

  it("expires at 12 hours, matching the engine's absolute session lifetime", () => {
    // A browser cookie that outlives the engine's own session record would
    // keep being sent long after the engine has forgotten it - harmless (the
    // engine still 401s it) but it is the kind of drift that should be an
    // explicit constant, not an accident of copy-paste.
    expect(sessionCookie("token-value").maxAge).toBe(12 * 60 * 60);
  });

  it("is secure only in production, since localhost has no TLS", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookie("token-value").secure).toBe(true);

    vi.stubEnv("NODE_ENV", "development");
    expect(sessionCookie("token-value").secure).toBe(false);

    vi.stubEnv("NODE_ENV", "test");
    expect(sessionCookie("token-value").secure).toBe(false);
  });
});

describe("clearedCookie", () => {
  it("keeps the same name and path as sessionCookie", () => {
    // A mismatch here is silent and dangerous: a browser only overwrites a
    // cookie set with matching name+path+domain, so a clear that drifts from
    // how the cookie was set leaves the original token sitting in the jar.
    const set = sessionCookie("token-value");
    const cleared = clearedCookie();
    expect(cleared.name).toBe(set.name);
    expect(cleared.path).toBe(set.path);
  });

  it("carries the same httpOnly and sameSite attributes as the live cookie", () => {
    const set = sessionCookie("token-value");
    const cleared = clearedCookie();
    expect(cleared.httpOnly).toBe(set.httpOnly);
    expect(cleared.sameSite).toBe(set.sameSite);
  });

  it("is empty and immediately expired", () => {
    const cleared = clearedCookie();
    expect(cleared.value).toBe("");
    expect(cleared.maxAge).toBe(0);
  });
});

describe("readSession", () => {
  it("returns null when the cookie is absent", () => {
    expect(readSession(requestWithCookie())).toBeNull();
  });

  it("returns the token when the cookie is present", () => {
    const request = requestWithCookie(`${SESSION_COOKIE}=abc123`);
    expect(readSession(request)).toBe("abc123");
  });

  it("ignores unrelated cookies", () => {
    const request = requestWithCookie("other_cookie=xyz");
    expect(readSession(request)).toBeNull();
  });
});
