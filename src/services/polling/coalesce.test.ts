import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PollResponse } from "@/contracts/api";
import { coalescedPoll, invalidateCoalesced, resetCoalesced } from "./coalesce";

/**
 * A board can hold twenty cards across a dozen queries, and every card runs its
 * own poll loop. Left alone that is twenty HTTP requests on every tick, against
 * a browser that opens six connections at a time.
 *
 * Two things are being pinned here. Cards watching *one* query must make one
 * request between them - that is what the query/chart split bought, and losing
 * it in the browser would give it straight back. Cards watching *different*
 * queries at the same moment must leave as one batch rather than as a request
 * each.
 */

const batchPoll = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
	const actual =
		await vi.importActual<typeof import("@/services/api-client")>("@/services/api-client");
	return { ...actual, batchPoll };
});

function answer(hash = "h1", queryId = "q1"): PollResponse {
	return {
		query_id: queryId,
		changed: false,
		data_hash: hash,
		poll_interval_ms: 5000,
		from_cache: true,
	};
}

/** A batch that answers every query it was asked about. */
function answerAll(hash = "h1") {
	return async (body: { queries: Array<{ query_id: string }> }) => ({
		results: body.queries.map((entry) => answer(hash, entry.query_id)),
	});
}

/**
 * Wait for the batch window to close and the request to actually go out.
 *
 * Real time, deliberately: these two tests hold the request open by capturing
 * its `resolve`, and that only exists once the flush has run.
 *
 * An order of magnitude above the 16ms window rather than a few milliseconds
 * over it. This suite shares a machine with a dev server, an engine and a
 * browser, and a wait sized to the happy path is how a gate test starts failing
 * for reasons that have nothing to do with the code. It costs a fifth of a
 * second, twice.
 */
function afterTheWindow(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 250));
}

/** The queries in the nth batch request, in order. */
function batched(call = 0): string[] {
	return batchPoll.mock.calls[call][0].queries.map(
		(entry: { query_id: string }) => entry.query_id,
	);
}

beforeEach(() => {
	resetCoalesced();
	batchPoll.mockReset().mockImplementation(answerAll());
	vi.useRealTimers();
});

afterEach(() => {
	resetCoalesced();
	vi.restoreAllMocks();
});

