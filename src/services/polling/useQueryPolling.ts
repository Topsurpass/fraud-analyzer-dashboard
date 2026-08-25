"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PollResponse, RunResponse } from "@/contracts/api";
import { isPollChanged } from "@/contracts/api";
import { ApiError, pollQuery } from "@/services/api-client";
import { coalescedPoll } from "./coalesce";

/**
 * Drives one ChartCard's live data.
 *
 * The design brief makes the poll state visible: the pulse line is flat while
 * polls come back unchanged, spikes when the engine reports changed data, and
 * goes dashed on error or timeout. So this hook exposes the poll *events*, not
 * just the latest payload - `changeSeq` and `pollSeq` are what the waveform
 * animates from, and they only move when the engine actually said something.
 *
 * Cadence comes from the engine: every response carries `poll_interval_ms`, and
 * that value replaces our local one. On failure the interval backs off
 * exponentially so a broken query stops hammering a database that is already
 * unhappy, and the card shows a retry action rather than failing silently.
 */

export type PollPhase =
  /** Nothing fetched yet. */
  | "loading"
  /** At least one poll succeeded; the card has data. */
  | "live"
  /** The last poll failed. `snapshot` may still hold older data. */
  | "error"
  /** Polling deliberately stopped (tab hidden, or `enabled: false`). */
  | "paused";

/** What the polling loop observed. `phase` is derived from these, not stored. */
interface PollFacts {
  /** Last full payload the engine sent. Survives later unchanged polls. */
  snapshot: RunResponse | null;
  dataHash: string | null;
  /** Bumped once per poll that reported changed data. Drives the spike. */
  changeSeq: number;
  /** Bumped once per completed poll of any kind. Drives the idle tremor. */
  pollSeq: number;
  /** Epoch ms of the last completed poll, changed or not. */
  lastPolledAt: number | null;
  /** Epoch ms of the last poll that actually brought new data. */
  lastChangedAt: number | null;
  pollIntervalMs: number;
  error: ApiError | null;
  consecutiveErrors: number;
  /** True when the engine served the last answer from its own cache. */
  fromCache: boolean;
  /** True while a request is in flight. */
  inFlight: boolean;
}

export interface QueryPollingState extends PollFacts {
  phase: PollPhase;
}

export interface QueryPollingControls {
  /** Re-poll now, bypassing the engine cache. Also clears an error. */
  refresh: () => void;
}

export type UseQueryPolling = QueryPollingState & QueryPollingControls;

export interface UseQueryPollingOptions {
  /** Stop polling without unmounting. Defaults to true. */
  enabled?: boolean;
  /** Stop polling while the tab is hidden. Defaults to true. */
  pauseWhenHidden?: boolean;
  /** Used until the engine tells us its own cadence. */
  fallbackIntervalMs?: number;
  /** Per-request deadline. Beyond this the poll is reported as a timeout. */
  timeoutMs?: number;
  /** Ceiling on the error backoff. */
  maxBackoffMs?: number;
}

export const DEFAULT_POLL_INTERVAL_MS = 5_000;
export const DEFAULT_POLL_TIMEOUT_MS = 12_000;
export const DEFAULT_MAX_BACKOFF_MS = 60_000;

/** Capped exponential backoff. No jitter: one card polling is not a herd. */
export function backoffFor(
  baseIntervalMs: number,
  consecutiveErrors: number,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
): number {
  if (consecutiveErrors <= 0) return baseIntervalMs;
  const scaled = baseIntervalMs * 2 ** Math.min(consecutiveErrors, 10);
  return Math.min(scaled, maxBackoffMs);
}

/** Derive the visible phase. Paused wins, then error, then whether data exists. */
export function derivePhase(facts: PollFacts, active: boolean): PollPhase {
  if (!active) return "paused";
  if (facts.error) return "error";
  if (facts.snapshot || facts.dataHash) return "live";
  return "loading";
}

function initialFacts(pollIntervalMs: number): PollFacts {
  return {
    snapshot: null,
    dataHash: null,
    changeSeq: 0,
    pollSeq: 0,
    lastPolledAt: null,
    lastChangedAt: null,
    pollIntervalMs,
    error: null,
    consecutiveErrors: 0,
    fromCache: false,
    inFlight: false,
  };
}

