import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `output: "standalone"` must be on for Docker and off for Vercel.
 *
 * Regression. The setting was unconditional, which broke every Vercel build at
 * the packaging step:
 *
 *     ENOENT: no such file or directory,
 *     open '/vercel/path0/.next/next-server.js.nft.json'
 *
 * Vercel traces files itself and reads those traces from `.next/`; standalone
 * relocates them under `.next/standalone/`. The build succeeds and the deploy
 * then fails on a path that is no longer there - and it fails only on Vercel,
 * because locally the file is produced, just somewhere else. That is the kind
 * of difference a local test run will never show you, so it is pinned here.
 *
 * Both directions matter and neither is obvious from reading the config once:
 * turning it off everywhere would break the production image at
 * `COPY .next/standalone`, and turning it on everywhere is the bug above.
 *
 * The config reads `process.env` at module load, so each case needs
 * `resetModules()` and a fresh dynamic import - a top-level import would be
 * evaluated once, under whichever environment happened to be set first.
 */

async function loadConfig() {
	vi.resetModules();
	return (await import("../next.config")).default;
}

beforeEach(() => {
	vi.unstubAllEnvs();
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("next.config output mode", () => {
	it("emits a standalone bundle when VERCEL is not set", async () => {
		// The Docker build. Its Dockerfile copies `.next/standalone`, so this
		// being wrong fails the image build rather than anything subtle.
		vi.stubEnv("VERCEL", "");

		expect((await loadConfig()).output).toBe("standalone");
	});

	it("leaves output unset on Vercel, so Vercel's own tracing is used", async () => {
		vi.stubEnv("VERCEL", "1");

		expect((await loadConfig()).output).toBeUndefined();
	});

	it("keys off VERCEL specifically, not any CI environment", async () => {
		// Being in CI is not the question. A GitHub Actions job that builds the
		// production image needs standalone exactly as a laptop does; only
		// Vercel's own builder must not have it.
		vi.stubEnv("CI", "true");
		vi.stubEnv("VERCEL", "");

		expect((await loadConfig()).output).toBe("standalone");
	});
});

describe("next.config production hardening", () => {
	it("does not advertise the framework in a response header", async () => {
		expect((await loadConfig()).poweredByHeader).toBe(false);
	});

	it("leaves compression to the reverse proxy", async () => {
		// Caddy does it once, in Go, and offers zstd. See the note in
		// next.config.ts - if this app is ever run without a compressing proxy
		// in front of it, this has to flip back to true.
		expect((await loadConfig()).compress).toBe(false);
	});
});
