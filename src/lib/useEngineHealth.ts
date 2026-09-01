"use client";

import { useCallback, useSyncExternalStore } from "react";
import { ApiError, health, ready } from "@/services/api-client";

/**
 * `degraded` is the state this readout exists for: the process is answering,
 * and it still cannot serve a request.
 */
export type EngineStatus = "checking" | "ok" | "degraded" | "down";

export interface EngineHealth {
  status: EngineStatus;
  message: string | null;
  checkedAt: number | null;
  check: () => void;
}

/**
 * The single global readout, in the rail and in the top bar on a phone.
 *
 * It asks both of the engine's probes, because they answer different questions
 * and neither alone is the question a person looking at this light is asking.
 *
 * `/health` is liveness and deliberately checks nothing - the engine's own note
 * on it says a probe that fails on a database outage turns a dependency outage
 * into a restart loop. So it answers 200 from a process whose app-state
 * database is unreachable and whose every real request is 500-ing, and a green
 * light through it is worse than no light at all.
 *
 * `/ready` runs a `SELECT 1` against that database and answers 503
 * SERVICE_NOT_READY when it cannot. That is the one to lead with. But a failed
 * `/ready` on its own still cannot tell "the engine is gone" from "the engine
 * is up and its storage is unhappy" - and those need different people. So a
 * failed readiness check falls through to liveness, and the difference between
 * the two answers is what the middle state reports.
 *
 * The second request only ever happens on the unhappy path, so the steady
 * state is one request per interval.
 *
 * ## One poll for the whole page
 *
 * "Single global readout" was the intent and not what the code did. Every
 * caller ran its own timer and its own request, and there are three of them:
 * the top bar, the rail, and the rail again inside the mobile drawer. React's
 * development double-invoke made that six. Measured against the running engine
 * it was twelve requests a minute for a thirty-second poll.
 *
 * So the state lives at module scope with one timer behind it, and the hook
 * subscribes rather than polls. Call sites are unchanged: mount as many
 * readouts as the layout wants and the engine still sees one request per
 * interval. The timer starts with the first subscriber and stops with the
 * last, so a page showing no readout polls nothing at all.
 */

const DEFAULT_INTERVAL_MS = 30_000;

interface Snapshot {
  status: EngineStatus;
  message: string | null;
  checkedAt: number | null;
}

/**
 * Held as one frozen object rather than three loose values, because
 * `useSyncExternalStore` compares snapshots by identity. Building a fresh
 * object per read would re-render every subscriber on every render.
 */
let snapshot: Snapshot = { status: "checking", message: null, checkedAt: null };

/** The server has no engine to ask, and must not invent an answer. */
const SERVER_SNAPSHOT: Snapshot = { status: "checking", message: null, checkedAt: null };

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let controller: AbortController | null = null;

function publish(next: Snapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

async function runCheck(): Promise<void> {
  // One flight at a time. A slow engine and a fast interval would otherwise
  // queue checks behind each other, which is the pile-up this readout would be
  // reporting if it happened anywhere else.
  controller?.abort();
  const own = new AbortController();
  controller = own;

  const settle = (status: EngineStatus, message: string | null) => {
    // A superseded check must not publish over a newer answer.
    if (controller !== own) return;
    publish({ status, message, checkedAt: Date.now() });
  };

  try {
    await ready({ signal: own.signal });
    settle("ok", null);
    return;
  } catch (cause) {
    if (cause instanceof ApiError && cause.kind === "aborted") return;

    // The engine's own sentence when it managed to answer at all. A 503 here
    // says "reachable, but its database is not", which is a different call to
    // action from "nothing answered".
    const why = cause instanceof ApiError ? cause.displayMessage : "Unreachable";

    try {
      await health({ signal: own.signal });
      settle("degraded", `${why.replace(/\.?$/, "")}. The process is up but cannot serve.`);
    } catch (alsoCause) {
      if (alsoCause instanceof ApiError && alsoCause.kind === "aborted") return;
      settle("down", why);
    }
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // The first subscriber starts the poll, and checks immediately rather than
  // waiting out an interval: somebody who just opened the page is asking about
  // now, not about thirty seconds from now.
  if (listeners.size === 1) {
    void runCheck();
    timer = setInterval(() => void runCheck(), DEFAULT_INTERVAL_MS);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;

    // Last one out stops the timer and abandons any flight, so a page with no
    // readout on it costs nothing.
    if (timer !== null) clearInterval(timer);
    timer = null;
    controller?.abort();
    controller = null;
  };
}

export function useEngineHealth(): EngineHealth {
  const current = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );

  // Shared, so pressing refresh in the rail updates the top bar too. They are
  // one readout and always were meant to be.
  const check = useCallback(() => void runCheck(), []);

  return { ...current, check };
}

/** Reset the shared poll. Tests only, so one case cannot leak into the next. */
export function resetEngineHealth(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  controller?.abort();
  controller = null;
  listeners.clear();
  snapshot = { status: "checking", message: null, checkedAt: null };
}
