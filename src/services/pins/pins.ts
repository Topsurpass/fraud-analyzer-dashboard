/**
 * Which cards a person has pinned to the top of their boards.
 *
 * A pin is a list of chart ids in the order they were pinned. The order is part
 * of the feature: pinned cards sit at the top in that order and do not move for
 * any reason but being unpinned, so what you pinned first stays first.
 *
 * Pure functions over `string[]`, so the rules are testable without a browser.
 * Storage is `pinStore.ts`.
 */

/** Ids pinned, first pinned first. */
export type PinList = readonly string[];

/** Add the id at the end if absent, remove it if present. */
export function togglePin(pins: PinList, id: string): string[] {
  return pins.includes(id) ? pins.filter((existing) => existing !== id) : [...pins, id];
}

/** The pin order as a lookup: id to position (0 is pinned first). */
export function pinPositions(pins: PinList): ReadonlyMap<string, number> {
  return new Map(pins.map((id, index) => [id, index]));
}

/**
 * Read a stored value defensively.
 *
 * Storage is outside the app's control (another version wrote it, a person edited
 * it, a quota error truncated it), so anything that is not a list of non-empty
 * strings is dropped rather than trusted. Duplicates keep their first position.
 */
export function parsePins(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const pins: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string" || item === "" || seen.has(item)) continue;
    seen.add(item);
    pins.push(item);
  }
  return pins;
}

export function serializePins(pins: PinList): string {
  return JSON.stringify(pins);
}

/** A person's pins live under their own key, so two people on one browser never share. */
export function pinStorageKey(userId: string | null | undefined): string {
  return `fae.pins.v1:${userId ?? "anonymous"}`;
}

/** Cap, so a runaway loop cannot fill storage with ids. */
export const MAX_PINS = 200;
