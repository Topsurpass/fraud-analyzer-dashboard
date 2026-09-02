import type { PollResponse } from "@/contracts/api";

/**
 * One request per card, shared when two cards ask the same question at once.
 *
 * Charts are separate from queries, so a board can show one result as a trend
 * line, a bar chart and the rows behind it. Each card runs its own poll loop.
 *
 * Two mechanisms, because near-simultaneous and merely-close are different
 * problems:
 *
 * - **In flight.** A request for the same query and hash that is already open
 *   is shared rather than repeated. Three cards of one query make one request.
 * - **Just finished.** Cards drift by a few milliseconds, so a poll landing
 *   moments after another completed reuses that answer instead of opening a
 *   second connection.
 *
 * The reuse window is deliberately far shorter than any poll interval. It
 * exists to collapse a burst, never to hold data back: the engine's own cache
 * already decides how stale an answer may be, and a client-side cache long
 * enough to matter would be a second opinion about freshness in a system that
 * should only have one.
 *
 * ## Why this no longer batches
 *
 * It used to collect polls raised within a 16 ms window and send them as one
 * `POST /queries/poll`. That was the right trade when a poll was expensive on
 * the server: twelve cards meant twelve worker threads and twelve target
 * connections, and collapsing them into one pass was worth something.
 *
 * It is the wrong trade now, and it was always the wrong shape for a
 * monitoring board. A batch resolves all at once, so every card waits for the
 * slowest card in it. Measured on the engine at 25,000 rows a query, a board
 * of eight cards where one is cold: batched, every chart waited 1559 ms.
 * Unbatched, each chart paints when its own data lands, and a warm card lands
 * in 9 ms. Head-of-line blocking was buying a lower request count and charging
 * every chart the price of the worst one.
 *
 * What made that affordable was making the poll cheap on the server rather
 * than rare: results are now served from bytes encoded and compressed once per
 * result rather than rebuilt per viewer, so the request count the batch existed
 * to reduce is no longer what costs anything. The engine still protects the
 * customer database on its own - a short-TTL result cache, one background
 * refresh per stale query however many cards ask, and a bounded refresh pool -
 * and none of that ever depended on the client batching.
 */

/** How long a completed answer may be reused. Sub-frame drift, not staleness. */
const REUSE_WINDOW_MS = 750;

interface Settled {
	at: number;
	value: PollResponse;
}

const inFlight = new Map<string, Promise<PollResponse>>();
const settled = new Map<string, Settled>();

function keyOf(queryId: string, sinceHash: string | null): string {
	// The hash is part of the key: two cards asking "changed since X" and
	// "changed since Y" are asking different questions and cannot share an
	// answer.
	return `${queryId} ${sinceHash ?? ""}`;
}

/**
 * Run this poll, sharing the trip with anything else asking at the same moment.
 *
 * `fetcher` is the single-query request. It is used for a forced refresh, and
 * as the fallback whenever a poll cannot join a batch - so the caller keeps
 * ownership of its own timeout and abort signal for exactly the cases that need
 * them.
 *
 * `force` bypasses every mechanism here. Someone pressing Refresh is asking for
 * a fresh read, and handing them a cached one - however recent - would make the
 * button appear not to work. It also stays a request of its own rather than
 * joining a batch: it carries that card's abort signal, and a shared request
 * must never be cancellable by one of its consumers.
 */
export function coalescedPoll(
	queryId: string,
	sinceHash: string | null,
	force: boolean,
	fetcher: () => Promise<PollResponse>,
): Promise<PollResponse> {
	if (force) return fetcher();

	const key = keyOf(queryId, sinceHash);

	const open = inFlight.get(key);
	if (open) return open;

	const recent = settled.get(key);
	if (recent && Date.now() - recent.at < REUSE_WINDOW_MS) {
		return Promise.resolve(recent.value);
	}

	const request = fetcher()
		.then((value) => {
			settled.set(key, { at: Date.now(), value });
			return value;
		})
		.finally(() => {
			// Only if it is still ours: a later request for the same key may have
			// replaced it while this one was settling.
			if (inFlight.get(key) === request) inFlight.delete(key);
		});

	inFlight.set(key, request);
	return request;
}

/**
 * Forget everything remembered for a query.
 *
 * Called when a query's own data is known to have changed under us - a chart
 * edited, a rule saved - so the next poll asks rather than reusing an answer
 * from before the change.
 */
export function invalidateCoalesced(queryId: string): void {
	const prefix = `${queryId} `;
	for (const key of [...settled.keys()]) {
		if (key.startsWith(prefix)) settled.delete(key);
	}
}

/** Drop every remembered answer. Tests, and a full reset. */
export function resetCoalesced(): void {
	inFlight.clear();
	settled.clear();
}
