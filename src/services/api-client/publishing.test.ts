import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	approvePublishRequest,
	cancelPublishRequest,
	getChartDefinition,
	listPublishRequests,
	publishChart,
	rejectPublishRequest,
} from "./client";

/**
 * The URLs and verbs here are the engine's contract (docs/shared-publishing.md).
 * A typo in one is a button that 404s in production and passes every component
 * test that mocks the client, so each is pinned against the wire.
 */

const BASE = "http://engine.test";
const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	// A fresh Response per call: a body can only be read once.
	fetchMock.mockImplementation(async () =>
		new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
	);
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function lastCall() {
	const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
	return { url: String(url), method: init?.method as string, body: init?.body as string | undefined };
}

describe("publishing endpoints", () => {
	it("publishes with POST /queries/charts/{id}/publish", async () => {
		await publishChart("c 1", { baseUrl: BASE });
		expect(lastCall()).toMatchObject({ url: `${BASE}/queries/charts/c%201/publish`, method: "POST" });
	});

	it("withdraws with POST .../publish/cancel", async () => {
		await cancelPublishRequest("c1", { baseUrl: BASE });
		expect(lastCall()).toMatchObject({ url: `${BASE}/queries/charts/c1/publish/cancel`, method: "POST" });
	});

	it("lists requests with GET /queries/charts/publish-requests", async () => {
		await listPublishRequests({ baseUrl: BASE });
		expect(lastCall()).toMatchObject({ url: `${BASE}/queries/charts/publish-requests`, method: "GET" });
	});

	it("approves with POST .../publish/approve", async () => {
		await approvePublishRequest("c1", { baseUrl: BASE });
		expect(lastCall()).toMatchObject({ url: `${BASE}/queries/charts/c1/publish/approve`, method: "POST" });
	});

	it("rejects with a trimmed reason", async () => {
		await rejectPublishRequest("c1", "  Too broad  ", { baseUrl: BASE });
		const call = lastCall();
		expect(call).toMatchObject({ url: `${BASE}/queries/charts/c1/publish/reject`, method: "POST" });
		expect(JSON.parse(call.body ?? "{}")).toEqual({ reason: "Too broad" });
	});

	it("sends a null reason when none, or only spaces, was given", async () => {
		await rejectPublishRequest("c1", "   ", { baseUrl: BASE });
		expect(JSON.parse(lastCall().body ?? "{}")).toEqual({ reason: null });
		await rejectPublishRequest("c1", null, { baseUrl: BASE });
		expect(JSON.parse(lastCall().body ?? "{}")).toEqual({ reason: null });
	});

	it("reads a definition with GET .../definition and no body", async () => {
		await getChartDefinition("c1", { baseUrl: BASE });
		expect(lastCall()).toMatchObject({ url: `${BASE}/queries/charts/c1/definition`, method: "GET" });
		expect(lastCall().body).toBeUndefined();
	});
});
