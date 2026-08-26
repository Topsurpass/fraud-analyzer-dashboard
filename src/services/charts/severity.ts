/**
 * Deciding when a movement is worth an analyst's attention.
 *
 * The judgement is a percentage against a threshold, and a percentage rather
 * than an absolute figure for a specific reason: terminals do not carry
 * comparable volume. One does twenty times another's, so a jump of a million
 * naira is a rounding error on the busiest terminal and an emergency on the
 * quietest. A proportional change is the only comparison that means the same
 * thing across a fleet.
 *
 * Everything here is pure and same-input-same-output, so it is gate-test work
 * rather than anything the model should be deciding at render time.
 *
 * One honest limitation, stated so it is not discovered as a surprise: a fixed
 * threshold knows nothing about time of day. Transaction volume has a strong
 * daily rhythm, so an overnight fall large enough to cross the threshold will
 * be flagged on every terminal at once even though it is the most ordinary
 * thing in the data. That is why the threshold is configurable per chart - a
 * card watching business hours and a card watching the night want different
 * numbers.
 */

/** How a single change reads against the threshold. */
export type ChangeSeverity = "surge" | "drop" | "normal";

export interface ChangeVerdict {
  severity: ChangeSeverity;
  /**
   * Proportional change as a fraction: 0.5 is a 50% rise. Null when it cannot
   * be computed, which is only ever the case when the previous value was zero.
   */
  pctChange: number | null;
  /**
   * True when the previous window was zero and the current one is not.
   *
   * Kept separate from a large `pctChange` because it is a different finding.
   * A terminal that was completely idle and is now transacting has no ratio -
   * anything divided by zero is undefined, and reporting "up 100%" or
   * "up infinity%" would be inventing a number. It is still one of the most
   * interesting things a fraud queue can see, so it counts as a surge on its
   * own terms.
   */
  fromNothing: boolean;
  /** True when the previous window had activity and the current one has none. */
  toNothing: boolean;
  /** The magnitude, in percent, this was judged against. */
  threshold: number;
}

/**
 * Fallback when a chart carries no threshold of its own and the engine did not
 * resolve one. The engine normally supplies this on every chart spec, so this
 * only applies to a payload built before the field existed.
 */
export const DEFAULT_SURGE_THRESHOLD_PCT = 50;

/** A threshold is a positive magnitude; anything else falls back to the default. */
export function resolveThreshold(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_SURGE_THRESHOLD_PCT;
}

/**
 * Judge one previous/current pair against a threshold magnitude.
 *
 * The threshold covers both directions: 50 flags a rise of 50% or more and a
 * fall of 50% or more. A fraud queue cares about both - a terminal that stops
 * dead is as much a finding as one that triples.
 */
export function judgeChange(
  previous: number | null,
  current: number | null,
  threshold: number,
): ChangeVerdict {
  const limit = resolveThreshold(threshold);
  const blank: ChangeVerdict = {
    severity: "normal",
    pctChange: null,
    fromNothing: false,
    toNothing: false,
    threshold: limit,
  };

  // A missing value is not a zero. Only the query knows whether a bucket with
  // no rows means "idle" or "not reported", so nothing is claimed about it.
  if (previous === null || current === null) return blank;
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return blank;

  if (previous === 0) {
    // 0 -> 0 is genuinely no change; 0 -> anything has no ratio at all.
    if (current === 0) return blank;
    return { ...blank, severity: "surge", fromNothing: true };
  }

  const pctChange = (current - previous) / Math.abs(previous);
  const magnitude = Math.abs(pctChange) * 100;
  const toNothing = current === 0;

  if (magnitude + 1e-9 < limit) {
    return { ...blank, pctChange, toNothing };
  }

  return {
    ...blank,
    severity: pctChange > 0 ? "surge" : "drop",
    pctChange,
    toNothing,
  };
}

/**
 * The indices where a value jumped past the threshold from the bucket directly
 * before it.
 *
 * This is the "last hour against this hour" reading, as distinct from the
 * window-over-window totals: a terminal whose six-hour total barely moved can
 * still have gone from four transactions to four hundred in the most recent
 * hour, and that hour is the one worth opening.
 *
 * Strictly consecutive, and only where both buckets have a value. Comparing
 * across a gap would silently span an unknown amount of time - "this hour
 * against some earlier hour" is not the claim being made, and a chart that
 * quietly widens its own comparison window is a chart that lies.
 */
export function bucketSurges(
  values: readonly (number | null)[],
  threshold: number,
): { index: number; verdict: ChangeVerdict }[] {
  const found: { index: number; verdict: ChangeVerdict }[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const verdict = judgeChange(values[index - 1], values[index], threshold);
    if (verdict.severity !== "normal") found.push({ index, verdict });
  }
  return found;
}

/**
 * The change as an analyst would say it: a signed percentage, or the honest
 * absence of one.
 *
 * Never returns a bare number, because a percentage with no sign reads as a
 * level rather than a movement.
 */
export function changeLabel(verdict: ChangeVerdict): string {
  if (verdict.fromNothing) return "from nothing";
  if (verdict.pctChange === null) return "no change";
  const pct = Math.abs(verdict.pctChange) * 100;
  if (pct < 0.05) return "flat";
  const rounded = pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${verdict.pctChange > 0 ? "+" : "−"}${rounded}%`;
}
