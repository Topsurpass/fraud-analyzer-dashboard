import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /version", () => {
	it("names the commit, branch and environment Vercel built", async () => {
		vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "f4224c9aabbccddeeff00112233445566778899a");
		vi.stubEnv("VERCEL_GIT_COMMIT_REF", "master");
		vi.stubEnv("VERCEL_ENV", "production");
		await expect(GET().json()).resolves.toMatchObject({
			commit: "f4224c9",
			branch: "master",
			environment: "production",
		});
	});

	it("says null, not undefined, away from Vercel", async () => {
		vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
		const body = await GET().json();
		expect(body.branch === null || typeof body.branch === "string").toBe(true);
		expect(JSON.stringify(body)).not.toContain("undefined");
	});

	it("reports whether the engine and the override are set, never their values", async () => {
		vi.stubEnv("ENGINE_BASE_URL", "https://secret-engine.example.com");
		vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://secret-override.example.com");
		const response = GET();
		const text = JSON.stringify(await response.json());
		expect(text).toContain('"engineConfigured":true');
		expect(text).toContain('"apiBaseUrlOverrideSet":true');
		expect(text).not.toContain("secret-engine");
		expect(text).not.toContain("secret-override");
	});

	it("reports an unset engine as not configured", async () => {
		vi.stubEnv("ENGINE_BASE_URL", "  ");
		await expect(GET().json()).resolves.toMatchObject({ engineConfigured: false });
	});

	it("is not cacheable", () => {
		expect(GET().headers.get("cache-control")).toBe("no-store");
	});
});