export function useQueryPolling(
  queryId: string | null,
  options: UseQueryPollingOptions = {},
): UseQueryPolling {
  const {
    enabled = true,
    pauseWhenHidden = true,
    fallbackIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  } = options;

  const [facts, setFacts] = useState<PollFacts>(() => initialFacts(fallbackIntervalMs));

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  // Read inside the loop rather than closed over, so a hash learned by one poll
  // is available to the next without re-creating the loop.
  const hashRef = useRef<string | null>(null);
  const errorsRef = useRef(0);
  const intervalRef = useRef(fallbackIntervalMs);
  const forceRef = useRef(false);
  /** Set by the polling effect so `refresh` can trigger a poll immediately. */
  const runPollRef = useRef<(() => void) | null>(null);

  const [hidden, setHidden] = useState(false);

  // Clear the visible state when the card is pointed at a different query.
  // Without this the card would keep rendering the previous query's rows until
  // the new one's first poll landed. Adjusting state during render is React's
  // documented way to do a reset-on-prop-change without an extra render pass;
  // the matching ref reset happens in the polling effect below, since refs must
  // not be written while rendering.
  const [trackedQueryId, setTrackedQueryId] = useState(queryId);
  if (queryId !== trackedQueryId) {
    setTrackedQueryId(queryId);
    setFacts(initialFacts(fallbackIntervalMs));
  }

  useEffect(() => {
    if (!pauseWhenHidden || typeof document === "undefined") return;
    const read = () => setHidden(document.visibilityState === "hidden");
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, [pauseWhenHidden]);

  const active = enabled && Boolean(queryId) && !hidden;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!queryId || !active) {
      // Nothing to trigger while paused; leaving a stale runner here would let
      // a retry click fire a poll the card has explicitly stopped.
      runPollRef.current = null;
      return;
    }

    stoppedRef.current = false;
    // A new query must not inherit the previous query's hash, error count or
    // cadence. This effect re-runs whenever `queryId` changes, and it runs
    // before the first poll below, so the reset is always in place in time.
    hashRef.current = null;
    errorsRef.current = 0;
    intervalRef.current = fallbackIntervalMs;
    forceRef.current = false;

    const schedule = (delayMs: number) => {
      if (stoppedRef.current) return;
      clearTimer();
      timerRef.current = setTimeout(runPoll, delayMs);
    };

    const applyResponse = (response: PollResponse) => {
      const now = Date.now();
      errorsRef.current = 0;
      intervalRef.current = response.poll_interval_ms || intervalRef.current;
      hashRef.current = response.data_hash;

      setFacts((previous) => {
        const base: PollFacts = {
          ...previous,
          error: null,
          consecutiveErrors: 0,
          inFlight: false,
          pollSeq: previous.pollSeq + 1,
          lastPolledAt: now,
          dataHash: response.data_hash,
          pollIntervalMs: response.poll_interval_ms || previous.pollIntervalMs,
          fromCache: response.from_cache === true,
        };

        if (!isPollChanged(response)) return base;

        // Only a genuinely new hash is a change worth spiking for. A forced
        // refresh returns the full payload with the same hash, and that must
        // not read as "the data moved".
        const moved = previous.dataHash !== response.data_hash;
        return {
          ...base,
          snapshot: response,
          changeSeq: moved ? previous.changeSeq + 1 : previous.changeSeq,
          lastChangedAt: moved ? now : previous.lastChangedAt,
        };
      });
    };

    const applyError = (error: ApiError) => {
      const now = Date.now();
      errorsRef.current += 1;
      const attempts = errorsRef.current;

      setFacts((previous) => ({
        ...previous,
        error,
        consecutiveErrors: attempts,
        inFlight: false,
        pollSeq: previous.pollSeq + 1,
        lastPolledAt: now,
      }));
    };

    async function runPoll() {
      if (stoppedRef.current || !queryId) return;

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      const force = forceRef.current;
      forceRef.current = false;

      setFacts((previous) => (previous.inFlight ? previous : { ...previous, inFlight: true }));

      try {
        // Coalesced: several charts of one query are several cards, each with
        // its own loop. Without this they make identical requests on the same
        // interval, which is the waste the query/chart split removed from the
        // engine reappearing in the browser.
        const response = await coalescedPoll(queryId, hashRef.current, force, () =>
          pollQuery(
            queryId,
            // A forced refresh must not send since_hash, or the engine answers
            // "unchanged" and the analyst gets nothing back for their click.
            force ? { force: true } : { sinceHash: hashRef.current },
            { signal: controller.signal, timeoutMs },
          ),
        );
        if (stoppedRef.current || controller.signal.aborted) return;
        applyResponse(response);
        schedule(intervalRef.current);
      } catch (cause) {
        if (stoppedRef.current) return;
        const error =
          cause instanceof ApiError
            ? cause
            : new ApiError({
                kind: "network",
                message: cause instanceof Error ? cause.message : "Poll failed",
                url: "",
              });
        if (error.kind === "aborted") return;
        applyError(error);
        schedule(backoffFor(intervalRef.current, errorsRef.current, maxBackoffMs));
      }
    }

    runPollRef.current = runPoll;
    runPoll();

    return () => {
      stoppedRef.current = true;
      runPollRef.current = null;
      clearTimer();
      controllerRef.current?.abort();
    };
  }, [queryId, active, timeoutMs, maxBackoffMs, fallbackIntervalMs, clearTimer]);

  /**
   * Poll now, bypassing both the engine cache and our own change detection.
   * Clearing the stored hash matters: with `since_hash` set the engine would
   * answer "unchanged" and the analyst would get nothing back for their click.
   */
  const refresh = useCallback(() => {
    const run = runPollRef.current;
    if (!queryId || !run) return;
    forceRef.current = true;
    errorsRef.current = 0;
    hashRef.current = null;
    clearTimer();
    setFacts((previous) => ({ ...previous, error: null, consecutiveErrors: 0 }));
    run();
  }, [queryId, clearTimer]);

  return useMemo(
    () => ({
      ...facts,
      phase: derivePhase(facts, active),
      inFlight: active && facts.inFlight,
      refresh,
    }),
    [facts, active, refresh],
  );
}
