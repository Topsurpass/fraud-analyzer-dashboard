import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PollResponse } from "@/contracts/api";
import { EMPTY_FLAGS } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { resetCoalesced } from "./coalesce";
import {
  STALE_GRACE_MS,
  STALE_RETRY_MS,
  backoffFor,
  nextPollDelay,
  useQueryPolling,
} from "./useQueryPolling";

const pollQuery = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return {
    ...actual,
    pollQuery,
  };
});

/** An ISO time this many ms from the (fake) clock's now: negative is the past. */
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

/**
 * A full payload, the shape the engine returns on a changed poll.
 *
 * `executedAt` is when the engine ran the query, which the hook schedules
 * against. The default is one grace period ago, which puts the next poll
 * exactly one interval away (the hook aims a grace period *past* the end of the
 * interval), so the many tests here about hashes, errors and backoff can step
 * the clock by the interval, as they always have. Tests about the schedule
 * itself pass their own.
 */
function changed(
  hash: string,
  rows: unknown[][] = [[1]],
  intervalMs = 3000,
  executedAt: string = at(-STALE_GRACE_MS),
): PollResponse {
  return {
    query_id: "q1",
    executed_at: executedAt,
    duration_ms: 4,
    row_count: rows.length,
    truncated: false,
    data_hash: `sha256:${hash}`,
    columns: ["n"],
    rows: rows as never,
    charts: [
      { id: "c", name: "Chart", type: "number", x_field: null, y_field: "n", series_field: null, warnings: [] },
    ],
    flags: EMPTY_FLAGS,
    poll_interval_ms: intervalMs,
  };
}

