import { describe, expect, it } from "vitest";
import {
  MAX_PLOT_POINTS,
  downsampleIndicesPreservingAlerts,
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

  it("completes on a result far larger than any query returns", () => {
    // The failure this guards is an accidental quadratic - a nested scan over
    // the bucket, say - which is invisible at 1,000 points and locks the tab at
    // 200,000.
    //
    // Two earlier versions of this test were flaky: a wall-clock budget was
    // really measuring JIT warm-up (a cold 50k run took 66ms, a warm 200k run
    // took 16ms), and a ratio between two warm runs still moved with machine
    // load. The bound here is deliberately enormous - linear finishes in
    // milliseconds, quadratic on 200k would take minutes - so it can only fail
    // for the reason it names.
    const points = Array.from({ length: 200_000 }, (_, x) => ({
      x,
      y: Math.sin(x / 20),
    }));

    const started = performance.now();
    const kept = downsampleLTTB(points, MAX_PLOT_POINTS, valueOf);
    const elapsed = performance.now() - started;

    expect(kept).toHaveLength(MAX_PLOT_POINTS);
    expect(elapsed).toBeLessThan(10_000);
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

describe("downsampleIndicesPreservingAlerts", () => {
  const valueAt = (points: Point[]) => (index: number) => points[index].y;
  const alertAt = (points: Point[]) => (index: number) => points[index].alert === true;

  it("returns null rather than every index when the series already fits", () => {
    // Null is what lets a caller skip rebuilding an array it will use whole.
    const points = flat(50);
    expect(
      downsampleIndicesPreservingAlerts(points.length, valueAt(points), alertAt(points), 900),
    ).toBeNull();
  });

  it("hands back ascending indices inside the threshold", () => {
    const points = flat(10_000);
    for (const index of [11, 5_555, 9_999]) points[index] = { x: index, y: 3, alert: true };

    const kept = downsampleIndicesPreservingAlerts(
      points.length,
      valueAt(points),
      alertAt(points),
      500,
    );

    expect(kept).not.toBeNull();
    expect(kept!.length).toBeLessThanOrEqual(500);
    expect([...kept!].sort((a, b) => a - b)).toEqual(kept);
    for (const index of [11, 5_555, 9_999]) expect(kept).toContain(index);
  });

  it("holds the threshold on a series of repeated values", () => {
    /*
     * The object-shaped version deduped through a Set of the points
     * themselves, so a series of primitives collapsed to its set of distinct
     * values: a flat run of 5,000 sevens matched `chosen.has(7)` at every
     * position and the "downsampled" series came back 5,000 long - the bound
     * this whole module exists to enforce, silently gone. Indices are unique by
     * construction, so the bound holds whatever the values are.
     */
    const values = new Array<number>(5_000).fill(7);
    values[2_500] = 99;

    const kept = downsampleIndicesPreservingAlerts(
      values.length,
      (index) => values[index],
      (index) => index === 2_500,
      300,
    );

    expect(kept).not.toBeNull();
    expect(kept!.length).toBeLessThanOrEqual(300);
    expect(new Set(kept!).size).toBe(kept!.length);
    expect(kept).toContain(2_500);
  });

  it("holds the threshold through the point-shaped wrapper too", () => {
    const values = new Array<number>(5_000).fill(7);
    values[2_500] = 99;

    const kept = downsamplePreservingAlerts(
      values,
      300,
      (value) => value,
      () => false,
    );

    expect(kept.length).toBeLessThanOrEqual(300);
  });
});
