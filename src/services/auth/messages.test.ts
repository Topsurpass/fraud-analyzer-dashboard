import { describe, expect, it } from "vitest";
import { ApiError } from "@/services/api-client";
import { authErrorMessage, shouldClearPassword } from "./messages";

function http(over: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) {
	return new ApiError({ kind: "http", message: "", url: "", status: 400, ...over });
}

describe("authErrorMessage", () => {
	it("prefers the engine's own sentence, which knows the specifics", () => {
		// "Try again in 15 minutes" is a detail only the engine has. Rewriting
		// these here would produce two vocabularies for one system.
		expect(
			authErrorMessage(
				http({
					status: 429,
					errorCode: "ACCOUNT_LOCKED",
					message: "Too many failed attempts. Try again in 15 minutes.",
				}),
			),
		).toBe("Too many failed attempts. Try again in 15 minutes.");
	});

	it("passes a role refusal through word for word", () => {
		expect(
			authErrorMessage(
				http({ status: 403, errorCode: "FORBIDDEN", message: "This needs an administrator account." }),
			),
		).toBe("This needs an administrator account.");
	});

	it("names an unreachable engine rather than blaming the password", () => {
		const message = authErrorMessage(new ApiError({ kind: "network", message: "fetch failed", url: "" }));
		expect(message).toMatch(/Cannot reach the engine/);
		expect(message).not.toMatch(/fetch failed/);
	});

	it("names a timeout as a timeout", () => {
		expect(authErrorMessage(new ApiError({ kind: "timeout", message: "", url: "" }))).toMatch(
			/did not answer in time/,
		);
	});

	it("supplies its own line when the engine sent no envelope", () => {
		// A proxy or gateway answering instead of the engine. `messageFromBody`
		// falls back to "Engine returned HTTP 401", which is not a sentence to
		// put in front of somebody trying to sign in.
		expect(authErrorMessage(http({ status: 401, message: "Engine returned HTTP 401" }))).toBe(
			"That email and password do not match an account.",
		);
		expect(authErrorMessage(http({ status: 429, message: "Engine returned HTTP 429" }))).toMatch(
			/Too many attempts/,
		);
		expect(authErrorMessage(http({ status: 502, message: "Engine returned HTTP 502" }))).toMatch(
			/failed to answer/,
		);
	});

	it("copes with something that is not an ApiError at all", () => {
		expect(authErrorMessage(new Error("boom"))).toBe("boom");
		expect(authErrorMessage("a string")).toBe("Something went wrong. Try again.");
		expect(authErrorMessage(null)).toBe("Something went wrong. Try again.");
	});
});

describe("shouldClearPassword", () => {
	it("clears after a wrong password, because the next try is a different string", () => {
		expect(shouldClearPassword(http({ status: 401, errorCode: "INVALID_CREDENTIALS" }))).toBe(true);
	});

	it("keeps it for anything that was not about the password", () => {
		// Retyping a 16-character generated password to retry a network blip is
		// the sort of thing that makes people give up on a login screen.
		expect(shouldClearPassword(new ApiError({ kind: "network", message: "", url: "" }))).toBe(false);
		expect(shouldClearPassword(http({ status: 429, errorCode: "RATE_LIMITED" }))).toBe(false);
		expect(shouldClearPassword(http({ status: 503, errorCode: "SERVICE_NOT_READY" }))).toBe(false);
		expect(shouldClearPassword(new Error("boom"))).toBe(false);
	});
});
