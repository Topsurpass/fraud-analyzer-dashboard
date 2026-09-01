import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/session";
import { DELETE, GET, POST, PUT } from "./[...path]/route";

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

/** A request as the browser would send it: same-origin, optionally cookied. */
function makeRequest(
  path: string,
  init: { method?: string; token?: string; csrf?: boolean; body?: string; search?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (init.csrf) headers["x-switchboard-request"] = "1";
  if (init.body !== undefined) headers["content-type"] = "application/json";

  const request = new NextRequest(`http://localhost/api/${path}${init.search ?? ""}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });

  if (init.token) {
    request.cookies.set(SESSION_COOKIE, init.token);
  }

  return request;
}

function context(path: string): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path: path.split("/") }) };
}

function engineJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("catch-all proxy: unauthenticated", () => {
  it("returns 401 without calling the engine when there is no cookie", async () => {
    const response = await GET(makeRequest("connections"), context("connections"));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error_code).toBe("NOT_AUTHENTICATED");
    // The whole point of answering here: an unauthenticated caller must cost
    // nothing downstream. If the engine mock had been hit this assertion
    // catches it.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("catch-all proxy: CSRF header", () => {
  it("refuses a POST with 403 when the header is missing", async () => {
    const request = makeRequest("connections", { method: "POST", token: "tok-1" });
    const response = await POST(request, context("connections"));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error_code).toBe("FORBIDDEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a PUT and a DELETE with 403 when the header is missing", async () => {
    const put = await PUT(makeRequest("connections/c1", { method: "PUT", token: "tok-1" }), context("connections/c1"));
    expect(put.status).toBe(403);

    const del = await DELETE(
      makeRequest("connections/c1", { method: "DELETE", token: "tok-1" }),
      context("connections/c1"),
    );
    expect(del.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets a POST through when the header is present", async () => {
    fetchMock.mockResolvedValue(engineJson({ id: "c1" }, 201));
    const request = makeRequest("connections", { method: "POST", token: "tok-1", csrf: true, body: "{}" });
    const response = await POST(request, context("connections"));

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not require the header on a GET", async () => {
    fetchMock.mockResolvedValue(engineJson([]));
    const response = await GET(makeRequest("connections", { token: "tok-1" }), context("connections"));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("catch-all proxy: request shape sent upstream", () => {
  it("attaches the cookie's token as a bearer header", async () => {
    fetchMock.mockResolvedValue(engineJson([]));
    await GET(makeRequest("connections", { token: "secret-token-abc" }), context("connections"));

    const [, init] = fetchMock.mock.calls[0];
    const sentHeaders = init.headers as Headers;
    expect(sentHeaders.get("authorization")).toBe("Bearer secret-token-abc");
  });

  it("builds the upstream URL from ENGINE_BASE_URL and the path segments", async () => {
    fetchMock.mockResolvedValue(engineJson([]));
    await GET(
      makeRequest("connections/c1/tables", { token: "tok-1" }),
      context("connections/c1/tables"),
    );

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://engine.test/connections/c1/tables");
  });

  it("forwards query parameters", async () => {
    fetchMock.mockResolvedValue(engineJson({}));
    await GET(
      makeRequest("queries/q1/poll", { token: "tok-1", search: "?since_hash=abc" }),
      context("queries/q1/poll"),
    );

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://engine.test/queries/q1/poll?since_hash=abc");
  });

  it("forwards the request body on a mutating call", async () => {
    fetchMock.mockResolvedValue(engineJson({ ok: true }));
    const request = makeRequest("connections", {
      method: "POST",
      token: "tok-1",
      csrf: true,
      body: JSON.stringify({ name: "Payments DB" }),
    });
    await POST(request, context("connections"));

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe('{"name":"Payments DB"}');
  });

  it("sends no body on a GET", async () => {
    fetchMock.mockResolvedValue(engineJson([]));
    await GET(makeRequest("connections", { token: "tok-1" }), context("connections"));

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
  });
});

describe("catch-all proxy: response passthrough", () => {
  it("passes the engine's status and body through unchanged on success", async () => {
    fetchMock.mockResolvedValue(engineJson({ id: "c1", name: "Payments DB" }, 201));
    const response = await GET(makeRequest("connections/c1", { token: "tok-1" }), context("connections/c1"));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "c1", name: "Payments DB" });
  });

  it("passes the engine's error envelope through unchanged", async () => {
    fetchMock.mockResolvedValue(
      engineJson({ error_code: "NOT_FOUND", message: "No such connection.", detail: null }, 404),
    );
    const response = await GET(makeRequest("connections/missing", { token: "tok-1" }), context("connections/missing"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error_code: "NOT_FOUND",
      message: "No such connection.",
      detail: null,
    });
  });

  it("marks every proxied response no-store", async () => {
    fetchMock.mockResolvedValue(engineJson([]));
    const response = await GET(makeRequest("connections", { token: "tok-1" }), context("connections"));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("catch-all proxy: dead session cleanup", () => {
  it("clears the cookie when the engine answers 401", async () => {
    fetchMock.mockResolvedValue(
      engineJson({ error_code: "NOT_AUTHENTICATED", message: "Session expired.", detail: null }, 401),
    );
    const response = await GET(makeRequest("connections", { token: "stale-token" }), context("connections"));

    expect(response.status).toBe(401);
    const setCookie = response.cookies.get(SESSION_COOKIE);
    expect(setCookie?.value).toBe("");
    // A clear that lands with a different maxAge/path than the live cookie
    // was set with leaves the original cookie in place in a real browser.
    expect(setCookie?.maxAge).toBe(0);
    expect(setCookie?.path).toBe("/");
  });

  it("leaves the cookie alone when the engine answers with any other status", async () => {
    fetchMock.mockResolvedValue(engineJson({ error_code: "NOT_FOUND", message: "x", detail: null }, 404));
    const response = await GET(makeRequest("connections", { token: "tok-1" }), context("connections"));

    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
});

describe("catch-all proxy: the token never reaches the browser", () => {
  it("never appears in the response body", async () => {
    fetchMock.mockResolvedValue(engineJson({ id: "c1", name: "Payments DB" }, 200));
    const response = await GET(makeRequest("connections/c1", { token: "top-secret-token" }), context("connections/c1"));

    const text = await response.text();
    expect(text).not.toContain("top-secret-token");
  });

  it("never appears in a response header", async () => {
    fetchMock.mockResolvedValue(engineJson({ id: "c1" }, 200));
    const response = await GET(makeRequest("connections/c1", { token: "top-secret-token" }), context("connections/c1"));

    for (const value of response.headers.values()) {
      expect(value).not.toContain("top-secret-token");
    }
    // Including the Set-Cookie the browser will actually receive: only the
    // 401 path sets one, and even that one is the cleared cookie, not this
    // token.
    expect(response.cookies.getAll().every((c) => c.value !== "top-secret-token")).toBe(true);
  });

  it("never copies the outbound authorization header onto the response", async () => {
    // The bearer header is built for the upstream fetch call only. Proving it
    // never lands on the object handed back to the browser rules out the
    // easiest way this property could regress: a future edit that spreads
    // the upstream request headers onto the response instead of the fixed
    // content-type/cache-control pair this handler sets today.
    fetchMock.mockResolvedValue(engineJson({ id: "c1" }, 200));
    const response = await GET(makeRequest("connections/c1", { token: "top-secret-token" }), context("connections/c1"));

    expect(response.headers.get("authorization")).toBeNull();
    expect([...response.headers.keys()].sort()).toEqual(["cache-control", "content-type"]);
  });
});
