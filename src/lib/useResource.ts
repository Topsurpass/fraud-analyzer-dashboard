"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/services/api-client";

/**
 * One-shot data loading with cancellation and an explicit reload.
 *
 * Deliberately not a cache. The live surfaces of this app poll through
 * `useQueryPolling`; everything else - connection lists, schema, saved query
 * metadata - is loaded when a page opens and reloaded when the user changes it.
 * Adding a cache layer here would mean two sources of truth for freshness.
 *
 * `load` must be referentially stable, so wrap it in `useCallback`.
 */
export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  /** True on first load and while a reload is in flight. */
  loading: boolean;
  /** True only before the first successful load. */
  initial: boolean;
  reload: () => void;
}

export function useResource<T>(load: (signal: AbortSignal) => Promise<T>): Resource<T> {
  const [requested, setRequested] = useState(0);
  const [settled, setSettled] = useState(-1);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    load(controller.signal)
      .then((result) => {
        if (!live) return;
        setData(result);
        setError(null);
        setSettled(requested);
      })
      .catch((cause) => {
        if (!live) return;
        // An abort is this hook cancelling itself, not a failure to report.
        if (cause instanceof ApiError && cause.kind === "aborted") return;
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError({
                kind: "network",
                message: cause instanceof Error ? cause.message : "Request failed",
                url: "",
              }),
        );
        setSettled(requested);
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [load, requested]);

  const reload = useCallback(() => setRequested((count) => count + 1), []);

  return {
    data,
    error,
    loading: settled !== requested,
    initial: settled < 0,
    reload,
  };
}
