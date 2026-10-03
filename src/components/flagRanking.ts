import type { FlagOutcome, FlagSeverity } from "@/contracts/api";

/**
 * Putting the cards that need attention first, as plain functions.
 *
 * A board of a dozen charts is scanned top left to bottom right, so a card that
 * has just been flagged is only seen quickly if it is at the top. Everything
 * here is arithmetic on three facts per card (how many rows are flagged, how
 * bad, and when the count last went up), so the rules can be tested without a
 * browser. The component that applies them is `FlagOrder.tsx`.
 */

export interface FlagState {
  /** Flagged rows the reader has not dismissed. Zero means not flagged. */
  count: number;
  /** Worst severity among the matching rules, or null when nothing is flagged. */
  severity: FlagSeverity | null;
  /**
   * Epoch ms of the last poll that found MORE flagged rows than the one before
   * it (or the first poll after none were flagged). Zero when the card was
   * already flagged the first time it was seen during the page's first moments:
   * arriving flagged at page load is not news, and sorting on it would put the
   * whole board in a race to be first.
   */
  since: number;
}

export const UNFLAGGED: FlagState = { count: 0, severity: null, since: 0 };

const SEVERITY_WEIGHT: Record<FlagSeverity, number> = { low: 1, medium: 2, high: 3 };

/** Worst severity among rules that actually matched something. */
export function worstSeverity(flags: Pick<FlagOutcome, "rules"> | undefined): FlagSeverity | null {
  let worst: FlagSeverity | null = null;
  for (const rule of flags?.rules ?? []) {
    if (rule.matched <= 0) continue;
    if (worst === null || SEVERITY_WEIGHT[rule.severity] > SEVERITY_WEIGHT[worst]) {
      worst = rule.severity;
    }
  }
  return worst;
}

/**
 * The state after a poll.
 *
 * `since` moves only when the count rises. A count that falls (rows dismissed)
 * or holds steady keeps its place in the line, so a card does not leap back to
 * the top every poll for still being flagged.
 */
export function nextFlagState(
  previous: FlagState | undefined,
  count: number,
  severity: FlagSeverity | null,
  now: number,
  settled = false,
): FlagState {
  if (count <= 0) return UNFLAGGED;
  // The first time a card is seen. During a page's first moments every card
  // arrives this way and none is news; once the grid has settled, a card that
  // first appears already flagged (added to the board, say) is.
  if (previous === undefined) return { count, severity, since: settled ? now : 0 };
  if (previous.count <= 0) return { count, severity, since: now };
  if (count > previous.count) return { count, severity, since: now };
  return { count, severity, since: previous.since };
}

export function sameFlagState(a: FlagState | undefined, b: FlagState | undefined): boolean {
  const x = a ?? UNFLAGGED;
  const y = b ?? UNFLAGGED;
  return x.count === y.count && x.severity === y.severity && x.since === y.since;
}

/**
 * Order of two cards, negative when `a` goes first.
 *
 * 1. flagged before unflagged;
 * 2. the card flagged most recently first;
 * 3. then the worse severity;
 * 4. then the larger count.
 *
 * Equal on all of these returns zero, and the caller's stable sort keeps the
 * original order, so ties never shuffle from one poll to the next.
 */
export function compareFlagState(a: FlagState, b: FlagState): number {
  const aFlagged = a.count > 0;
  const bFlagged = b.count > 0;
  if (aFlagged !== bFlagged) return aFlagged ? -1 : 1;
  if (!aFlagged) return 0;
  if (a.since !== b.since) return b.since - a.since;
  const severity = SEVERITY_WEIGHT[b.severity ?? "low"] - SEVERITY_WEIGHT[a.severity ?? "low"];
  if (severity !== 0) return severity;
  return b.count - a.count;
}

/**
 * `keys` in display order. Stable: `Array.prototype.sort` is, and the index is
 * the explicit last tiebreak so that does not rest on an engine detail.
 *
 * `pins` (key to place in the pin order) puts pinned cards first, in the order they
 * were pinned, ahead of everything the flag rules decide. A pinned card is fixed:
 * being flagged does not move it, and the cards after the pins sort as before.
 */
export function orderKeys(
  keys: readonly string[],
  states: ReadonlyMap<string, FlagState>,
  pins?: ReadonlyMap<string, number>,
): string[] {
  return keys
    .map((key, index) => ({
      key,
      index,
      state: states.get(key) ?? UNFLAGGED,
      pin: pins?.get(key),
    }))
    .sort((a, b) => {
      if (a.pin !== undefined || b.pin !== undefined) {
        if (a.pin === undefined) return 1;
        if (b.pin === undefined) return -1;
        return a.pin - b.pin || a.index - b.index;
      }
      return compareFlagState(a.state, b.state) || a.index - b.index;
    })
    .map((entry) => entry.key);
}

export interface Box {
  left: number;
  top: number;
}

export interface Shift {
  key: string;
  dx: number;
  dy: number;
}

/**
 * How far each card must be pulled back to look as if it had not moved yet.
 * Cards with no earlier position (new ones) and cards that did not move are
 * left out, so nothing animates that was not displaced.
 */
export function shiftsBetween(
  before: ReadonlyMap<string, Box>,
  after: ReadonlyMap<string, Box>,
): Shift[] {
  const shifts: Shift[] = [];
  for (const [key, now] of after) {
    const was = before.get(key);
    if (!was) continue;
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    shifts.push({ key, dx, dy });
  }
  return shifts;
}

/** Keys whose card went from not flagged to flagged between two applied states. */
export function newlyFlagged(
  before: ReadonlyMap<string, FlagState>,
  after: ReadonlyMap<string, FlagState>,
): string[] {
  const keys: string[] = [];
  for (const [key, state] of after) {
    if (state.count > 0 && (before.get(key)?.count ?? 0) <= 0) keys.push(key);
  }
  return keys;
}
