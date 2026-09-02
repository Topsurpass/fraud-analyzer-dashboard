/**
 * Reduce a series to what a chart can actually show.
 *
 * Recharts draws SVG, so every point is a DOM node. Ten thousand points is ten
 * thousand nodes for a plot maybe 900 pixels wide - ten points fighting over
 * each pixel column, none of which the eye can resolve. It is slow *and* it
 * shows nothing extra.
 *
 * The algorithm is Largest-Triangle-Three-Buckets. Naive decimation (keep every
 * Nth point) is what most dashboards do and it is wrong for this app: the whole
 * job is spotting anomalies, and taking every 10th point drops the spike that
 * the analyst opened the chart to find. LTTB divides the series into buckets
 * and keeps, from each, the point forming the largest triangle with its
 * neighbours - which is a cheap way of saying "keep the points that carry the
 * shape". Spikes survive; flat stretches collapse.
 *
 * First and last points are always kept, so the axis range never moves as a
 * side effect of downsampling.
 *
 * The primitives here return *indices* rather than points, and that is the
 * whole reason this file was reshaped. A caller that starts from database rows
 * used to build 25,000 chart objects and then throw 24,100 of them away; with
 * indices it decides what to keep from a flat array of numbers and materialises
 * only the 900 objects it will draw. The object-shaped helpers below are thin
 * wrappers, kept because a caller holding real points should not have to think
 * about indices.
 */

/** Above this, a plot is drawing more points than a screen has pixels. */
export const MAX_PLOT_POINTS = 900;

/**
 * Series a cartesian plot draws before the tail is folded into one bucket.
 *
 * Bounded by the palette rather than by pixels. `seriesColor` clamps past the
 * end of the five-colour ramp, so a sixth series is drawn in the fifth series'
 * colour and the two cannot be told apart - forty terminals on one plot is
 * thirty-six lines of identical green, plus forty marks at every x position,
 * which is 25,000 SVG nodes on a 900-pixel plot.
 *
 * Must equal `MAX_SERIES` in `components/charts/theme.ts`, which is where the
 * ramp itself lives; `shape.test.ts` asserts they have not drifted apart.
 */
export const MAX_PLOT_SERIES = 5;

/**
 * What the folded tail of series is called. Matches `OTHER_LABEL` in
 * `components/charts/theme.ts`, so the pie's folded wedge and a line chart's
 * folded series read as the same idea; `shape.test.ts` asserts they match.
 */
export const OTHER_SERIES_LABEL = "Other";

/**
 * The indices LTTB keeps, ascending.
 *
 * Returns null - rather than "every index" - when the series already fits, so
 * a caller can skip rebuilding an array it was going to use whole.
 */
export function downsampleIndicesLTTB(
  count: number,
  valueAt: (index: number) => number,
  threshold: number,
): number[] | null {
  if (threshold >= count || threshold < 3) return null;

  const kept: number[] = [0];
  // Every bucket but the first and last, which are the pinned endpoints.
  const bucketSize = (count - 2) / (threshold - 2);

  let anchorIndex = 0;
  for (let bucket = 0; bucket < threshold - 2; bucket += 1) {
    const nextStart = Math.floor((bucket + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((bucket + 2) * bucketSize) + 1, count);

    // The next bucket's average stands in for "where the line is heading".
    let avgX = 0;
    let avgY = 0;
    const nextCount = Math.max(1, nextEnd - nextStart);
    for (let i = nextStart; i < nextEnd; i += 1) {
      avgX += i;
      avgY += valueAt(i) || 0;
    }
    avgX /= nextCount;
    avgY /= nextCount;

    const start = Math.floor(bucket * bucketSize) + 1;
    const end = Math.min(Math.floor((bucket + 1) * bucketSize) + 1, count);

    const anchorX = anchorIndex;
    const anchorY = valueAt(anchorIndex) || 0;

    let bestArea = -1;
    let bestIndex = start;
    for (let i = start; i < end; i += 1) {
      const y = valueAt(i) || 0;
      // Twice the triangle's area; the factor is constant so it never affects
      // which point wins.
      const area = Math.abs(
        (anchorX - avgX) * (y - anchorY) - (anchorX - i) * (avgY - anchorY),
      );
      if (area > bestArea) {
        bestArea = area;
        bestIndex = i;
      }
    }

    kept.push(bestIndex);
    anchorIndex = bestIndex;
  }

  kept.push(count - 1);
  return kept;
}

/**
 * The indices LTTB keeps, plus every flagged index, ascending.
 *
 * The plain algorithm optimises for shape, and a single flagged row in ten
 * thousand is not shape - it is the finding. Dropping it would make the chart
 * disagree with the table beside it about what was flagged, which is worse than
 * a slow chart.
 *
 * Flagged points are usually a handful, so the shape budget is reduced by their
 * count and the two ascending lists are merged, rather than complicating the
 * bucket loop. The result is never longer than `threshold`.
 */
export function downsampleIndicesPreservingAlerts(
  count: number,
  valueAt: (index: number) => number,
  isAlertAt: (index: number) => boolean,
  threshold: number,
): number[] | null {
  if (count <= threshold) return null;

  const alerts: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (isAlertAt(i)) alerts.push(i);
  }

  // Every point is flagged, or so many are that preserving them defeats the
  // purpose: fall back to plain downsampling rather than returning everything.
  if (alerts.length >= threshold) return downsampleIndicesLTTB(count, valueAt, threshold);

  const shape = downsampleIndicesLTTB(count, valueAt, threshold - alerts.length);
  // The flagged points alone have eaten the budget; keeping the series whole is
  // the honest answer, and it is what the object-shaped version always did.
  if (shape === null) return null;
  if (alerts.length === 0) return shape;

  // Merge two ascending lists, deduped. Merging indices rather than deduping
  // the points themselves also fixes a real hazard in the object version: a
  // Set of points treats two equal primitives, or one object appearing twice,
  // as the same point and silently drops the duplicate.
  const merged: number[] = [];
  let left = 0;
  let right = 0;
  while (left < shape.length || right < alerts.length) {
    const a = left < shape.length ? shape[left] : Number.POSITIVE_INFINITY;
    const b = right < alerts.length ? alerts[right] : Number.POSITIVE_INFINITY;
    if (a === b) {
      merged.push(a);
      left += 1;
      right += 1;
    } else if (a < b) {
      merged.push(a);
      left += 1;
    } else {
      merged.push(b);
      right += 1;
    }
  }
  return merged;
}

/** Pick `indices` out of `points`, in order. */
function pick<T>(points: readonly T[], indices: readonly number[]): T[] {
  const out: T[] = new Array(indices.length);
  for (let i = 0; i < indices.length; i += 1) out[i] = points[indices[i]];
  return out;
}

export function downsampleLTTB<T>(
  points: readonly T[],
  threshold: number,
  valueOf: (point: T) => number,
): readonly T[] {
  const kept = downsampleIndicesLTTB(points.length, (index) => valueOf(points[index]), threshold);
  return kept === null ? points : pick(points, kept);
}

/** Downsample while keeping every flagged point. */
export function downsamplePreservingAlerts<T>(
  points: readonly T[],
  threshold: number,
  valueOf: (point: T) => number,
  isAlert: (point: T) => boolean,
): readonly T[] {
  const kept = downsampleIndicesPreservingAlerts(
    points.length,
    (index) => valueOf(points[index]),
    (index) => isAlert(points[index]),
    threshold,
  );
  return kept === null ? points : pick(points, kept);
}
