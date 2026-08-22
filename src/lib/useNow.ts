"use client";

import { useEffect, useState } from "react";

/**
 * A clock that ticks, for relative timestamps like "4s ago".
 *
 * Formatting helpers take `now` as an argument so they stay pure and testable;
 * this supplies it. One second is the right cadence: the readouts it feeds are
 * measured in seconds, and anything faster is re-rendering for nothing.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
