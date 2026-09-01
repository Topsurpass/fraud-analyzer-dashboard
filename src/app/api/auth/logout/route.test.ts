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

function logoutRequest(opts: { token?: string; csrf?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (opts.csrf) headers["x-switchboard-request"] = "1";
  const request = new NextRequest("http://localhost/api/auth/logout", {
    method: "POST",
    headers,
  });
  if (opts.token) request.cookies.set(SESSION_COOKIE, opts.token);
  return request;
}

describe("POST /api/auth/logout", () => {
  it("refuses without the CSRF header and leaves the cookie untouched", async () => {
    const response = await POST(logoutRequest({ token: "tok-1" }));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    // Refusing must not itself sign the caller out - a cross-site form that
    // triggers this refusal should leave a legitimate session exactly as it
    // was.
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("clears the cookie when the engine confirms the logout", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const response = await POST(logoutRequest({ token: "tok-1", csrf: true }));

    expect(response.status).toBe(200);
    const cleared = response.cookies.get(SESSION_COOKIE);
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge).toBe(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://engine.test/auth/logout");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
  });

  it("clears the cookie even when the engine is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const response = await POST(logoutRequest({ token: "tok-1", csrf: true }));

    // Signing out of this browser must not depend on the engine answering -
    // that is the entire reason this handler exists rather than proxying
    // logout through the catch-all.
    expect(response.status).toBe(200);
    const cleared = response.cookies.get(SESSION_COOKIE);
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge).toBe(0);
  });

  it("clears the cookie even when there was no cookie to begin with, without calling the engine", async () => {
    const response = await POST(logoutRequest({ csrf: true }));

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    const cleared = response.cookies.get(SESSION_COOKIE);
    expect(cleared?.value).toBe("");
  });
});
