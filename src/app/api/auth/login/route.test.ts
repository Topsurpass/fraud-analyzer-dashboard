import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/session";
import { POST } from "./route";

const ENGINE = "http://engine.test";
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ENGINE_BASE_URL", ENGINE);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function loginRequest(body: unknown) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function engineJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/auth/login", () => {
  it("sets the httpOnly session cookie on success", async () => {
    fetchMock.mockResolvedValue(
      engineJson({ token: "the-real-token", user: { id: "u1", email: "a@b.com" } }),
    );
    const response = await POST(loginRequest({ email: "a@b.com", password: "x" }));

    const cookie = response.cookies.get(SESSION_COOKIE);
    expect(cookie?.value).toBe("the-real-token");
    // NextResponse's cookie helper does not surface httpOnly on the read
    // side of `.get`, so the property that matters operationally is proven
    // via the literal Set-Cookie header instead.
    const setCookieHeader = response.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toMatch(/HttpOnly/i);
    expect(setCookieHeader).toMatch(/SameSite=Lax/i);
  });

  it("returns only the user object, never the token", async () => {
    fetchMock.mockResolvedValue(
      engineJson({ token: "the-real-token", user: { id: "u1", email: "a@b.com" } }),
    );
    const response = await POST(loginRequest({ email: "a@b.com", password: "x" }));

    const body = await response.json();
    expect(body).toEqual({ id: "u1", email: "a@b.com" });
    expect(JSON.stringify(body)).not.toContain("the-real-token");
  });

  it("never puts the token in any response header", async () => {
    fetchMock.mockResolvedValue(
      engineJson({ token: "the-real-token", user: { id: "u1", email: "a@b.com" } }),
    );
    const response = await POST(loginRequest({ email: "a@b.com", password: "x" }));

    for (const [name, value] of response.headers.entries()) {
      // set-cookie is meant to carry it - that is the httpOnly cookie itself.
      // x-middleware-set-cookie is Next's own internal bookkeeping header for
      // chaining response cookies between middleware and route handlers; the
      // framework strips it before anything reaches an actual browser, so it
      // is not a leak, just an implementation detail visible when a route
      // handler is invoked directly in a test rather than through the server.
      if (name.toLowerCase() === "set-cookie" || name.toLowerCase() === "x-middleware-set-cookie") {
        continue;
      }
      expect(value).not.toContain("the-real-token");
    }
  });

  it("forwards the engine's status and body unchanged on failure", async () => {
    fetchMock.mockResolvedValue(
      engineJson({ error_code: "INVALID_CREDENTIALS", message: "Incorrect email or password.", detail: null }, 401),
    );
    const response = await POST(loginRequest({ email: "a@b.com", password: "wrong" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error_code: "INVALID_CREDENTIALS",
      message: "Incorrect email or password.",
      detail: null,
    });
    // A failed login must not set a session cookie.
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("forwards a lockout response unchanged, distinct from a bad password", async () => {
    fetchMock.mockResolvedValue(
      engineJson({ error_code: "LOCKED_OUT", message: "Try again in 8 minutes.", detail: null }, 423),
    );
    const response = await POST(loginRequest({ email: "a@b.com", password: "wrong" }));

    expect(response.status).toBe(423);
    const body = await response.json();
    expect(body.message).toBe("Try again in 8 minutes.");
  });

  it("answers 502 rather than setting an empty cookie when the upstream body has no token", async () => {
    fetchMock.mockResolvedValue(engineJson({ user: { id: "u1" } }, 200));
    const response = await POST(loginRequest({ email: "a@b.com", password: "x" }));

    expect(response.status).toBe(502);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
});