/** The lean payload the engine returns when since_hash still matches. */
function unchanged(hash: string, intervalMs = 3000, executedAt?: string): PollResponse {
  return {
    query_id: "q1",
    changed: false,
    data_hash: `sha256:${hash}`,
    poll_interval_ms: intervalMs,
    from_cache: true,
    ...(executedAt ? { executed_at: executedAt } : {}),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  pollQuery.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Let a poll settle.
 *
 * The coalescer holds a poll for one frame to see whether another card is
 * ticking alongside it, so settling now means letting that window elapse as
 * well as draining microtasks. Still no meaningful clock movement: 16ms is far
 * below any poll interval in these tests.
 */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Move the clock by exactly this much, and no further. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Let a poll whose timer has already fired actually leave.
 *
 * The coalescer holds a queued poll for one frame to see whether another card
 * is ticking alongside it, so "the timer fired" and "the request went out" are
 * 16ms apart. Kept separate from `advance` on purpose: several tests below
 * check the scheduler to the millisecond - that it has *not* polled at
 * interval-minus-one - and folding the window into every advance would blur
 * exactly the boundary they exist to pin down.
 */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
}

describe("backoffFor", () => {
  it("returns the base interval while nothing is failing", () => {
    expect(backoffFor(3000, 0)).toBe(3000);
  });

  it("doubles per consecutive failure", () => {
    expect(backoffFor(1000, 1)).toBe(2000);
    expect(backoffFor(1000, 2)).toBe(4000);
    expect(backoffFor(1000, 3)).toBe(8000);
  });

  it("stops at the ceiling instead of growing without bound", () => {
    expect(backoffFor(1000, 40, 60_000)).toBe(60_000);
  });
});

describe("useQueryPolling", () => {
  it("polls immediately on mount without a since_hash", async () => {
    pollQuery.mockResolvedValue(changed("aaa"));
    const { result } = renderHook(() => useQueryPolling("q1"));

    await flush();

    expect(pollQuery).toHaveBeenCalledTimes(1);
    expect(pollQuery.mock.calls[0][1]).toEqual({ sinceHash: null });
    expect(result.current.phase).toBe("live");
    expect(result.current.changeSeq).toBe(1);
    expect(result.current.snapshot?.data_hash).toBe("sha256:aaa");
  });

  it("sends the hash it learned on the next poll", async () => {
    pollQuery.mockResolvedValueOnce(changed("aaa")).mockResolvedValue(unchanged("aaa"));
    renderHook(() => useQueryPolling("q1"));
    await flush();
    await advance(3000);
    await settle();

    expect(pollQuery).toHaveBeenCalledTimes(2);
    expect(pollQuery.mock.calls[1][1]).toEqual({ sinceHash: "sha256:aaa" });
  });

  it("counts an unchanged poll without spiking or losing the data", async () => {
    pollQuery.mockResolvedValueOnce(changed("aaa")).mockResolvedValue(unchanged("aaa"));
    const { result } = renderHook(() => useQueryPolling("q1"));
    await flush();
    await advance(3000);
    await settle();

    expect(result.current.pollSeq).toBe(2);
    expect(result.current.changeSeq).toBe(1); // did not move
    expect(result.current.snapshot?.data_hash).toBe("sha256:aaa"); // still there
    expect(result.current.fromCache).toBe(true);
    expect(result.current.phase).toBe("live");
  });

  it("spikes exactly once when the hash actually moves", async () => {
    pollQuery
      .mockResolvedValueOnce(changed("aaa"))
      .mockResolvedValueOnce(unchanged("aaa"))
      .mockResolvedValueOnce(changed("bbb", [[2]]));
    const { result } = renderHook(() => useQueryPolling("q1"));
    await flush();
    await advance(3000);
    await settle();
    expect(result.current.changeSeq).toBe(1);

    await advance(3000);
    await settle();
    expect(result.current.changeSeq).toBe(2);
    expect(result.current.snapshot?.rows).toEqual([[2]]);
  });

  it("adopts the cadence the engine asks for", async () => {
    pollQuery.mockResolvedValueOnce(changed("aaa", [[1]], 8000)).mockResolvedValue(unchanged("aaa", 8000));
    const { result } = renderHook(() => useQueryPolling("q1"));
    await flush();
    expect(result.current.pollIntervalMs).toBe(8000);

    /*
     * Measured from the count after the first poll settled, not from a
     * millisecond either side of the interval. The old form asserted at 7999
     * and 8000, which only passed because the coalescer's 16 ms batch window
     * happened to push the next poll over the line; it was pinning that
     * accident rather than the cadence. What the card actually owes is that
     * eight seconds means roughly eight seconds, not three.
     */
    const afterFirst = pollQuery.mock.calls.length;
    await advance(7000);
    expect(pollQuery).toHaveBeenCalledTimes(afterFirst);
    // Aimed just past the interval (a moment after the engine's cache goes
    // stale), not at it, so the poll finds something to refresh.
    await advance(1000 + STALE_GRACE_MS + 100);
    await settle();
    expect(pollQuery.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it("surfaces a failure as an error phase and keeps the stale snapshot", async () => {
    pollQuery
      .mockResolvedValueOnce(changed("aaa"))
      .mockRejectedValue(new ApiError({ kind: "timeout", message: "Timed out", url: "/x" }));
    const { result } = renderHook(() => useQueryPolling("q1"));
    await flush();
    await advance(3000);
    await settle();

    expect(result.current.phase).toBe("error");
    expect(result.current.error?.kind).toBe("timeout");
    expect(result.current.consecutiveErrors).toBe(1);
    // The analyst can still read the last known-good numbers.
    expect(result.current.snapshot?.data_hash).toBe("sha256:aaa");
  });

  it("backs off instead of hammering a database that is already unhappy", async () => {
    pollQuery.mockRejectedValue(
      new ApiError({ kind: "http", message: "boom", url: "/x", status: 500 }),
    );
    const { result } = renderHook(() =>
      useQueryPolling("q1", { fallbackIntervalMs: 1000 }),
    );
    await flush();
    const afterFirst = pollQuery.mock.calls.length;

    // First retry waits 2x the interval, not 1x. Asserted with a margin either
    // side rather than on the exact millisecond: the point is that a failing
    // database gets backed off, not that the timer lands on a specific tick.
    await advance(1500);
    expect(pollQuery).toHaveBeenCalledTimes(afterFirst);
    await advance(1000);
    await settle();
    expect(pollQuery).toHaveBeenCalledTimes(afterFirst + 1);

    // Second retry waits 4x, measured from when that retry failed. The window
    // checked here is short of 4000 by more than the 500 ms the step above
    // overshot the retry by, so the margin stays a margin.
    await advance(3000);
    expect(pollQuery).toHaveBeenCalledTimes(afterFirst + 1);
    await advance(1500);
    await settle();
    expect(pollQuery).toHaveBeenCalledTimes(3);
    expect(result.current.consecutiveErrors).toBe(3);
  });

  it("recovers cleanly once the engine answers again", async () => {
    pollQuery
      .mockRejectedValueOnce(new ApiError({ kind: "network", message: "down", url: "/x" }))
      .mockResolvedValue(changed("aaa", [[7]], 1000));
    const { result } = renderHook(() =>
      useQueryPolling("q1", { fallbackIntervalMs: 1000 }),
    );
    await flush();
    expect(result.current.phase).toBe("error");

    await advance(2000);
    await settle();
    expect(result.current.phase).toBe("live");
    expect(result.current.error).toBeNull();
    expect(result.current.consecutiveErrors).toBe(0);
  });

  it("ignores an aborted request rather than reporting it as a failure", async () => {
    pollQuery
      .mockResolvedValueOnce(changed("aaa"))
      .mockRejectedValue(new ApiError({ kind: "aborted", message: "cancelled", url: "/x" }));
    const { result } = renderHook(() => useQueryPolling("q1"));
    await flush();
    await advance(3000);

    expect(result.current.phase).toBe("live");
    expect(result.current.error).toBeNull();
  });

  describe("refresh", () => {
    it("forces a poll that bypasses the cache and the stored hash", async () => {
      pollQuery.mockResolvedValue(changed("aaa"));
      const { result } = renderHook(() => useQueryPolling("q1"));
      await flush();

      await act(async () => {
        result.current.refresh();
        await Promise.resolve();
      });
      await flush();

      expect(pollQuery).toHaveBeenCalledTimes(2);
      expect(pollQuery.mock.calls[1][1]).toEqual({ force: true });
    });

    it("does not fake a change when the forced poll returns the same data", async () => {
      pollQuery.mockResolvedValue(changed("aaa"));
      const { result } = renderHook(() => useQueryPolling("q1"));
      await flush();
      expect(result.current.changeSeq).toBe(1);

      await act(async () => {
        result.current.refresh();
        await Promise.resolve();
      });
      await flush();

      // Same hash came back, so the pulse line must stay flat.
      expect(result.current.changeSeq).toBe(1);
      expect(result.current.pollSeq).toBe(2);
    });

    it("clears the error state so the retry button visibly does something", async () => {
      pollQuery
        .mockRejectedValueOnce(new ApiError({ kind: "network", message: "down", url: "/x" }))
        .mockResolvedValue(changed("aaa"));
      const { result } = renderHook(() => useQueryPolling("q1"));
      await flush();
      expect(result.current.phase).toBe("error");

      await act(async () => {
        result.current.refresh();
        await Promise.resolve();
      });
      await flush();

      expect(result.current.phase).toBe("live");
      expect(result.current.consecutiveErrors).toBe(0);
    });
  });

  it("does not poll at all when disabled", async () => {
    pollQuery.mockResolvedValue(changed("aaa"));
    const { result } = renderHook(() => useQueryPolling("q1", { enabled: false }));
    await flush();
    await advance(10_000);

    expect(pollQuery).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("paused");
  });

  it("does not poll without a query id", async () => {
    const { result } = renderHook(() => useQueryPolling(null));
    await flush();
    expect(pollQuery).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("paused");
  });

  it("stops polling when the tab is hidden and resumes when it returns", async () => {
    pollQuery.mockResolvedValue(changed("aaa", [[1]], 1000));
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");

    const { result } = renderHook(() => useQueryPolling("q1"));
    await flush();
    expect(pollQuery).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(5000);

    expect(pollQuery).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("paused");

    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();

    // Resuming polls straight away rather than waiting out the interval.
    expect(pollQuery).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("live");
    visibility.mockRestore();
  });

  it("keeps polling a hidden tab when asked to", async () => {
    pollQuery.mockResolvedValue(changed("aaa", [[1]], 1000));
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");

    renderHook(() => useQueryPolling("q1", { pauseWhenHidden: false }));
    await flush();
    expect(pollQuery).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it("stops the loop on unmount", async () => {
    pollQuery.mockResolvedValue(changed("aaa", [[1]], 1000));
    const { unmount } = renderHook(() => useQueryPolling("q1"));
    await flush();
    expect(pollQuery).toHaveBeenCalledTimes(1);

    unmount();
    await advance(10_000);
    expect(pollQuery).toHaveBeenCalledTimes(1);
  });

  it("restarts cleanly when the card switches to another query", async () => {
    pollQuery.mockResolvedValue(changed("aaa"));
    const { result, rerender } = renderHook(({ id }) => useQueryPolling(id), {
      initialProps: { id: "q1" },
    });
    await flush();
    expect(pollQuery.mock.calls[0][0]).toBe("q1");

    pollQuery.mockImplementation(() => new Promise(() => {})); // never settles
    rerender({ id: "q2" });

    // Before q2's first poll lands the card must show nothing, not q1's rows.
    expect(result.current.snapshot).toBeNull();
    expect(result.current.changeSeq).toBe(0);
    expect(result.current.phase).toBe("loading");

    // The request for q2 leaves a frame later, once the batch window closes.
    await settle();
    expect(pollQuery.mock.calls[1][0]).toBe("q2");
    // A new query must not inherit the previous query's hash.
    expect(pollQuery.mock.calls[1][1]).toEqual({ sinceHash: null });
  });
});

describe("remounting while a poll is in flight", () => {
  it("still shows data when the first mount's cleanup aborts", async () => {
    // The hang after saving a chart. React re-runs effects on mount in
    // development: the first run started a poll, its cleanup aborted it, and
    // the second run joined that same shared promise - so the abort arrived as
    // the second card's own failure and it sat in "loading" until something
    // re-ran the effect. Switching browser tabs did exactly that, through the
    // visibility handler, which is how this was noticed.
    //
    // The mock honours the abort signal, because that is the whole mechanism:
    // with a mock that ignores it the bug cannot reproduce.
    pollQuery.mockImplementation(
      (_id: string, _params: unknown, options: { signal?: AbortSignal }) =>
        new Promise<PollResponse>((resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new ApiError({ kind: "aborted", message: "aborted", url: "/poll" })),
          );
          setTimeout(() => resolve(changed("aaa", [[1], [2]])), 50);
        }),
    );

    const { unmount } = renderHook(() => useQueryPolling("q1"));
    unmount();

    const { result } = renderHook(() => useQueryPolling("q1"));
    // Long enough for the batch window and the mock's own 50ms delay after it.
    await advance(100);
    await advance(0);

    expect(result.current.error).toBeNull();
    expect(result.current.snapshot?.data_hash).toBe("sha256:aaa");
  });
});


describe("nextPollDelay", () => {
  const INTERVAL = 60_000;
  const NOW = 1_000_000_000_000;

  it("is a plain interval when the engine reported no execution time", () => {
    expect(nextPollDelay(NOW, null, INTERVAL, 0)).toBe(INTERVAL);
  });

  it("aims just past the end of the interval counted from the run", () => {
    // Ran 40s ago: stale in 20s, polled a grace period after.
    expect(nextPollDelay(NOW, NOW - 40_000, INTERVAL, 0)).toBe(20_000 + STALE_GRACE_MS);
  });

  it("never waits longer than one interval, even if the engine's clock runs ahead", () => {
    // "Ran" ten minutes in our future: must not stretch the wait to eleven minutes.
    expect(nextPollDelay(NOW, NOW + 600_000, INTERVAL, 0)).toBe(INTERVAL + STALE_GRACE_MS);
  });

  it("retries a stale answer soon, then backs off, then once per interval", () => {
    const stale = NOW - 10 * INTERVAL;
    const delays = [0, 1, 2, 3, 4, 5].map((streak) => nextPollDelay(NOW, stale, 120_000, streak));
    expect(delays).toEqual([...STALE_RETRY_MS, 120_000, 120_000]);
  });

  it("never retries a stale answer more often than the interval itself", () => {
    expect(nextPollDelay(NOW, NOW - 100_000, 2_000, 0)).toBe(2_000);
  });

  it("stays inside what a timer can hold", () => {
    expect(nextPollDelay(NOW, NOW, 10 ** 12, 0)).toBe(2_147_483_647);
  });
});

describe("the timer follows the engine's last run, not the card", () => {
  const INTERVAL = 60_000;

  function visibility(state: "visible" | "hidden") {
    const spy = vi.spyOn(document, "visibilityState", "get");
    spy.mockReturnValue(state);
    return spy;
  }
  async function toggleTab(spy: ReturnType<typeof visibility>, state: "visible" | "hidden") {
    spy.mockReturnValue(state);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  it("aims the next poll at the end of the interval counted from the run", async () => {
    // Ran 40s ago, so the result goes stale in 20s: not a full minute from now.
    pollQuery
      .mockResolvedValueOnce(changed("aaa", [[1]], INTERVAL, at(-40_000)))
      .mockResolvedValue(unchanged("aaa", INTERVAL));
    renderHook(() => useQueryPolling("q1"));
    await flush();
    expect(pollQuery).toHaveBeenCalledTimes(1);

    await advance(20_000);
    expect(pollQuery).toHaveBeenCalledTimes(1);
    await advance(STALE_GRACE_MS + 100);
    await settle();
    expect(pollQuery).toHaveBeenCalledTimes(2);
  });

  it("exposes when the query ran and when the next poll is aimed", async () => {
    const ran = at(-40_000);
    pollQuery.mockResolvedValue(changed("aaa", [[1]], INTERVAL, ran));
    const { result } = renderHook(() => useQueryPolling("q1"));
    await flush();

    expect(result.current.executedAt).toBe(Date.parse(ran));
    expect(result.current.nextPollAt).toBeGreaterThan(Date.now());
    expect(result.current.nextPollAt! - Date.now()).toBeLessThanOrEqual(20_000 + STALE_GRACE_MS);
  });

  it("learns a new run time from an unchanged answer, and aims at that", async () => {
    // The data did not change, but the engine ran again: only executed_at says so.
    pollQuery
      .mockResolvedValueOnce(changed("aaa", [[1]], INTERVAL, at(-59_000)))
      .mockResolvedValueOnce(unchanged("aaa", INTERVAL, at(0)))
      .mockResolvedValue(unchanged("aaa", INTERVAL));
    const { result } = renderHook(() => useQueryPolling("q1"));
    await flush();
    await advance(1_000 + STALE_GRACE_MS + 100);
    await settle();
    expect(pollQuery).toHaveBeenCalledTimes(2);

    // Ran just now, so a full interval to wait, not the 1s the first answer implied.
    expect(result.current.executedAt).toBeGreaterThan(Date.now() - 5_000);
    await advance(30_000);
    expect(pollQuery).toHaveBeenCalledTimes(2);
  });

  it("does not poll when the tab returns inside the interval", async () => {
    pollQuery.mockResolvedValue(changed("aaa", [[1]], INTERVAL));
    const spy = visibility("visible");
    const { result } = renderHook(() => useQueryPolling("q1"));
    await flush();
    const scheduled = result.current.nextPollAt;

    await toggleTab(spy, "hidden");
    await advance(10_000);
    await toggleTab(spy, "visible");
    await flush();

    // The clock was not restarted, and nothing was asked of the engine.
    expect(pollQuery).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("live");
    expect(Math.abs(result.current.nextPollAt! - scheduled!)).toBeLessThan(50);
    spy.mockRestore();
  });

  it("still polls on schedule after the tab came back early", async () => {
    pollQuery.mockResolvedValueOnce(changed("aaa", [[1]], INTERVAL)).mockResolvedValue(unchanged("aaa", INTERVAL));
    const spy = visibility("visible");
    renderHook(() => useQueryPolling("q1"));
    await flush();
    await toggleTab(spy, "hidden");
    await advance(10_000);
    await toggleTab(spy, "visible");

    await advance(INTERVAL - 10_000 + STALE_GRACE_MS + 100);
    await settle();

    expect(pollQuery).toHaveBeenCalledTimes(2);
    // And with the hash it learned, so the answer is the cheap one.
    expect(pollQuery.mock.calls[1][1]).toEqual({ sinceHash: "sha256:aaa" });
    spy.mockRestore();
  });

  it("polls at once when the tab returns after the next run was due", async () => {
    pollQuery.mockResolvedValue(changed("aaa", [[1]], INTERVAL));
    const spy = visibility("visible");
    renderHook(() => useQueryPolling("q1"));
    await flush();
    await toggleTab(spy, "hidden");
    await advance(INTERVAL * 2);
    expect(pollQuery).toHaveBeenCalledTimes(1);

    await toggleTab(spy, "visible");
    await flush();

    expect(pollQuery).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("asks again soon when an answer is already stale, then backs off to the interval", async () => {
    // The engine is refreshing behind a stale answer: look again shortly.
    const stale = at(-200_000);
    pollQuery
      .mockResolvedValueOnce(changed("aaa", [[1]], 120_000, stale))
      .mockResolvedValue(unchanged("aaa", 120_000, stale));
    const started = Date.now();
    renderHook(() => useQueryPolling("q1"));
    await flush();
    expect(pollQuery).toHaveBeenCalledTimes(1);

    // Stepped to absolute times, so no drift builds up from one wait to the
    // next: each retry is checked half a second before it is due (not yet) and
    // half a second after (there, the coalescer's frame included).
    const advanceTo = (elapsedMs: number) => advance(elapsedMs - (Date.now() - started));
    let due = 0;
    let expected = 1;
    for (const wait of [...STALE_RETRY_MS, 120_000]) {
      due += wait;
      await advanceTo(due - 500);
      expect(pollQuery).toHaveBeenCalledTimes(expected);
      await advanceTo(due + 500);
      await settle();
      expected += 1;
      expect(pollQuery).toHaveBeenCalledTimes(expected);
    }
  });

  it("caps the wait at one interval when the engine's clock runs ahead of ours", async () => {
    pollQuery.mockResolvedValue(changed("aaa", [[1]], 30_000, at(10 * 60_000)));
    const { result } = renderHook(() => useQueryPolling("q1"));
    await flush();
    expect(result.current.nextPollAt! - Date.now()).toBeLessThanOrEqual(30_000 + STALE_GRACE_MS);
  });

  it("keeps a plain interval for an engine that reports no execution time", async () => {
    const legacy = changed("aaa", [[1]], 10_000);
    delete (legacy as { executed_at?: string }).executed_at;
    pollQuery.mockResolvedValueOnce(legacy).mockResolvedValue(unchanged("aaa", 10_000));
    renderHook(() => useQueryPolling("q1"));
    await flush();

    await advance(9_900);
    expect(pollQuery).toHaveBeenCalledTimes(1);
    await advance(200);
    await settle();
    expect(pollQuery).toHaveBeenCalledTimes(2);
  });

  it("makes a remounted card fetch once and then line up with the run", async () => {
    // Navigating away and back loses the card's state, so it must ask once (the
    // engine answers from its cache) and then wait for the run, not a fresh interval.
    pollQuery
      .mockResolvedValue(changed("aaa", [[1]], INTERVAL, at(-40_000)));
    const first = renderHook(() => useQueryPolling("q1"));
    await flush();
    first.unmount();
    pollQuery.mockClear();
    // A real navigation takes longer than the coalescer's memory of an answer.
    resetCoalesced();

    const second = renderHook(() => useQueryPolling("q1"));
    await flush();
    expect(pollQuery).toHaveBeenCalledTimes(1);
    expect(pollQuery.mock.calls[0][1]).toEqual({ sinceHash: null });
    expect(second.result.current.nextPollAt! - Date.now()).toBeLessThan(INTERVAL / 2);
  });
});

describe("resync", () => {
  it("asks for the whole payload without forcing a run", async () => {
    pollQuery.mockResolvedValue(changed("aaa"));
    const { result } = renderHook(() => useQueryPolling("q1"));
    await flush();

    await act(async () => {
      result.current.resync();
      await Promise.resolve();
    });
    await flush();

    expect(pollQuery).toHaveBeenCalledTimes(2);
    // No force (the engine answers from its cache, running nothing) and no
    // since_hash (so it sends the whole payload, mapping included).
    expect(pollQuery.mock.calls[1][1]).toEqual({ sinceHash: null });
    expect(pollQuery.mock.calls[1][1]).not.toHaveProperty("force");
  });

  it("is a no-op while the card is paused", async () => {
    const { result } = renderHook(() => useQueryPolling("q1", { enabled: false }));
    await flush();
    await act(async () => result.current.resync());
    expect(pollQuery).not.toHaveBeenCalled();
  });

  it("leaves refresh as the one that runs the query", async () => {
    pollQuery.mockResolvedValue(changed("aaa"));
    const { result } = renderHook(() => useQueryPolling("q1"));
    await flush();
    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
    });
    await flush();
    expect(pollQuery.mock.calls[1][1]).toEqual({ force: true });
  });
});
