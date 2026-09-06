import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

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

describe("GET /readyz", () => {
	it("is ready when the engine answers its health probe", async () => {
		fetchMock.mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));

		const response = await GET();

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ status: "ready" });
	});

	it("asks the engine for /health, not /ready", async () => {
		// /ready folds in the engine's own database, which has a separate
		// answer and a separate fix. This route is asking one question: can
		// this container reach that one.
		fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

		await GET();

		expect(fetchMock).toHaveBeenCalledWith(
			`${ENGINE}/health`,
			expect.objectContaining({ cache: "no-store" }),
		);
	});

	it("names an unset ENGINE_BASE_URL rather than failing to fetch undefined", async () => {
		vi.stubEnv("ENGINE_BASE_URL", "");

		const response = await GET();

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			status: "not_ready",
			reason: expect.stringContaining("ENGINE_BASE_URL"),
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("reports not ready when the engine refuses the connection", async () => {
		fetchMock.mockRejectedValue(
			Object.assign(new Error("connect ECONNREFUSED"), { name: "TypeError" }),
		);

		const response = await GET();

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({ status: "not_ready" });
	});

	it("reports not ready when the engine answers an error status", async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 502 }));

		const response = await GET();

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			reason: expect.stringContaining("502"),
		});
	});

	it("never puts the engine address in the response body", async () => {
		// ENGINE_BASE_URL is a private address, and keeping it off the public
		// internet is the point of the proxy this dashboard is built around.
		// An error path that echoes it back undoes that for the cost of one
		// curl against an unauthenticated endpoint.
		fetchMock.mockRejectedValue(new Error(`getaddrinfo ENOTFOUND ${ENGINE}`));

		const body = await (await GET()).text();

		expect(body).not.toContain("engine.test");
	});

	it("bounds the wait so a hung engine does not hang this route too", async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

		await GET();

		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it("is not cacheable", async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

		expect((await GET()).headers.get("cache-control")).toBe("no-store");
	});
});
