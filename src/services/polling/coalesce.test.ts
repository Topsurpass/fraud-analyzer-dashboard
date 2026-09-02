import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PollResponse } from "@/contracts/api";
import { coalescedPoll, invalidateCoalesced, resetCoalesced } from "./coalesce";

/**
 * A board can hold twenty cards across a dozen queries, and every card runs its
 * own poll loop.
 *
 * Two things are pinned here, and one is pinned by its absence. Cards watching
 * *one* query must make one request between them: that is what the query/chart
 * split bought, and losing it in the browser would give it straight back. Cards
 * watching *different* queries must NOT wait for each other, which is the whole
 * reason the batch was taken out - a batch resolves all at once, so every chart
 * paid the price of the slowest card in it.
 */

function answer(hash = "h1", queryId = "q1"): PollResponse {
	return {
		query_id: queryId,
		changed: false,
		data_hash: hash,
		poll_interval_ms: 5000,
		from_cache: true,
	};
}

/** A fetcher that records its calls and answers immediately. */
function fetcher(hash = "h1", queryId = "q1") {
	return vi.fn(async () => answer(hash, queryId));
}

beforeEach(() => {
	resetCoalesced();
	vi.useRealTimers();
});

describe("cards watching one query", () => {
	it("make one request between them when they ask at once", async () => {
		const fetch = fetcher();

		const [a, b, c] = await Promise.all([
			coalescedPoll("q1", null, false, fetch),
			coalescedPoll("q1", null, false, fetch),
			coalescedPoll("q1", null, false, fetch),
		]);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(a).toEqual(b);
		expect(b).toEqual(c);
	});

	it("reuse an answer that landed moments earlier", async () => {
		// Cards drift by a few milliseconds. A poll landing just after another
		// completed should not open a second connection for the same question.
		const fetch = fetcher();
		await coalescedPoll("q1", null, false, fetch);
		await coalescedPoll("q1", null, false, fetch);

		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("ask again once the reuse window has passed", async () => {
		// The window collapses a burst. It must never hold data back: the engine
		// decides how stale an answer may be, and a client-side second opinion
		// about freshness is how a monitoring board goes quietly out of date.
		const fetch = fetcher();
		vi.useFakeTimers();
		await coalescedPoll("q1", null, false, fetch);
		vi.advanceTimersByTime(1000);
		await coalescedPoll("q1", null, false, fetch);

		expect(fetch).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});

	it("do not share between different since-hashes", async () => {
		// "Changed since X" and "changed since Y" are different questions and
		// cannot share an answer.
		const fetch = fetcher();
		await Promise.all([
			coalescedPoll("q1", "hash-a", false, fetch),
			coalescedPoll("q1", "hash-b", false, fetch),
		]);

		expect(fetch).toHaveBeenCalledTimes(2);
	});
});

describe("cards watching different queries", () => {
	it("each go on their own so none waits for the slowest", async () => {
		// The regression this file exists for. Batched, a warm card sat behind a
		// cold one; on a board of eight at 25,000 rows that was 1559 ms of
		// waiting for a chart whose own data was ready in 9 ms.
		let releaseSlow: (value: PollResponse) => void = () => {};
		const slow = vi.fn(
			() => new Promise<PollResponse>((resolve) => {
				releaseSlow = resolve;
			}),
		);
		const quick = fetcher("h1", "q2");

		const slowPoll = coalescedPoll("q1", null, false, slow);
		const quickPoll = coalescedPoll("q2", null, false, quick);

		// The quick card resolves while the slow one is still open.
		await expect(quickPoll).resolves.toEqual(answer("h1", "q2"));
		expect(slow).toHaveBeenCalledTimes(1);

		releaseSlow(answer("h1", "q1"));
		await expect(slowPoll).resolves.toEqual(answer("h1", "q1"));
	});

	it("each carry their own since-hash", async () => {
		const first = fetcher("h1", "q1");
		const second = fetcher("h1", "q2");

		await Promise.all([
			coalescedPoll("q1", "hash-a", false, first),
			coalescedPoll("q2", "hash-b", false, second),
		]);

		expect(first).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledTimes(1);
	});

	it("do not make one card's failure another card's failure", async () => {
		const broken = vi.fn(async () => {
			throw new Error("that card's SQL is broken");
		});
		const fine = fetcher("h1", "q2");

		const results = await Promise.allSettled([
			coalescedPoll("q1", null, false, broken),
			coalescedPoll("q2", null, false, fine),
		]);

		expect(results[0].status).toBe("rejected");
		expect(results[1].status).toBe("fulfilled");
	});
});

describe("failures", () => {
	it("reach every card sharing the request rather than hanging one of them", async () => {
		const failing = vi.fn(async () => {
			throw new Error("engine down");
		});

		const results = await Promise.allSettled([
			coalescedPoll("q1", null, false, failing),
			coalescedPoll("q1", null, false, failing),
		]);

		expect(results.every((r) => r.status === "rejected")).toBe(true);
		expect(failing).toHaveBeenCalledTimes(1);
	});

	it("are not remembered, so the retry after one actually asks", async () => {
		// A remembered failure would freeze the card on its error for the length
		// of the reuse window and make the retry a no-op.
		const failing = vi.fn(async () => {
			throw new Error("engine down");
		});
		await expect(coalescedPoll("q1", null, false, failing)).rejects.toThrow();
		await expect(coalescedPoll("q1", null, false, failing)).rejects.toThrow();

		expect(failing).toHaveBeenCalledTimes(2);
	});
});

describe("a forced refresh", () => {
	it("goes on its own, bypassing everything remembered", async () => {
		// Somebody pressing Refresh is asking for a fresh read. Handing them a
		// cached one, however recent, makes the button look broken.
		const fetch = fetcher();
		await coalescedPoll("q1", null, false, fetch);
		await coalescedPoll("q1", null, true, fetch);

		expect(fetch).toHaveBeenCalledTimes(2);
	});
});

describe("invalidation", () => {
	it("forgets a query when its charts or rules change under it", async () => {
		const fetch = fetcher();
		await coalescedPoll("q1", null, false, fetch);
		invalidateCoalesced("q1");
		await coalescedPoll("q1", null, false, fetch);

		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("leaves the other queries remembered", async () => {
		const first = fetcher("h1", "q1");
		const second = fetcher("h1", "q2");
		await coalescedPoll("q1", null, false, first);
		await coalescedPoll("q2", null, false, second);

		invalidateCoalesced("q1");
		await coalescedPoll("q2", null, false, second);

		expect(second).toHaveBeenCalledTimes(1);
	});
});

describe("a shared request is not one consumer's to cancel", () => {
	it("hands the same answer to a consumer that joins late", async () => {
		let release: (value: PollResponse) => void = () => {};
		const slow = vi.fn(
			() => new Promise<PollResponse>((resolve) => {
				release = resolve;
			}),
		);

		const first = coalescedPoll("q1", null, false, slow);
		const second = coalescedPoll("q1", null, false, slow);
		release(answer());

		expect(await first).toEqual(await second);
		expect(slow).toHaveBeenCalledTimes(1);
	});
});
