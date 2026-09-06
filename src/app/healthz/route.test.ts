import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("GET /healthz", () => {
	it("answers ok", async () => {
		const response = GET();

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ status: "ok" });
	});

	it("answers ok with no ENGINE_BASE_URL set at all", async () => {
		// This is the property the container healthcheck depends on. Liveness
		// must not fail on a configuration problem downstream, or Docker
		// restarts a process that is running perfectly well and the restart
		// loop hides the actual fault.
		vi.stubEnv("ENGINE_BASE_URL", "");

		expect(GET().status).toBe(200);
	});

	it("never reaches out to the engine", async () => {
		GET();

		// A liveness probe that makes a network call is a liveness probe that
		// fails when the network does.
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("is not cacheable, so a proxy cannot answer for a dead process", async () => {
		expect(GET().headers.get("cache-control")).toBe("no-store");
	});
});
