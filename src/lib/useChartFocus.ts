"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Which categories a small-multiples chart is currently narrowed to.
 *
 * Unlike `useExpandedCards`, this *is* persisted. Expanding a card is a
 * momentary "let me look at this one properly"; narrowing thirty-one terminals
 * down to the four under investigation is a working set, and re-picking it out
 * of a long list after every reload is the kind of friction that makes a
 * feature go unused. An empty set means "no narrowing", which is also the state
 * a first-time reader gets.
 *
 * Storage is keyed by chart id, so two charts of the same query keep separate
 * selections - the whole point of several charts on one result is that they are
 * looked at differently.
 *
 * Modelled as an external store for the same reason `FlaggedBell` is: reading
 * `localStorage` during render differs between the server pass and the client
 * one, and reading it in an effect and calling setState is the same thing with
 * an extra render and a lint rule against it. `useSyncExternalStore` gives a
 * server snapshot of "nothing selected" and a client snapshot of what is
 * stored.
 */

const PREFIX = "fae.chart-focus.";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Snapshots must be referentially stable or `useSyncExternalStore` re-renders
 * forever, and parsing JSON hands back a new Set every call. Caching against
 * the raw string means the identity only changes when the stored value does.
 */
const cache = new Map<string, { raw: string | null; value: ReadonlySet<string> }>();
const EMPTY: ReadonlySet<string> = new Set<string>();

function readRaw(key: string): string | null {
  // Private windows, cleared site data and browsers set to block storage all
  // throw here rather than returning null.
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function parse(raw: string | null): ReadonlySet<string> {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    // Corrupt storage reads as "no selection" rather than breaking the chart.
    return EMPTY;
  }
}

function snapshot(key: string): ReadonlySet<string> {
  const raw = readRaw(key);
  const cached = cache.get(key);
  if (cached && cached.raw === raw) return cached.value;
  const value = parse(raw);
  cache.set(key, { raw, value });
  return value;
}

function write(key: string, values: readonly string[]): void {
  try {
    if (values.length === 0) window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, JSON.stringify(values));
  } catch {
    // A selection that cannot be saved is still worth honouring for this
    // session, so a storage failure is not worth surfacing. The cache below
    // keeps the chart in the state the reader asked for either way.
    cache.set(key, { raw: null, value: new Set(values) });
  }
  for (const listener of listeners) listener();
}

export interface ChartFocus {
  /** The chosen categories. Empty means every category is shown. */
  selected: ReadonlySet<string>;
  isSelected: (category: string) => boolean;
  toggle: (category: string) => void;
  clear: () => void;
}

export function useChartFocus(chartId: string | null | undefined): ChartFocus {
  const key = chartId ?? "unknown";

  const selected = useSyncExternalStore(
    subscribe,
    () => snapshot(key),
    () => EMPTY,
  );

  const toggle = useCallback(
    (category: string) => {
      const next = new Set(snapshot(key));
      if (next.has(category)) next.delete(category);
      else next.add(category);
      write(key, [...next]);
    },
    [key],
  );

  const clear = useCallback(() => write(key, []), [key]);

  const isSelected = useCallback(
    (category: string) => selected.has(category),
    [selected],
  );

  return useMemo(
    () => ({ selected, isSelected, toggle, clear }),
    [selected, isSelected, toggle, clear],
  );
}
