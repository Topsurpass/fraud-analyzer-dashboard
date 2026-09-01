import { MAX_BATCH_POLL_QUERIES, type PollResponse } from "@/contracts/api";
import { batchPoll } from "@/services/api-client";

/**
 * One request per poll tick, however many cards are on the page.
 *
 * Charts are separate from queries, so a board can show the same result as a
 * trend line, a bar chart and the rows behind it, and a board can hold twenty
 * cards across a dozen queries. Each card runs its own poll loop. Left alone
 * that is twenty HTTP requests on every tick - and the browser opens six
 * connections at a time, so the last cards queue behind the first for no reason
 * but the shape of the fetch.
 *
 * Three mechanisms, because near-simultaneous, merely-close and
 * different-question are different problems:
 *
 * - **In flight.** A request for the same query and hash that is already open
 *   is shared rather than repeated.
 * - **Just finished.** Cards drift by a few milliseconds, so a poll landing
 *   moments after another completed reuses that answer instead of opening a
 *   second connection.
 * - **Batched.** Polls for *different* queries raised within the same short
 *   window leave as one `POST /queries/poll`, which the engine answers from one
 *   pass over its result cache.
 *
 * The reuse window is deliberately far shorter than any poll interval. It
 * exists to collapse a burst, never to hold data back: the engine's own cache
 * already decides how stale an answer may be, and a client-side cache long
 * enough to matter would be a second opinion about freshness in a system that
 * should only have one.
 *
 * One property worth naming, because it is what makes the batch keep paying
 * off rather than only helping on the first paint. Every card in a batch is
 * answered at the same instant, so every card in it schedules its next poll
 * from the same moment. Cards sharing a poll interval therefore stay in phase
 * and keep batching; cards on different intervals drift apart, which is
 * correct - they are not asking at the same time and should not wait for each
 * other. Nothing has to align them on a grid, and no poll is ever delayed to
 * make a batch bigger.
 */

/** How long a completed answer may be reused. Sub-frame drift, not staleness. */
const REUSE_WINDOW_MS = 750;

/**
 * How long a poll waits for company before leaving.
 *
 * Small on purpose. This is the gap between "these cards ticked together" and
 * "this card ticked later", and it is spent by the first caller in a batch, so
 * it is added to that poll's latency. A frame is the right order of magnitude:
 * long enough to collect a burst of cards whose timers fired in the same tick,
 * short enough that nobody perceives it.
 */
const BATCH_WINDOW_MS = 16;

interface Settled {
	at: number;
	value: PollResponse;
}

interface Waiting {
	queryId: string;
	sinceHash: string | null;
	key: string;
	resolve: (value: PollResponse) => void;
	reject: (cause: unknown) => void;
}

const inFlight = new Map<string, Promise<PollResponse>>();
const settled = new Map<string, Settled>();

let pending: Waiting[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function keyOf(queryId: string, sinceHash: string | null): string {
	// The hash is part of the key: two cards asking "changed since X" and
	// "changed since Y" are asking different questions and cannot share an
	// answer.
	return `${queryId} ${sinceHash ?? ""}`;
}

/**
 * Send the queued polls as one request and hand each waiter its own answer.
 *
 * Results are matched by `query_id` rather than by position. The engine returns
 * them in request order, but a batch is the one place where a silent
 * off-by-one would show up as a card rendering another card's rows - which is
 * the worst failure this app has, and not worth trusting an ordering guarantee
 * for when every response already names itself.
 */
async function flush(): Promise<void> {
	flushTimer = null;
	const batch = pending;
	pending = [];
	if (batch.length === 0) return;

	try {
		const { results } = await batchPoll({
			queries: batch.map((entry) => ({
				query_id: entry.queryId,
				since_hash: entry.sinceHash,
			})),
		});

		const byId = new Map<string, PollResponse>();
		for (const result of results) byId.set(result.query_id, result);

		for (const entry of batch) {
			const answer = byId.get(entry.queryId);
			if (answer === undefined) {
				// The engine answered the batch but said nothing about this query.
				// Rejecting is right: the card shows its own error and retries with
				// backoff, where resolving with a fabricated "unchanged" would
				// freeze it on stale rows and report nothing wrong.
				entry.reject(
					new Error(`The engine returned no result for ${entry.queryId} in a batch poll.`),
				);
				continue;
			}
			settled.set(entry.key, { at: Date.now(), value: answer });
			entry.resolve(answer);
		}
	} catch (cause) {
		// One failed request is a failure for every card that was in it. Each
		// applies its own backoff, so they do not all retry in lockstep.
		for (const entry of batch) entry.reject(cause);
	}
}

/**
 * Add a poll to the next batch.
 *
 * A query already queued with a *different* hash cannot join: the batch carries
 * one entry per query and the two are asking different questions. That caller
 * falls back to its own single-query request, which is correct and merely
 * unbatched. It is also rare - cards of one query converge on the same hash as
 * soon as one of them polls.
 */
function enqueue(queryId: string, sinceHash: string | null, key: string): Promise<PollResponse> | null {
	if (pending.length >= MAX_BATCH_POLL_QUERIES) return null;
	if (pending.some((entry) => entry.queryId === queryId && entry.key !== key)) return null;

	const promise = new Promise<PollResponse>((resolve, reject) => {
		pending.push({ queryId, sinceHash, key, resolve, reject });
	});

	if (flushTimer === null) flushTimer = setTimeout(() => void flush(), BATCH_WINDOW_MS);
	return promise;
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
	batchable = true,
): Promise<PollResponse> {
	if (force) return fetcher();

	/*
	 * A published chart cannot join a batch.
	 *
	 * The batch endpoint is `POST /queries/poll`, which is query-scoped and
	 * owner-only. A viewer of somebody else's published chart owns neither the
	 * query nor a right to name it, and the id they hold is a *chart* id, so
	 * putting it in a batch asks the wrong endpoint the wrong question with the
	 * wrong id. It answers not-found, and the card polls forever.
	 *
	 * Sharing and de-duplication above still apply, so several cards of one
	 * published chart still make one request. Only the batching is skipped.
	 */
	if (!batchable) {
		const soloKey = keyOf(queryId, sinceHash);
		const openSolo = inFlight.get(soloKey);
		if (openSolo) return openSolo;

		const recentSolo = settled.get(soloKey);
		if (recentSolo && Date.now() - recentSolo.at < REUSE_WINDOW_MS) {
			return Promise.resolve(recentSolo.value);
		}

		const solo = fetcher()
			.then((value) => {
				settled.set(soloKey, { at: Date.now(), value });
				return value;
			})
			.finally(() => {
				if (inFlight.get(soloKey) === solo) inFlight.delete(soloKey);
			});
		inFlight.set(soloKey, solo);
		return solo;
	}

	const key = keyOf(queryId, sinceHash);

	const open = inFlight.get(key);
	if (open) return open;

	const recent = settled.get(key);
	if (recent && Date.now() - recent.at < REUSE_WINDOW_MS) {
		return Promise.resolve(recent.value);
	}

	const batched = enqueue(queryId, sinceHash, key);
	const request = (
		batched ??
		fetcher().then((value) => {
			settled.set(key, { at: Date.now(), value });
			return value;
		})
	).finally(() => {
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

/** Drop every remembered answer and every queued poll. Tests, and a full reset. */
export function resetCoalesced(): void {
	inFlight.clear();
	settled.clear();
	pending = [];
	if (flushTimer !== null) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
}
