"use client";

import { useCallback, useEffect, useState } from "react";
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
 * The second request only ever happens on the unhappy path, so the steady state
 * is one request per interval, exactly as before.
 */
export function useEngineHealth(intervalMs = 30_000): EngineHealth {
  const [status, setStatus] = useState<EngineStatus>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    const settle = (next: EngineStatus, note: string | null) => {
      if (!live) return;
      setStatus(next);
      setMessage(note);
      setCheckedAt(Date.now());
    };

    const run = async () => {
      try {
        await ready({ signal: controller.signal });
        settle("ok", null);
        return;
      } catch (cause) {
        if (cause instanceof ApiError && cause.kind === "aborted") return;

        // The engine's own sentence when it managed to answer at all. A 503
        // here says "reachable, but its database is not", which is a different
        // call to action from "nothing answered".
        const why = cause instanceof ApiError ? cause.displayMessage : "Unreachable";

        try {
          await health({ signal: controller.signal });
          settle("degraded", `${why.replace(/\.?$/, "")}. The process is up but cannot serve.`);
        } catch (alsoCause) {
          if (alsoCause instanceof ApiError && alsoCause.kind === "aborted") return;
          settle("down", why);
        }
      }
    };

    void run();
    const timer = setInterval(() => void run(), intervalMs);
    return () => {
      live = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [intervalMs, nonce]);

  const check = useCallback(() => setNonce((count) => count + 1), []);

  return { status, message, checkedAt, check };
}
