"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PollResponse, RunResponse } from "@/contracts/api";
import { isPollChanged } from "@/contracts/api";
import { ApiError, pollPublishedChart, pollQuery } from "@/services/api-client";
import { parseIso } from "@/services/format";
import { coalescedPoll, invalidateCoalesced } from "./coalesce";

/**
 * Drives one ChartCard's live data.
 *
 * The design makes the poll state visible: the card's live indicator beats while
 * polls come back unchanged, flips to "changed" when the engine reports new
 * data, and goes rose on error or timeout. So this hook exposes the poll
 * *events*, not just the latest payload - `changeSeq` and `pollSeq` are what
 * the indicator reads from, and they only move when the engine actually said something.
 *
 * Cadence comes from the engine: every response carries `poll_interval_ms`, and
 * that value replaces our local one. On failure the interval backs off
 * exponentially so a broken query stops hammering a database that is already
 * unhappy, and the card shows a retry action rather than failing silently.
 *
 * ## The timer belongs to the result, not to the card
 *
 * The engine runs a query at most once per interval and caches the answer for
 * exactly that long, so the schedule that matters is "when was it last run",
 * not "when did this card mount". Every answer says when the result was produced
 * (`executed_at`), and the next poll is aimed at the moment that result goes
 * stale (`executed_at + interval`). Two consequences are the point of this:
 *
 * - Leaving a tab and coming back, or scrolling a card away and back, does not
 *   restart the clock. A hidden tab pauses; on return it polls only if the next
 *   run is actually due, and otherwise waits out what is left.
 * - Polls land when the engine is ready to run the query, so runs happen on the
 *   interval instead of drifting later by however long the card was open.
 *
 * A remounted card (navigating away and back) has no data and must fetch once;
 * the engine answers from its cache without touching the database.
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
  /**
   * Epoch ms when the engine last *ran the query* for the result on screen.
   * Not when we last asked: a poll inside the interval is served from cache and
   * runs nothing, so this only moves when the database was actually queried.
   */
  executedAt: number | null;
  /** Epoch ms the next poll is aimed at, or null while none is scheduled. */
  nextPollAt: number | null;
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
  /**
   * Re-poll now, bypassing the engine cache: this **runs the query** on the
   * database. For an explicit "try again" or "run it now" and nothing else.
   * Also clears an error.
   */
  refresh: () => void;
  /**
   * Fetch the whole current result again without running anything. For after
   * the result or its chart mapping changed on the engine by some other route
   * (a chart type switched, "Run now" already executed it): the engine's cache
   * is already right, and asking it for the full payload is free.
   */
  resync: () => void;
}

export type UseQueryPolling = QueryPollingState & QueryPollingControls;

export interface UseQueryPollingOptions {
  /**
   * Poll a *published chart* by its chart id instead of a query by query id.
   *
   * A viewer of somebody else's published chart cannot reach the query
   * endpoint at all, so the id means a different thing and the path does too.
   * Everything else about the loop is identical, which is why this is a flag
   * rather than a second hook.
   */
  published?: boolean;

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

/**
 * Poll this long *after* the result goes stale. The engine's cache expires on
 * its own clock, and a poll that arrives a moment early finds the old result
 * still fresh and learns nothing, so it is aimed just past the boundary.
 */
export const STALE_GRACE_MS = 1_500;

/**
 * After a poll that came back already past its interval (the engine is
 * refreshing behind the answer, or our clock runs ahead of its), ask again
 * after these delays, then once per interval. Each retry is a cache read; the
 * engine runs the query once however many times it is asked, and leaves a query
 * whose refresh failed alone for a full interval.
 */
export const STALE_RETRY_MS = [3_000, 10_000, 30_000, 60_000] as const;

/** `setTimeout` stores its delay in 32 bits; longer silently fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * How long to wait before the next poll.
 *
 * Aimed at the end of the interval the engine counts from its last run, never
 * more than one interval away (a clock running behind the engine's must not
 * stretch the wait), and never a tight loop when the result is already stale.
 * With no execution time to go on it is a plain interval.
 *
 * `staleStreak` is how many polls in a row already found the result past due.
 */
export function nextPollDelay(
  now: number,
  executedAt: number | null,
  intervalMs: number,
  staleStreak: number,
): number {
  if (executedAt === null) return Math.min(intervalMs, MAX_TIMER_MS);
  const untilStale = executedAt + intervalMs - now;
  if (untilStale > 0) {
    return Math.min(untilStale + STALE_GRACE_MS, intervalMs + STALE_GRACE_MS, MAX_TIMER_MS);
  }
  const retry = STALE_RETRY_MS[staleStreak] ?? intervalMs;
  return Math.min(retry, intervalMs, MAX_TIMER_MS);
}

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
    executedAt: null,
    nextPollAt: null,
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
    published = false,
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
  /** Epoch ms the engine last ran the query for what this card shows. */
  const executedAtRef = useRef<number | null>(null);
  /** Epoch ms the next poll is aimed at; survives a tab being hidden and shown. */
  const nextPollAtRef = useRef<number | null>(null);
  /** Polls in a row that found the result already past its interval. */
  const staleStreakRef = useRef(0);
  /** The query the refs above belong to, so only a *different* one resets them. */
  const trackedRef = useRef<string | null>(null);
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
    // A new query must not inherit the previous query's hash, error count,
    // cadence or schedule. Only a *different* query resets them: this effect
    // also re-runs when the same card is hidden and shown again, and that must
    // keep what it learned, above all when the next run is due, or every tab
    // switch would restart the clock.
    if (trackedRef.current !== queryId) {
      trackedRef.current = queryId;
      hashRef.current = null;
      errorsRef.current = 0;
      intervalRef.current = fallbackIntervalMs;
      forceRef.current = false;
      executedAtRef.current = null;
      nextPollAtRef.current = null;
      staleStreakRef.current = 0;
    }

