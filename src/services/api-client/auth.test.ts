import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getToken, resetTokenForTests, setToken } from "@/services/auth/token";
import { ApiError } from "./errors";
import {
	batchPoll,
	createUser,
	listAuditLog,
	listQueriesByIds,
	listUsers,
	login,
	me,
	resetUserPassword,
	updateUser,
} from "./client";

const BASE = "http://engine.test";
const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
	window.localStorage.clear();
	resetTokenForTests();
});

afterEach(() => {
	vi.unstubAllGlobals();
	resetTokenForTests();
});

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

/** The headers the last fetch went out with, lowercased. */
function sentHeaders(): Record<string, string> {
	const [, init] = fetchMock.mock.calls.at(-1) ?? [];
	const raw = (init?.headers ?? {}) as Record<string, string>;
	return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key.toLowerCase(), value]));
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
	try {
		await promise;
	} catch (caught) {
		if (caught instanceof ApiError) return caught;
		throw caught;
	}
	throw new Error("expected the request to reject, but it resolved");
}

describe("the bearer token", () => {
	it("rides on every request once a session exists", async () => {
		setToken("session-abc");
		fetchMock.mockResolvedValue(jsonResponse([]));

		await listUsers({ baseUrl: BASE });

		expect(sentHeaders().authorization).toBe("Bearer session-abc");
	});

	it("is absent when nobody is signed in", async () => {
		fetchMock.mockResolvedValue(jsonResponse([]));

		await listUsers({ baseUrl: BASE });

		expect(sentHeaders().authorization).toBeUndefined();
	});

	it("never travels with a login", async () => {
		/*
		 * A stale token on /auth/login would be resolved by the engine, and the
		 * response would describe a session the caller is in the middle of
		 * replacing. The header is left off structurally rather than by
		 * remembering to clear the token first.
		 */
		setToken("stale-token");
		fetchMock.mockResolvedValue(
			jsonResponse({ token: "fresh", user: { id: "u1", email: "a@b.test" } }),
		);

		await login({ email: "a@b.test", password: "x" }, { baseUrl: BASE });

		expect(sentHeaders().authorization).toBeUndefined();
	});

	it("does not store the token itself - the provider owns that", async () => {
		// Otherwise a caller could half-sign-in by calling the endpoint and
		// forgetting everything else the provider does.
		fetchMock.mockResolvedValue(jsonResponse({ token: "fresh", user: {} }));

		await login({ email: "a@b.test", password: "x" }, { baseUrl: BASE });

		expect(getToken()).toBeNull();
	});
});

describe("a session the engine no longer recognises", () => {
	it("is dropped when the engine says NOT_AUTHENTICATED", async () => {
		setToken("expired");
		fetchMock.mockResolvedValue(
			jsonResponse(
				{ error_code: "NOT_AUTHENTICATED", message: "Sign in to continue." },
				401,
			),
		);

		const error = await failure(listUsers({ baseUrl: BASE }));

		expect(error.status).toBe(401);
		expect(getToken()).toBeNull();
	});

	it("is dropped on a bare 401 with no body", async () => {
		// A proxy or gateway answering instead of the engine. There is no
		// envelope to read a code out of, so the status is all there is to go on.
		setToken("expired");
		fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

		await failure(me({ baseUrl: BASE }));

		expect(getToken()).toBeNull();
	});

	it("is kept when a login is simply refused", async () => {
		/*
		 * `/auth/login` answers a wrong password with 401 INVALID_CREDENTIALS.
		 * Treating that as an expiry would sign out a second tab because
		 * somebody mistyped a password in this one.
		 */
		setToken("still-good");
		fetchMock.mockResolvedValue(
			jsonResponse(
				{ error_code: "INVALID_CREDENTIALS", message: "Email or password is wrong." },
				401,
			),
		);

		const error = await failure(login({ email: "a@b.test", password: "no" }, { baseUrl: BASE }));

		expect(error.errorCode).toBe("INVALID_CREDENTIALS");
		expect(getToken()).toBe("still-good");
	});

	it("is kept on a 403, which means signed in and still not allowed", async () => {
		setToken("analyst-token");
		fetchMock.mockResolvedValue(
			jsonResponse(
				{ error_code: "FORBIDDEN", message: "This needs an administrator account." },
				403,
			),
		);

		const error = await failure(listAuditLog({ baseUrl: BASE }));

		expect(error.status).toBe(403);
		expect(getToken()).toBe("analyst-token");
	});
});

describe("the admin endpoints", () => {
	it("updates a user with PATCH, not PUT", async () => {
		// The engine's route is a PATCH and treats an omitted field as "leave it
		// alone". Sending PUT would 405; sending every field would clear the one
		// the caller did not mean to touch.
		fetchMock.mockResolvedValue(jsonResponse({ id: "u1" }));

		await updateUser("u1", { is_active: false }, { baseUrl: BASE });

		const [url, init] = fetchMock.mock.calls[0];
		expect(init.method).toBe("PATCH");
		expect(url).toBe("http://engine.test/users/u1");
		expect(JSON.parse(init.body)).toEqual({ is_active: false });
	});

	it("escapes an id rather than pasting it into the path", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ temporary_password: "x" }));

		await resetUserPassword("a/b?c", { baseUrl: BASE });

		expect(fetchMock.mock.calls[0][0]).toBe("http://engine.test/users/a%2Fb%3Fc/reset-password");
	});

	it("sends no password field when creating an account", async () => {
		/*
		 * The engine's UserCreate schema has nowhere to put one, so the password
		 * is always generated. An admin who could choose it would be an admin who
		 * knows a colleague's password.
		 */
		fetchMock.mockResolvedValue(jsonResponse({ user: {}, temporary_password: "x" }, 201));

		await createUser(
			{ email: "ada@example.com", full_name: "Ada", role: "analyst" },
			{ baseUrl: BASE },
		);

		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
			email: "ada@example.com",
			full_name: "Ada",
			role: "analyst",
		});
	});
});

describe("the bulk query endpoints", () => {
	it("asks for saved queries by id as one comma-separated parameter", async () => {
		fetchMock.mockResolvedValue(jsonResponse([]));

		await listQueriesByIds(["q1", "q2", "q3"], { baseUrl: BASE });

		expect(fetchMock.mock.calls[0][0]).toBe("http://engine.test/queries?ids=q1%2Cq2%2Cq3");
	});

	it("omits the parameter entirely to mean every visible query", async () => {
		// `ids=` empty would ask for the query whose id is the empty string.
		fetchMock.mockResolvedValue(jsonResponse([]));

		await listQueriesByIds(undefined, { baseUrl: BASE });

		expect(fetchMock.mock.calls[0][0]).toBe("http://engine.test/queries");
	});

	it("posts a batch poll in the shape the engine declares", async () => {
		// `queries` and `since_hash`, not `items` and `data_hash`: the single-query
		// poll uses a different vocabulary and this is the easy one to get wrong.
		fetchMock.mockResolvedValue(jsonResponse({ results: [] }));

		await batchPoll(
			{ queries: [{ query_id: "q1", since_hash: "sha256:abc" }, { query_id: "q2" }] },
			{ baseUrl: BASE },
		);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("http://engine.test/queries/poll");
		expect(JSON.parse(init.body)).toEqual({
			queries: [{ query_id: "q1", since_hash: "sha256:abc" }, { query_id: "q2" }],
		});
	});
});
