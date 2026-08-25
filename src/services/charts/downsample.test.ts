import { describe, expect, it } from "vitest";
import {
  MAX_PLOT_POINTS,
  downsampleLTTB,
  downsamplePreservingAlerts,
} from "./downsample";

/**
 * Downsampling is a lie the chart tells to stay fast, so the tests are about
 * which lies are acceptable. Dropping a flat stretch is fine. Dropping the
 * spike an analyst opened the chart to find is not.
 */

type Point = { x: number; y: number; alert?: boolean };

const valueOf = (point: Point) => point.y;
const isAlert = (point: Point) => point.alert === true;

function flat(count: number): Point[] {
  return Array.from({ length: count }, (_, x) => ({ x, y: 10 }));
}

describe("downsampleLTTB", () => {
  it("leaves a series that already fits alone", () => {
    const points = flat(50);
    expect(downsampleLTTB(points, 900, valueOf)).toBe(points);
  });

  it("returns no more than the threshold", () => {
    expect(downsampleLTTB(flat(10_000), 900, valueOf)).toHaveLength(900);
  });

  it("keeps the first and last point, so the axis range cannot move", () => {
    const points = flat(5_000).map((point, x) => ({ ...point, y: x }));
    const kept = downsampleLTTB(points, 100, valueOf);
    expect(kept[0]).toBe(points[0]);
    expect(kept[kept.length - 1]).toBe(points[points.length - 1]);
  });

  it("keeps a spike that naive decimation would drop", () => {
    // The point of using LTTB at all: every 10th point misses this entirely.
    const points = flat(5_000);
    points[2_503] = { x: 2_503, y: 9_999 };
    const kept = downsampleLTTB(points, 200, valueOf);
    expect(kept.some((point) => point.y === 9_999)).toBe(true);
  });

  it("preserves x order", () => {
    const points = flat(3_000).map((point, x) => ({ ...point, y: Math.sin(x) * 100 }));
    const kept = downsampleLTTB(points, 250, valueOf);
    const xs = kept.map((point) => point.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it("refuses a threshold too small to describe anything", () => {
    const points = flat(1_000);
    expect(downsampleLTTB(points, 2, valueOf)).toBe(points);
  });

  it("survives non-finite values rather than producing NaN geometry", () => {
    // A NULL in a numeric column arrives as NaN after coercion.
    const points = flat(2_000).map((point, x) => ({
      ...point,
      y: x % 97 === 0 ? Number.NaN : point.y,
    }));
    const kept = downsampleLTTB(points, 100, valueOf);
    expect(kept).toHaveLength(100);
  });

  it("scales linearly, so a bigger result cannot fall off a cliff", () => {
    // The failure this guards is an accidental quadratic - a nested scan over
    // the bucket, say - which would be invisible at 1,000 points and lock the
    // tab at 100,000.
    //
    // Asserting a wall-clock budget instead was flaky: the first call includes
    // JIT warm-up, so a cold 50k run measured *slower* than a warm 200k one.
    // The ratio between two warm runs is the property that actually matters.
    const build = (count: number) =>
      Array.from({ length: count }, (_, x) => ({ x, y: Math.sin(x / 20) }));

    const time = (count: number) => {
      const points = build(count);
      const started = performance.now();
      downsampleLTTB(points, MAX_PLOT_POINTS, valueOf);
      return performance.now() - started;
    };

    time(50_000); // warm the JIT; this measurement is discarded
    const small = Math.max(time(50_000), 1);
    const large = Math.max(time(200_000), 1);

    // Linear would be ~4x for 4x the data. Ten leaves room for a noisy machine
    // while still catching a quadratic, which would be ~16x.
    expect(large / small).toBeLessThan(10);
  });
});

describe("downsamplePreservingAlerts", () => {
  it("keeps every flagged point", () => {
    // A flagged row missing from the chart would disagree with the table
    // beside it about what was flagged, which is worse than a slow chart.
    const points = flat(10_000);
    for (const index of [17, 4_242, 9_998]) points[index] = { x: index, y: 5, alert: true };

    const kept = downsamplePreservingAlerts(points, 500, valueOf, isAlert);
    expect(kept.filter(isAlert)).toHaveLength(3);
  });

  it("stays within the threshold overall", () => {
    const points = flat(10_000);
    for (let i = 0; i < 40; i++) points[i * 130] = { x: i * 130, y: 5, alert: true };
    expect(downsamplePreservingAlerts(points, 500, valueOf, isAlert).length).toBeLessThanOrEqual(
      500,
    );
  });

  it("keeps x order after re-inserting the flagged points", () => {
    const points = flat(6_000);
    for (const index of [5, 3_000, 5_999]) points[index] = { x: index, y: 1, alert: true };
    const xs = downsamplePreservingAlerts(points, 300, valueOf, isAlert).map((p) => p.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it("falls back to plain downsampling when nearly everything is flagged", () => {
    // Preserving them all would defeat the purpose and return the whole series.
    const points = flat(2_000).map((point) => ({ ...point, alert: true }));
    expect(downsamplePreservingAlerts(points, 100, valueOf, isAlert)).toHaveLength(100);
  });

  it("leaves a small series untouched", () => {
    const points = flat(20);
    expect(downsamplePreservingAlerts(points, 900, valueOf, isAlert)).toBe(points);
  });
});
