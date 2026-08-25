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
 */

/** Above this, a plot is drawing more points than a screen has pixels. */
export const MAX_PLOT_POINTS = 900;

export function downsampleLTTB<T>(
  points: readonly T[],
  threshold: number,
  valueOf: (point: T) => number,
): readonly T[] {
  const total = points.length;
  if (threshold >= total || threshold < 3) return points;

  const kept: T[] = [points[0]];
  // Every bucket but the first and last, which are the pinned endpoints.
  const bucketSize = (total - 2) / (threshold - 2);

  let anchorIndex = 0;
  for (let bucket = 0; bucket < threshold - 2; bucket++) {
    const nextStart = Math.floor((bucket + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((bucket + 2) * bucketSize) + 1, total);

    // The next bucket's average stands in for "where the line is heading".
    let avgX = 0;
    let avgY = 0;
    const nextCount = Math.max(1, nextEnd - nextStart);
    for (let i = nextStart; i < nextEnd; i++) {
      avgX += i;
      avgY += valueOf(points[i]) || 0;
    }
    avgX /= nextCount;
    avgY /= nextCount;

    const start = Math.floor(bucket * bucketSize) + 1;
    const end = Math.min(Math.floor((bucket + 1) * bucketSize) + 1, total);

    const anchorX = anchorIndex;
    const anchorY = valueOf(points[anchorIndex]) || 0;

    let bestArea = -1;
    let bestIndex = start;
    for (let i = start; i < end; i++) {
      const y = valueOf(points[i]) || 0;
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

    kept.push(points[bestIndex]);
    anchorIndex = bestIndex;
  }

  kept.push(points[total - 1]);
  return kept;
}

/**
 * Downsample while keeping every flagged point.
 *
 * The plain algorithm optimises for shape, and a single flagged row in ten
 * thousand is not shape - it is the finding. Dropping it would make the chart
 * disagree with the table beside it about what was flagged, which is worse than
 * a slow chart.
 *
 * Flagged points are usually a handful, so they are re-inserted in order after
 * the fact rather than complicating the bucket loop.
 */
export function downsamplePreservingAlerts<T>(
  points: readonly T[],
  threshold: number,
  valueOf: (point: T) => number,
  isAlert: (point: T) => boolean,
): readonly T[] {
  if (points.length <= threshold) return points;

  const alerts: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (isAlert(points[i])) alerts.push(i);
  }

  // Every point is flagged, or so many are that preserving them defeats the
  // purpose: fall back to plain downsampling rather than returning everything.
  if (alerts.length >= threshold) {
    return downsampleLTTB(points, threshold, valueOf);
  }

  const shape = downsampleLTTB(points, threshold - alerts.length, valueOf);
  if (alerts.length === 0) return shape;

  const chosen = new Set<T>(shape);
  for (const index of alerts) chosen.add(points[index]);

  // Rebuilt by scanning the original once, so the result keeps x order without
  // a comparator that would have to know what x is.
  return points.filter((point) => chosen.has(point));
}
