import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors";
import {
  createConnection,
  listLogs,
  listQueries,
  pollQuery,
  request,
  resolveBaseUrl,
} from "./client";

const BASE = "http://engine.test";
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Await a request that must fail, and hand back a typed ApiError. */
async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof ApiError) return caught;
    throw caught;
  }
  throw new Error("expected the request to reject, but it resolved");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("resolveBaseUrl", () => {
  it("strips trailing slashes so paths never double up", () => {
    expect(resolveBaseUrl("http://engine.test/")).toBe("http://engine.test");
    expect(resolveBaseUrl("http://engine.test///")).toBe("http://engine.test");
  });

  it("defaults to the BFF proxy rather than throwing", () => {
    // Since Task 3, the browser talks to Next.js's own /api/* proxy, not the
    // engine directly - a relative default is the normal configuration now,
    // not a misconfiguration worth failing loudly over. See src/lib/session.ts
    // and src/app/api/[...path]/route.ts for the other half of this.
    expect(resolveBaseUrl("")).toBe("/api");
    expect(resolveBaseUrl(undefined)).toBe("/api");
  });

  it("falls back to the environment variable", () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://from-env.test");
    expect(resolveBaseUrl()).toBe("http://from-env.test");
    vi.unstubAllEnvs();
  });
});

describe("buildUrl", () => {
  it("resolves the relative default against window.location.origin", async () => {
    /*
     * This is the path a real browser actually takes: nothing outside tests
     * and the mock runner passes `baseUrl`, so `resolveBaseUrl` returns the
     * relative "/api" and the URL constructor needs an origin to resolve that
     * against - `window.location.origin` supplies it. Every other test in
     * this file passes an absolute `baseUrl`, which sidesteps that branch of
     * `buildUrl` entirely. That gap is exactly how this broke before: reverting
     * `buildUrl` to its pre-proxy form (`new URL(input.path, base)`, with
     * `base` as the origin argument instead of folded into the path) leaves
     * every one of those 21 tests green while a real browser call throws
     * `Invalid URL`, because a relative string is not a valid second argument
     * to `URL()` there. Calling `request()` with no `baseUrl` at all, the way
     * every real caller does, is what catches it.
     */
    fetchMock.mockResolvedValue(jsonResponse([]));

    await request({ method: "GET", path: "/connections" });

    expect(fetchMock.mock.calls[0][0]).toBe(`${window.location.origin}/api/connections`);
  });
});

