import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors";
import {
	batchPoll,
	createUser,
	listQueriesByIds,
	login,
	resetUserPassword,
	updateUser,
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

describe("login", () => {
	it("posts credentials and resolves the bare user the proxy returns", async () => {
		/*
		 * Since the BFF migration (src/app/api/auth/login/route.ts), the response
		 * body this function sees is the user object alone - the session lives in
		 * an httpOnly cookie set on that same response, never in JSON this code
		 * (or its caller, AuthContext) can read. This is the regression test for
		 * the shape that broke sign-in: the old contract, {token, user}, is not
		 * what a real request against the route returns.
		 */
		const account = { id: "u1", email: "a@b.test", full_name: "Ada Test", role: "analyst" };
		fetchMock.mockResolvedValue(jsonResponse(account));

		const result = await login({ email: "a@b.test", password: "x" }, { baseUrl: BASE });

		expect(result).toEqual(account);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("http://engine.test/auth/login");
		expect(init.method).toBe("POST");
	});

	it("sends no Authorization header - there is no token to attach any more", async () => {
		// A regression guard, not a live behaviour: nothing in `request()` reads
		// a token store any more, so this would only start failing if that
		// plumbing came back.
		fetchMock.mockResolvedValue(
			jsonResponse({ id: "u1", email: "a@b.test", full_name: "Ada Test", role: "analyst" }),
		);

		await login({ email: "a@b.test", password: "x" }, { baseUrl: BASE });

		expect(sentHeaders().authorization).toBeUndefined();
	});

	it("is kept out of retryable territory when the engine simply refuses it", async () => {
		// `/auth/login` answers a wrong password with 401 INVALID_CREDENTIALS.
		// Nothing local needs dropping over that any more than it did before -
		// there was never a token here to drop.
		fetchMock.mockResolvedValue(
			jsonResponse(
				{ error_code: "INVALID_CREDENTIALS", message: "Email or password is wrong." },
				401,
			),
		);

		const error = await failure(login({ email: "a@b.test", password: "no" }, { baseUrl: BASE }));

		expect(error.errorCode).toBe("INVALID_CREDENTIALS");
		expect(error.retryable).toBe(false);
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
