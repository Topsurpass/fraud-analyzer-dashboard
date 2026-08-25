import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PollResponse } from "@/contracts/api";
import { coalescedPoll, invalidateCoalesced, resetCoalesced } from "./coalesce";

/**
 * Three charts of one query are three cards, each with its own poll loop.
 * Without coalescing they make three identical requests on the same interval,
 * which is the waste the query/chart split removed from the engine reappearing
 * in the browser.
 */

function answer(hash = "h1"): PollResponse {
  return { query_id: "q1", changed: false, data_hash: hash, poll_interval_ms: 5000, from_cache: true };
}

beforeEach(() => {
  resetCoalesced();
  vi.useRealTimers();
});

describe("coalescedPoll", () => {
  it("makes one request when several cards ask at once", async () => {
    const fetcher = vi.fn().mockResolvedValue(answer());
    const results = await Promise.all([
      coalescedPoll("q1", null, false, fetcher),
      coalescedPoll("q1", null, false, fetcher),
      coalescedPoll("q1", null, false, fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // All three get the answer, not just the one that asked first.
    expect(results.every((value) => value.data_hash === "h1")).toBe(true);
  });

  it("reuses an answer that landed moments earlier", async () => {
    // Cards drift by a few milliseconds; a poll arriving just after another
    // completed must not open a second connection.
    const fetcher = vi.fn().mockResolvedValue(answer());
    await coalescedPoll("q1", null, false, fetcher);
    await coalescedPoll("q1", null, false, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("asks again once the reuse window has passed", async () => {
    const fetcher = vi.fn().mockResolvedValue(answer());
    await coalescedPoll("q1", null, false, fetcher);

    const later = Date.now() + 5_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    await coalescedPoll("q1", null, false, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not share an answer between different queries", async () => {
    const fetcher = vi.fn().mockResolvedValue(answer());
    await coalescedPoll("q1", null, false, fetcher);
    await coalescedPoll("q2", null, false, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not share between different since-hashes", async () => {
    // "changed since X" and "changed since Y" are different questions.
    const fetcher = vi.fn().mockResolvedValue(answer());
    await coalescedPoll("q1", "a", false, fetcher);
    await coalescedPoll("q1", "b", false, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("always refetches for a forced refresh", async () => {
    // Someone pressing Refresh is asking for a fresh read; a cached answer
    // however recent would make the button look broken.
    const fetcher = vi.fn().mockResolvedValue(answer());
    await coalescedPoll("q1", null, false, fetcher);
    await coalescedPoll("q1", null, true, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("lets every waiter see a failure rather than hanging one of them", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network"));
    const results = await Promise.allSettled([
      coalescedPoll("q1", null, false, fetcher),
      coalescedPoll("q1", null, false, fetcher),
    ]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not remember a failure", async () => {
    // A failed poll must not suppress the retry that follows it.
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(answer());
    await expect(coalescedPoll("q1", null, false, fetcher)).rejects.toThrow();
    await expect(coalescedPoll("q1", null, false, fetcher)).resolves.toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("forgets a query when its charts or rules change under it", async () => {
    const fetcher = vi.fn().mockResolvedValue(answer());
    await coalescedPoll("q1", null, false, fetcher);
    invalidateCoalesced("q1");
    await coalescedPoll("q1", null, false, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidating one query leaves the others remembered", async () => {
    const fetcher = vi.fn().mockResolvedValue(answer());
    await coalescedPoll("q1", null, false, fetcher);
    await coalescedPoll("q2", null, false, fetcher);
    invalidateCoalesced("q1");
    await coalescedPoll("q2", null, false, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("a shared request is not one consumer's to cancel", () => {
  it("a second caller still gets data when the first walks away", async () => {
    // The hang after saving a chart. React re-runs effects on mount in
    // development: the first run started a poll, its cleanup aborted it, and
    // the second run joined that same promise and treated the AbortError as a
    // real failure - so the card sat in "loading" until the effect re-ran,
    // which is what switching tabs and back did.
    //
    // The fix is upstream in useQueryPolling: a coalesced poll is never given a
    // consumer's abort signal. This pins the property the coalescer relies on -
    // one shared request, one outcome, shared by everyone waiting.
    let settle: ((value: PollResponse) => void) | undefined;
    const fetcher = vi.fn(
      () =>
        new Promise<PollResponse>((resolve) => {
          settle = resolve;
        }),
    );

    const first = coalescedPoll("q1", null, false, fetcher);
    const second = coalescedPoll("q1", null, false, fetcher);

    // The first consumer goes away; nobody cancels the request itself.
    first.catch(() => {});

    settle?.(answer("h9"));
    await expect(second).resolves.toMatchObject({ data_hash: "h9" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("hands the same answer to a consumer that joins late", async () => {
    let settle: ((value: PollResponse) => void) | undefined;
    const fetcher = vi.fn(
      () =>
        new Promise<PollResponse>((resolve) => {
          settle = resolve;
        }),
    );

    const first = coalescedPoll("q1", null, false, fetcher);
    const late = coalescedPoll("q1", null, false, fetcher);
    settle?.(answer("h7"));

    expect((await first).data_hash).toBe("h7");
    expect((await late).data_hash).toBe("h7");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
