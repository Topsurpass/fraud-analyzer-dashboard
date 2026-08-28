import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PollResponse } from "@/contracts/api";
import { EMPTY_FLAGS } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { backoffFor, useQueryPolling } from "./useQueryPolling";

const pollQuery = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return {
    ...actual,
    pollQuery,
    /*
     * The coalescer batches, so the normal path leaves as one
     * `POST /queries/poll` rather than a request per card. These tests are
     * about one card's loop - what it sends, how it backs off, when it stops -
     * and none of that changes with the transport, so the batch is served here
     * by the same single-query fake. That keeps every assertion below about
     * `pollQuery` meaning what it says, while the batching itself is tested
     * where it lives, in coalesce.test.ts.
     */
    batchPoll: (body: { queries: Array<{ query_id: string; since_hash?: string | null }> }) =>
      Promise.all(
        body.queries.map((entry) =>
          pollQuery(entry.query_id, { sinceHash: entry.since_hash ?? null }),
        ),
      ).then((results) => ({ results })),
  };
});

/** A full payload, the shape the engine returns on a changed poll. */
function changed(hash: string, rows: unknown[][] = [[1]], intervalMs = 3000): PollResponse {
  return {
    query_id: "q1",
    executed_at: "2026-08-22T12:00:00",
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
function unchanged(hash: string, intervalMs = 3000): PollResponse {
  return {
    query_id: "q1",
    changed: false,
    data_hash: `sha256:${hash}`,
    poll_interval_ms: intervalMs,
    from_cache: true,
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

    // Still waiting a millisecond before the interval is up. Deliberately no
    // `settle` here: the point is that nothing has even been queued yet.
    await advance(7999);
    expect(pollQuery).toHaveBeenCalledTimes(1);
    await advance(1);
    await settle();
    expect(pollQuery).toHaveBeenCalledTimes(2);
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
    expect(pollQuery).toHaveBeenCalledTimes(1);

    // First retry waits 2x the interval, not 1x.
    await advance(1999);
    expect(pollQuery).toHaveBeenCalledTimes(1);
    await advance(1);
    await settle();
    expect(pollQuery).toHaveBeenCalledTimes(2);

    // Second retry waits 4x, measured from when that retry failed.
    await advance(3999);
    expect(pollQuery).toHaveBeenCalledTimes(2);
    await advance(1);
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
