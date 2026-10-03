"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useOptionalUser } from "@/services/auth/AuthContext";
import {
  MAX_PINS,
  parsePins,
  pinPositions,
  pinStorageKey,
  serializePins,
  togglePin,
  type PinList,
} from "./pins";

/**
 * Pins, kept in this browser under the signed-in person's own key.
 *
 * `localStorage`, not the engine: a pin is a reading preference, like which cards
 * are expanded, and it needs no migration and no round trip. The cost is that pins
 * do not follow a person to another browser; if that matters, this file is the one
 * place to swap for an engine-backed store.
 *
 * Read every time through `useSyncExternalStore`, so a pin made in one card shows
 * in every grid at once and in other tabs (via the `storage` event). Storage can
 * fail (private windows, quota, blocked site data), so every read and write is
 * guarded and the pins fall back to memory for the life of the page rather than
 * throwing.
 */

const EMPTY: PinList = Object.freeze([]);
const listeners = new Set<() => void>();
/** The latest pins per key, so a failed write still shows on screen. */
const memory = new Map<string, PinList>();
/** Parsed lists, cached by the raw string they came from, so snapshots are stable. */
const parsed = new Map<string, { raw: string | null; pins: PinList }>();

function read(key: string): PinList {
  const kept = memory.get(key);
  if (kept) return kept;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return EMPTY;
  }
  const cached = parsed.get(key);
  if (cached && cached.raw === raw) return cached.pins;
  const pins = raw === null ? EMPTY : Object.freeze(parsePins(raw));
  parsed.set(key, { raw, pins });
  return pins;
}

function write(key: string, pins: PinList) {
  memory.set(key, pins);
  try {
    window.localStorage.setItem(key, serializePins(pins));
    // Stored fine: the stored copy is the truth again, and other tabs follow it.
    memory.delete(key);
    parsed.set(key, { raw: serializePins(pins), pins });
  } catch {
    // Kept in memory above.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith("fae.pins.v1:")) {
      parsed.clear();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export interface Pins {
  /** Chart id to place in the pin order (0 is pinned first). */
  positions: ReadonlyMap<string, number>;
  isPinned: (id: string) => boolean;
  toggle: (id: string) => void;
}

const NO_PINS: Pins = {
  positions: new Map(),
  isPinned: () => false,
  toggle: () => {},
};

/** Pins for the signed-in person. Nothing pinned, and nothing stored, when nobody is. */
export function usePins(): Pins {
  const user = useOptionalUser();
  const key = user ? pinStorageKey(user.id) : null;

  const list = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : EMPTY),
    () => EMPTY,
  );

  const toggle = useCallback(
    (id: string) => {
      if (!key) return;
      const next = togglePin(read(key), id);
      // A cap, so unpinning always works but pinning past it is a no-op.
      if (next.length > MAX_PINS) return;
      write(key, next);
    },
    [key],
  );

  return useMemo<Pins>(() => {
    if (!key) return NO_PINS;
    const positions = pinPositions(list);
    return { positions, isPinned: (id) => positions.has(id), toggle };
  }, [key, list, toggle]);
}

/** For tests: forget everything held in memory. */
export function resetPinStore(): void {
  memory.clear();
  parsed.clear();
  for (const listener of listeners) listener();
}