describe("cards watching one query", () => {
	it("make one request between them when they ask at once", async () => {
		const fetcher = vi.fn();
		const results = await Promise.all([
			coalescedPoll("q1", null, false, fetcher),
			coalescedPoll("q1", null, false, fetcher),
			coalescedPoll("q1", null, false, fetcher),
		]);

		expect(batchPoll).toHaveBeenCalledTimes(1);
		expect(batched()).toEqual(["q1"]);
		// All three get the answer, not just the one that asked first.
		expect(results.every((value) => value.data_hash === "h1")).toBe(true);
	});

	it("reuse an answer that landed moments earlier", async () => {
		// Cards drift by a few milliseconds; a poll arriving just after another
		// completed must not open a second connection.
		const fetcher = vi.fn();
		await coalescedPoll("q1", null, false, fetcher);
		await coalescedPoll("q1", null, false, fetcher);
		expect(batchPoll).toHaveBeenCalledTimes(1);
	});

	it("ask again once the reuse window has passed", async () => {
		const fetcher = vi.fn();
		await coalescedPoll("q1", null, false, fetcher);

		const later = Date.now() + 5_000;
		vi.spyOn(Date, "now").mockReturnValue(later);
		await coalescedPoll("q1", null, false, fetcher);
		expect(batchPoll).toHaveBeenCalledTimes(2);
	});

	it("do not share between different since-hashes", async () => {
		/*
		 * "changed since X" and "changed since Y" are different questions, and
		 * the batch carries one entry per query - so the second cannot join the
		 * first's batch and falls back to its own single-query request. Correct,
		 * and merely unbatched.
		 */
		const fetcher = vi.fn().mockResolvedValue(answer("hb"));
		const first = coalescedPoll("q1", "a", false, fetcher);
		const second = coalescedPoll("q1", "b", false, fetcher);

		await Promise.all([first, second]);

		expect(batched()).toEqual(["q1"]);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});

describe("cards watching different queries", () => {
	it("leave as one request instead of one each", async () => {
		const fetcher = vi.fn();
		const results = await Promise.all([
			coalescedPoll("q1", null, false, fetcher),
			coalescedPoll("q2", null, false, fetcher),
			coalescedPoll("q3", null, false, fetcher),
		]);

		expect(batchPoll).toHaveBeenCalledTimes(1);
		expect(batched()).toEqual(["q1", "q2", "q3"]);
		expect(results.map((value) => value.query_id)).toEqual(["q1", "q2", "q3"]);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("collapse a whole board into one request", async () => {
		// The moment this exists for: twenty cards mounting together.
		const fetcher = vi.fn();
		const ids = Array.from({ length: 20 }, (_, index) => `q${index}`);

		await Promise.all(ids.map((id) => coalescedPoll(id, null, false, fetcher)));

		expect(batchPoll).toHaveBeenCalledTimes(1);
		expect(batched()).toEqual(ids);
	});

	it("carry each card's own since-hash", async () => {
		const fetcher = vi.fn();
		await Promise.all([
			coalescedPoll("q1", "sha256:aaa", false, fetcher),
			coalescedPoll("q2", null, false, fetcher),
		]);

		expect(batchPoll.mock.calls[0][0].queries).toEqual([
			{ query_id: "q1", since_hash: "sha256:aaa" },
			{ query_id: "q2", since_hash: null },
		]);
	});

	it("each get their own answer, matched by id rather than by position", async () => {
		/*
		 * A batch is the one place an off-by-one shows up as a card rendering
		 * another card's rows, which is the worst failure this app has. Every
		 * response names itself, so there is no reason to trust ordering - and
		 * this proves the matching, by answering out of order on purpose.
		 */
		batchPoll.mockImplementation(async (body: { queries: Array<{ query_id: string }> }) => ({
			results: [...body.queries]
				.reverse()
				.map((entry) => answer(`hash-${entry.query_id}`, entry.query_id)),
		}));

		const [one, two, three] = await Promise.all([
			coalescedPoll("q1", null, false, vi.fn()),
			coalescedPoll("q2", null, false, vi.fn()),
			coalescedPoll("q3", null, false, vi.fn()),
		]);

		expect(one.data_hash).toBe("hash-q1");
		expect(two.data_hash).toBe("hash-q2");
		expect(three.data_hash).toBe("hash-q3");
	});

	it("fail rather than freeze when the batch omits one of them", async () => {
		// Resolving with a fabricated "unchanged" would leave that card sitting
		// on stale rows reporting nothing wrong. Its own backoff handles this.
		batchPoll.mockImplementation(async () => ({ results: [answer("h1", "q1")] }));

		const [first, second] = await Promise.allSettled([
			coalescedPoll("q1", null, false, vi.fn()),
			coalescedPoll("q2", null, false, vi.fn()),
		]);

		expect(first.status).toBe("fulfilled");
		expect(second.status).toBe("rejected");
	});
});

describe("failures", () => {
	it("reach every card in the batch rather than hanging one of them", async () => {
		batchPoll.mockRejectedValue(new Error("network"));

		const results = await Promise.allSettled([
			coalescedPoll("q1", null, false, vi.fn()),
			coalescedPoll("q2", null, false, vi.fn()),
		]);

		expect(results.every((result) => result.status === "rejected")).toBe(true);
		expect(batchPoll).toHaveBeenCalledTimes(1);
	});

	it("are not remembered, so the retry after one actually asks", async () => {
		batchPoll.mockRejectedValueOnce(new Error("network")).mockImplementation(answerAll());

		await expect(coalescedPoll("q1", null, false, vi.fn())).rejects.toThrow();
		await expect(coalescedPoll("q1", null, false, vi.fn())).resolves.toBeTruthy();
		expect(batchPoll).toHaveBeenCalledTimes(2);
	});
});

describe("a forced refresh", () => {
	it("goes on its own, bypassing everything remembered", async () => {
		/*
		 * Someone pressing Refresh is asking for a fresh read; a cached answer
		 * however recent would make the button look broken. It stays a request
		 * of its own rather than joining a batch because it carries that card's
		 * abort signal, and a shared request must never be cancellable by one of
		 * its consumers.
		 */
		const fetcher = vi.fn().mockResolvedValue(answer("forced"));
		await coalescedPoll("q1", null, false, fetcher);

		const forced = await coalescedPoll("q1", null, true, fetcher);

		expect(forced.data_hash).toBe("forced");
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(batchPoll).toHaveBeenCalledTimes(1);
	});
});

describe("invalidation", () => {
	it("forgets a query when its charts or rules change under it", async () => {
		const fetcher = vi.fn();
		await coalescedPoll("q1", null, false, fetcher);
		invalidateCoalesced("q1");
		await coalescedPoll("q1", null, false, fetcher);
		expect(batchPoll).toHaveBeenCalledTimes(2);
	});

	it("leaves the other queries remembered", async () => {
		const fetcher = vi.fn();
		await Promise.all([
			coalescedPoll("q1", null, false, fetcher),
			coalescedPoll("q2", null, false, fetcher),
		]);
		invalidateCoalesced("q1");
		await coalescedPoll("q2", null, false, fetcher);

		// One batch for the pair, and nothing new for q2.
		expect(batchPoll).toHaveBeenCalledTimes(1);
	});
});

describe("a shared request is not one consumer's to cancel", () => {
	it("a second caller still gets data when the first walks away", async () => {
		/*
		 * The hang after saving a chart. React re-runs effects on mount in
		 * development: the first run started a poll, its cleanup aborted it, and
		 * the second run joined that same promise and treated the AbortError as
		 * a real failure - so the card sat in "loading" until the effect re-ran,
		 * which is what switching tabs and back did.
		 *
		 * The fix is upstream in useQueryPolling: a coalesced poll is never given
		 * a consumer's abort signal. This pins the property that relies on - one
		 * shared request, one outcome, shared by everyone waiting.
		 */
		let release: ((value: { results: PollResponse[] }) => void) | undefined;
		batchPoll.mockImplementation(
			() =>
				new Promise<{ results: PollResponse[] }>((resolve) => {
					release = resolve;
				}),
		);

		const first = coalescedPoll("q1", null, false, vi.fn());
		const second = coalescedPoll("q1", null, false, vi.fn());

		// The first consumer goes away; nobody cancels the request itself.
		first.catch(() => {});

		await afterTheWindow();
		release?.({ results: [answer("h9")] });

		await expect(second).resolves.toMatchObject({ data_hash: "h9" });
		expect(batchPoll).toHaveBeenCalledTimes(1);
	});

	it("hands the same answer to a consumer that joins late", async () => {
		let release: ((value: { results: PollResponse[] }) => void) | undefined;
		batchPoll.mockImplementation(
			() =>
				new Promise<{ results: PollResponse[] }>((resolve) => {
					release = resolve;
				}),
		);

		const first = coalescedPoll("q1", null, false, vi.fn());
		const late = coalescedPoll("q1", null, false, vi.fn());

		await afterTheWindow();
		release?.({ results: [answer("h7")] });

		expect((await first).data_hash).toBe("h7");
		expect((await late).data_hash).toBe("h7");
		expect(batchPoll).toHaveBeenCalledTimes(1);
	});
});