describe("request", () => {
  it("sends no content-type on a bodyless request", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await request({ method: "GET", path: "/connections", baseUrl: BASE });

    const init = fetchMock.mock.calls[0][1];
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(init.cache).toBe("no-store");
  });

  it("serialises a JSON body with the right header", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }, 201));
    await request({
      method: "POST",
      path: "/connections",
      body: { name: "Payments DB" },
      baseUrl: BASE,
    });

    const init = fetchMock.mock.calls[0][1];
    // Also carries the CSRF header the BFF proxy requires on every mutating
    // request - see the "CSRF header" describe block below for the dedicated
    // coverage of that behaviour across methods.
    expect(init.headers).toEqual({
      "content-type": "application/json",
      "x-switchboard-request": "1",
    });
    expect(init.body).toBe('{"name":"Payments DB"}');
  });

  describe("CSRF header", () => {
    it("attaches it to every mutating method, and only mutating methods", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));

      await request({ method: "GET", path: "/connections", baseUrl: BASE });
      expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();

      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        fetchMock.mockClear();
        fetchMock.mockResolvedValue(jsonResponse({}));
        await request({ method, path: "/connections/c1", baseUrl: BASE });
        const init = fetchMock.mock.calls[0][1];
        expect(init.headers["x-switchboard-request"]).toBe("1");
      }
    });
  });

  it("drops null and undefined query params instead of sending 'null'", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await request({
      method: "GET",
      path: "/queries/q1/poll",
      query: { since_hash: null, force: undefined, limit: 20 },
      baseUrl: BASE,
    });

    expect(fetchMock.mock.calls[0][0]).toBe("http://engine.test/queries/q1/poll?limit=20");
  });

  it("percent-encodes path segments", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await listQueries("a b/c", { baseUrl: BASE });
    expect(fetchMock.mock.calls[0][0]).toBe("http://engine.test/connections/a%20b%2Fc/queries");
  });

  it("returns undefined for a 204 rather than trying to parse it", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      request({ method: "DELETE", path: "/queries/q1", baseUrl: BASE }),
    ).resolves.toBeUndefined();
  });

  describe("error normalization", () => {
    it("uses the engine's own error envelope", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          { error_code: "INTERNAL_ERROR", message: "An unexpected internal error occurred." },
          500,
        ),
      );

      const error = await failure(request({ method: "GET", path: "/connections", baseUrl: BASE }));

      expect(error).toBeInstanceOf(ApiError);
      expect(error.kind).toBe("http");
      expect(error.status).toBe(500);
      expect(error.errorCode).toBe("INTERNAL_ERROR");
      expect(error.message).toBe("An unexpected internal error occurred.");
      expect(error.retryable).toBe(true);
    });

    it("flattens a FastAPI validation error into one readable line", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          {
            detail: [
              { loc: ["body", "name"], msg: "Field required", type: "missing" },
              { loc: ["body", "sql_text"], msg: "Field required", type: "missing" },
            ],
          },
          422,
        ),
      );

      const error = await failure(request({
        method: "POST",
        path: "/connections",
        body: {},
        baseUrl: BASE,
      }));

      expect(error.message).toBe("name: Field required; sql_text: Field required");
      expect(error.retryable).toBe(false);
    });

    it("treats a non-JSON error body as text rather than crashing", async () => {
      fetchMock.mockResolvedValue(
        new Response("<html>502 Bad Gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
      );

      const error = await failure(request({ method: "GET", path: "/health", baseUrl: BASE }));
      expect(error.message).toContain("502 Bad Gateway");
      expect(error.status).toBe(502);
    });

    it("classifies a transport failure as network, not http", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      const error = await failure(request({ method: "GET", path: "/health", baseUrl: BASE }));

      expect(error.kind).toBe("network");
      expect(error.status).toBeNull();
      expect(error.displayMessage).toBe("Cannot reach engine");
      expect(error.retryable).toBe(true);
    });

    it("reports a 404 as not retryable", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: "Not found" }, 404));
      const error = await failure(request({ method: "GET", path: "/queries/x", baseUrl: BASE }));
      expect(error.retryable).toBe(false);
    });
  });

  describe("deadlines", () => {
    it("aborts and reports a timeout when the engine stops answering", async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );

      const pending = failure(
        request({ method: "GET", path: "/health", baseUrl: BASE, timeoutMs: 100 }),
      );

      await vi.advanceTimersByTimeAsync(101);
      const error = await pending;

      expect(error.kind).toBe("timeout");
      expect(error.displayMessage).toBe("Request timed out");
      vi.useRealTimers();
    });

    it("reports a caller-cancelled request as aborted, not as a failure", async () => {
      const controller = new AbortController();
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );

      const pending = failure(
        request({ method: "GET", path: "/health", baseUrl: BASE, signal: controller.signal }),
      );

      controller.abort();
      const error = await pending;

      expect(error.kind).toBe("aborted");
      expect(error.retryable).toBe(false);
    });

    it("never issues the request when the signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );

      const error = await failure(request({
        method: "GET",
        path: "/health",
        baseUrl: BASE,
        signal: controller.signal,
      }));

      expect(error.kind).toBe("aborted");
    });
  });
});

describe("endpoint helpers", () => {
  it("builds the poll URL the engine documents", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ query_id: "q1", changed: false }));
    await pollQuery("q1", { sinceHash: "sha256:abc" }, { baseUrl: BASE });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://engine.test/queries/q1/poll?since_hash=sha256%3Aabc",
    );
  });

  it("sends force only when asked", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await pollQuery("q1", { force: true }, { baseUrl: BASE });
    expect(fetchMock.mock.calls[0][0]).toBe("http://engine.test/queries/q1/poll?force=true");
  });

  it("defaults the log limit to the engine's own default", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await listLogs("q1", undefined, { baseUrl: BASE });
    expect(fetchMock.mock.calls[0][0]).toBe("http://engine.test/queries/q1/logs?limit=20");
  });

  it("posts a connection to the right path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ connection: {}, test_ok: true }, 201));
    await createConnection({ name: "Payments DB", db_type: "sqlite" }, { baseUrl: BASE });
    expect(fetchMock.mock.calls[0][0]).toBe("http://engine.test/connections");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });
});
