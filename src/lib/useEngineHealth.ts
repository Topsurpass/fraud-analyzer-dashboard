"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, health } from "@/services/api-client";

export type EngineStatus = "checking" | "ok" | "down";

export interface EngineHealth {
  status: EngineStatus;
  message: string | null;
  checkedAt: number | null;
  check: () => void;
}

/**
 * The single global readout in the top bar.
 *
 * `/health` is the one endpoint that does not touch a database, so it separates
 * "the engine is down" from "the engine is up but its storage is unhappy" -
 * which is precisely the failure this backend has shown in deployment.
 */
export function useEngineHealth(intervalMs = 30_000): EngineHealth {
  const [status, setStatus] = useState<EngineStatus>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    const run = () => {
      health({ signal: controller.signal })
        .then(() => {
          if (!live) return;
          setStatus("ok");
          setMessage(null);
          setCheckedAt(Date.now());
        })
        .catch((cause) => {
          if (!live) return;
          if (cause instanceof ApiError && cause.kind === "aborted") return;
          setStatus("down");
          setMessage(cause instanceof ApiError ? cause.displayMessage : "Unreachable");
          setCheckedAt(Date.now());
        });
    };

    run();
    const timer = setInterval(run, intervalMs);
    return () => {
      live = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [intervalMs, nonce]);

  const check = useCallback(() => setNonce((count) => count + 1), []);

  return { status, message, checkedAt, check };
}