    const schedule = (delayMs: number) => {
      if (stoppedRef.current) return;
      clearTimer();
      const at = Date.now() + delayMs;
      nextPollAtRef.current = at;
      setFacts((previous) => (previous.nextPollAt === at ? previous : { ...previous, nextPollAt: at }));
      timerRef.current = setTimeout(runPoll, delayMs);
    };

    const applyResponse = (response: PollResponse) => {
      const now = Date.now();
      errorsRef.current = 0;
      intervalRef.current = response.poll_interval_ms || intervalRef.current;
      hashRef.current = response.data_hash;
      // Full and unchanged answers both say when the result was produced. Kept
      // when an answer omits it (an older engine), rather than forgotten.
      const reported = parseIso(response.executed_at)?.getTime();
      if (reported !== undefined) executedAtRef.current = reported;

      setFacts((previous) => {
        const base: PollFacts = {
          ...previous,
          error: null,
          consecutiveErrors: 0,
          inFlight: false,
          pollSeq: previous.pollSeq + 1,
          lastPolledAt: now,
          executedAt: executedAtRef.current,
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

      const force = forceRef.current;
      forceRef.current = false;

      // Only a forced refresh gets this card's own abort signal. A coalesced
      // poll is *shared*, so handing it one consumer's controller lets that
      // consumer cancel a request other cards are waiting on - and, worse, hand
      // them its AbortError as their own failure.
      //
      // That is what made a card hang after saving. React re-runs effects on
      // mount in development: the first run started a poll, the cleanup aborted
      // it, and the second run joined the very promise that had just been
      // aborted and treated the rejection as a real error. The card then sat in
      // "loading" until something re-ran the effect - which is exactly what
      // switching tabs and back did, via the visibility handler.
      //
      // The client applies its own timeout per request, so dropping the signal
      // here costs nothing but the ability to cancel a shared poll early.
      const controller = force ? new AbortController() : null;
      if (force) {
        controllerRef.current?.abort();
        controllerRef.current = controller;
      }

      setFacts((previous) => (previous.inFlight ? previous : { ...previous, inFlight: true }));

      try {
        // Coalesced: several charts of one query are several cards, each with
        // its own loop. Without this they make identical requests on the same
        // interval, which is the waste the query/chart split removed from the
        // engine reappearing in the browser.
        // A published chart is polled by chart id through a path that ignores
        // ownership, because the viewer does not own the query behind it. Same
        // loop, same coalescing, same backoff: only the source differs.
        const fetchPoll = published ? pollPublishedChart : pollQuery;
        const response = await coalescedPoll(
          queryId,
          hashRef.current,
          force,
          () =>
            fetchPoll(
              queryId,
              // A forced refresh must not send since_hash, or the engine
              // answers "unchanged" and the analyst gets nothing for their
              // click.
              force ? { force: true } : { sinceHash: hashRef.current },
              controller ? { signal: controller.signal, timeoutMs } : { timeoutMs },
            ),
        );
        if (stoppedRef.current || controller?.signal.aborted) return;
        applyResponse(response);

        // Aim the next poll at the moment this result goes stale, not an
        // interval from now: the clock is the engine's last run.
        const now = Date.now();
        const executedAt = executedAtRef.current;
        const delay = nextPollDelay(now, executedAt, intervalRef.current, staleStreakRef.current);
        const alreadyStale = executedAt !== null && executedAt + intervalRef.current <= now;
        staleStreakRef.current = alreadyStale ? staleStreakRef.current + 1 : 0;
        schedule(delay);
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

    // Poll now, unless this card already has this query's answer and the next
    // run is not yet due: then wait out what is left. A card that has never had
    // an answer, is in error, or is overdue has nothing to wait for.
    const dueAt = nextPollAtRef.current;
    const remaining =
      dueAt !== null && hashRef.current !== null && errorsRef.current === 0
        ? dueAt - Date.now()
        : 0;
    if (remaining > 0) schedule(Math.min(remaining, MAX_TIMER_MS));
    else runPoll();

    return () => {
      stoppedRef.current = true;
      runPollRef.current = null;
      clearTimer();
      controllerRef.current?.abort();
    };
  }, [queryId, active, published, timeoutMs, maxBackoffMs, fallbackIntervalMs, clearTimer]);

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
    staleStreakRef.current = 0;
    hashRef.current = null;
    clearTimer();
    setFacts((previous) => ({ ...previous, error: null, consecutiveErrors: 0 }));
    run();
  }, [queryId, clearTimer]);

  /**
   * Fetch the whole current result again, running nothing. Clearing the stored
   * hash is what makes the engine send the full payload (with `since_hash` set
   * it would answer "unchanged" even though the chart mapping moved), and not
   * forcing is what keeps it free: the engine answers from its cache.
   */
  const resync = useCallback(() => {
    const run = runPollRef.current;
    if (!queryId || !run) return;
    errorsRef.current = 0;
    staleStreakRef.current = 0;
    hashRef.current = null;
    // The point is a fresh read of the engine's cache; an answer remembered from
    // a moment ago (the coalescer keeps them briefly) is the one thing to avoid.
    invalidateCoalesced(queryId);
    clearTimer();
    run();
  }, [queryId, clearTimer]);

  return useMemo(
    () => ({
      ...facts,
      phase: derivePhase(facts, active),
      inFlight: active && facts.inFlight,
      refresh,
      resync,
    }),
    [facts, active, refresh, resync],
  );
}
