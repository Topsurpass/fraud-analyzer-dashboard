import { describe, expect, it } from "vitest";
import {
  DEFAULT_SURGE_THRESHOLD_PCT,
  bucketSurges,
  changeLabel,
  judgeChange,
  resolveThreshold,
} from "./severity";

describe("judgeChange", () => {
  it("calls a rise past the threshold a surge", () => {
    expect(judgeChange(100, 200, 50).severity).toBe("surge");
  });

  it("calls a fall past the threshold a drop", () => {
    // A terminal that stops is as much a finding as one that triples, so the
    // threshold is a magnitude covering both directions.
    expect(judgeChange(200, 50, 50).severity).toBe("drop");
  });

  it("leaves a movement under the threshold alone", () => {
    expect(judgeChange(100, 120, 50).severity).toBe("normal");
    expect(judgeChange(100, 80, 50).severity).toBe("normal");
  });

  it("fires exactly at the threshold, not just past it", () => {
    // A threshold of 50 has to mean "50% or more" or the number a user typed
    // is not the number that fires.
    expect(judgeChange(100, 150, 50).severity).toBe("surge");
    expect(judgeChange(100, 50, 50).severity).toBe("drop");
  });

  it("is not defeated by floating point at the boundary", () => {
    // 0.1 -> 0.15 is exactly +50% in decimal and 49.999...% in binary. Without
    // a tolerance the threshold a user typed would silently miss.
    expect(judgeChange(0.1, 0.15, 50).severity).toBe("surge");
  });

  it("reports the proportional change as a fraction", () => {
    expect(judgeChange(100, 250, 50).pctChange).toBeCloseTo(1.5);
    expect(judgeChange(100, 40, 50).pctChange).toBeCloseTo(-0.6);
  });

  it("treats a terminal waking from nothing as a surge with no percentage", () => {
    // Anything divided by zero is undefined; reporting "up 100%" would be
    // inventing a number, and the finding is still worth surfacing.
    const verdict = judgeChange(0, 40, 50);

    expect(verdict.severity).toBe("surge");
    expect(verdict.fromNothing).toBe(true);
    expect(verdict.pctChange).toBeNull();
  });

  it("does not call a category that was and stayed empty a surge", () => {
    const verdict = judgeChange(0, 0, 50);

    expect(verdict.severity).toBe("normal");
    expect(verdict.fromNothing).toBe(false);
  });

  it("marks a terminal that went silent, and still calls it a drop", () => {
    const verdict = judgeChange(500, 0, 50);

    expect(verdict.severity).toBe("drop");
    expect(verdict.toNothing).toBe(true);
    expect(verdict.pctChange).toBeCloseTo(-1);
  });

  it("claims nothing about a bucket that reported no value", () => {
    // A missing bucket is not a zero: only the query knows whether it means
    // idle or not reported, so neither side may be judged.
    expect(judgeChange(null, 500, 50).severity).toBe("normal");
    expect(judgeChange(500, null, 50).severity).toBe("normal");
  });

  it("falls back to the default when the threshold is unusable", () => {
    expect(judgeChange(100, 200, 0).threshold).toBe(DEFAULT_SURGE_THRESHOLD_PCT);
    expect(judgeChange(100, 200, Number.NaN).threshold).toBe(DEFAULT_SURGE_THRESHOLD_PCT);
  });

  it("honours a threshold high enough that ordinary movement is quiet", () => {
    // The point of configuring it: an overnight fall of 80% is the most
    // ordinary thing in this data, and a chart watching the night says so by
    // carrying a bigger number.
    expect(judgeChange(1000, 200, 50).severity).toBe("drop");
    expect(judgeChange(1000, 200, 90).severity).toBe("normal");
  });
});

describe("resolveThreshold", () => {
  it("takes a positive number as given", () => {
    expect(resolveThreshold(25)).toBe(25);
  });

  it("rejects zero, negatives and nonsense in favour of the default", () => {
    // Zero would fire on every movement including none at all, which looks
    // configured and behaves as if it were not.
    for (const value of [0, -50, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      expect(resolveThreshold(value)).toBe(DEFAULT_SURGE_THRESHOLD_PCT);
    }
  });
});

describe("bucketSurges", () => {
  it("finds the hour that jumped against the hour before it", () => {
    // The window totals here barely move; the story is entirely in one bucket.
    const surges = bucketSurges([10, 10, 400, 10], 50);

    expect(surges.map((entry) => entry.index)).toEqual([2, 3]);
    expect(surges[0].verdict.severity).toBe("surge");
    expect(surges[1].verdict.severity).toBe("drop");
  });

  it("compares strictly consecutive buckets, never across a gap", () => {
    /*
     * Spanning the gap would compare 10 against 400 and report a surge at an
     * hour whose neighbour was never measured - "this hour against some
     * earlier hour" is not the claim the chart makes.
     */
    const surges = bucketSurges([10, null, 400], 50);

    expect(surges).toEqual([]);
  });

  it("returns nothing when every step is within the threshold", () => {
    expect(bucketSurges([100, 110, 120, 115], 50)).toEqual([]);
  });

  it("handles a series too short to have a step", () => {
    expect(bucketSurges([], 50)).toEqual([]);
    expect(bucketSurges([42], 50)).toEqual([]);
  });

  it("counts a bucket waking from zero", () => {
    const surges = bucketSurges([0, 90], 50);

    expect(surges).toHaveLength(1);
    expect(surges[0].verdict.fromNothing).toBe(true);
  });
});

describe("changeLabel", () => {
  it("signs the percentage so it reads as a movement, not a level", () => {
    expect(changeLabel(judgeChange(100, 250, 50))).toBe("+150%");
    expect(changeLabel(judgeChange(100, 40, 50))).toBe("−60%");
  });

  it("keeps one decimal for small movements and drops it for large ones", () => {
    expect(changeLabel(judgeChange(1000, 1055, 50))).toBe("+5.5%");
    expect(changeLabel(judgeChange(100, 212, 50))).toBe("+112%");
  });

  it("says what a rise from zero is instead of printing a fake percentage", () => {
    expect(changeLabel(judgeChange(0, 40, 50))).toBe("from nothing");
  });

  it("reads a rounding-error difference as flat rather than +0%", () => {
    expect(changeLabel(judgeChange(1000, 1000.1, 50))).toBe("flat");
  });

  it("says nothing changed when there was nothing on either side", () => {
    expect(changeLabel(judgeChange(0, 0, 50))).toBe("no change");
  });
});
