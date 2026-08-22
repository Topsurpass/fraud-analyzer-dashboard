import { describe, expect, it } from "vitest";
import {
  detectOutliers,
  detectRowAnomalies,
  findFlagColumn,
  isFlagColumn,
  isTruthyFlag,
  looksBoolean,
  median,
  modifiedZScores,
  MODIFIED_Z_THRESHOLD,
} from "./index";

describe("isFlagColumn", () => {
  it("recognises the common fraud flag names, case and space insensitive", () => {
    expect(isFlagColumn("is_flagged")).toBe(true);
    expect(isFlagColumn("IS_FRAUD")).toBe(true);
    expect(isFlagColumn("  suspicious ")).toBe(true);
  });

  it("does not claim ordinary columns", () => {
    expect(isFlagColumn("amount")).toBe(false);
    expect(isFlagColumn("flag_reason")).toBe(false);
    expect(isFlagColumn("country")).toBe(false);
  });
});

describe("looksBoolean", () => {
  it("accepts two-valued columns in any driver's spelling", () => {
    expect(looksBoolean([0, 1, 1, 0])).toBe(true);
    expect(looksBoolean([true, false])).toBe(true);
    expect(looksBoolean(["t", "f", null])).toBe(true);
  });

  it("rejects counts, which is the case that matters", () => {
    expect(looksBoolean([3, 4, 88])).toBe(false);
    expect(looksBoolean([0, 1, 2])).toBe(false);
  });

  it("rejects a column with nothing but nulls", () => {
    expect(looksBoolean([null, null])).toBe(false);
    expect(looksBoolean([])).toBe(false);
  });
});

describe("findFlagColumn", () => {
  it("returns the index of a genuinely boolean flag column", () => {
    expect(
      findFlagColumn(["id", "amount", "is_flagged"], [[1, 10, 0], [2, 20, 1]]),
    ).toBe(2);
  });

  it("returns null when the result set has no flag column", () => {
    expect(findFlagColumn(["id", "amount"], [[1, 10]])).toBeNull();
  });

  it("rejects a flag-named column that holds counts", () => {
    // SELECT bucket, COUNT(*) AS flagged GROUP BY bucket
    expect(
      findFlagColumn(["bucket", "flagged"], [["09:00", 3], ["09:05", 88]]),
    ).toBeNull();
  });

  it("ignores the column being plotted as a magnitude", () => {
    expect(
      findFlagColumn(["bucket", "flagged"], [["09:00", 0], ["09:05", 1]], "flagged"),
    ).toBeNull();
  });

  it("keeps the name match when there are no rows to inspect", () => {
    expect(findFlagColumn(["id", "is_fraud"], [])).toBe(1);
  });
});

describe("isTruthyFlag", () => {
  it("accepts the shapes different SQL drivers return for true", () => {
    for (const value of [true, 1, "1", "true", "TRUE", "t", "yes", "Y"]) {
      expect(isTruthyFlag(value)).toBe(true);
    }
  });

  it("rejects false-ish and unknown values", () => {
    for (const value of [false, 0, "0", "false", "", null, undefined, "maybe"]) {
      expect(isTruthyFlag(value)).toBe(false);
    }
  });
});

describe("median", () => {
  it("averages the middle pair on even samples", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
  });

  it("does not mutate the caller's array", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("modifiedZScores", () => {
  it("scores a flat sample as all zeroes rather than dividing by zero", () => {
    expect(modifiedZScores([5, 5, 5, 5, 5])).toEqual([0, 0, 0, 0, 0]);
  });

  it("falls back to mean absolute deviation when MAD collapses", () => {
    // Six of seven points are identical, so MAD is 0 but the sample does have
    // spread. The spike must still score above the threshold.
    const scores = modifiedZScores([4, 4, 4, 4, 4, 4, 90]);
    expect(scores[6]).toBeGreaterThan(MODIFIED_Z_THRESHOLD);
    expect(scores.slice(0, 6).every((score) => score === 0)).toBe(true);
  });

  it("is not dragged around by the outlier it is trying to find", () => {
    // The mean of this sample is ~112, so a classic z-score would score the
    // spike near 2.4 and miss it. The median-based score must not.
    const values = [10, 11, 9, 12, 10, 11, 10, 900];
    const scores = modifiedZScores(values);
    expect(scores[7]).toBeGreaterThan(MODIFIED_Z_THRESHOLD);
  });
});

describe("detectOutliers", () => {
  it("finds a single spike in an otherwise calm series", () => {
    const flags = detectOutliers([12, 14, 13, 12, 15, 13, 220]);
    expect(flags).toEqual([false, false, false, false, false, false, true]);
  });

  it("reports nothing on a calm series", () => {
    expect(detectOutliers([12, 14, 13, 12, 15, 13, 14]).some(Boolean)).toBe(false);
  });

  it("refuses to judge a sample too small to support the claim", () => {
    expect(detectOutliers([1, 2, 900])).toEqual([false, false, false]);
  });

  it("ignores low outliers by default, since fraud spikes go up", () => {
    const values = [100, 102, 98, 101, 99, 100, 1];
    expect(detectOutliers(values).some(Boolean)).toBe(false);
    expect(detectOutliers(values, { direction: "both" })[6]).toBe(true);
  });

  it("never flags a non-finite value", () => {
    const flags = detectOutliers([10, 11, 10, 12, 11, Number.NaN, 400]);
    expect(flags[5]).toBe(false);
    expect(flags[6]).toBe(true);
  });
});

describe("detectRowAnomalies", () => {
  it("trusts an explicit flag column over statistics", () => {
    const result = detectRowAnomalies({
      columns: ["id", "amount", "is_flagged"],
      rows: [
        [1, 10, 0],
        [2, 5000, 0], // statistically extreme, but SQL says it is fine
        [3, 12, 1],
      ],
      valueColumn: "amount",
    });
    expect(result.reason).toBe("flag-column");
    expect(result.source).toBe("is_flagged");
    expect(result.flags).toEqual([false, false, true]);
  });

  it("falls back to the outlier test when there is no flag column", () => {
    const result = detectRowAnomalies({
      columns: ["bucket", "flagged"],
      rows: [
        ["09:00", 3],
        ["09:05", 4],
        ["09:10", 3],
        ["09:15", 5],
        ["09:20", 4],
        ["09:25", 88],
      ],
      valueColumn: "flagged",
    });
    expect(result.reason).toBe("outlier");
    expect(result.source).toBe("flagged");
    expect(result.flags[5]).toBe(true);
    expect(result.flags.slice(0, 5).some(Boolean)).toBe(false);
  });

  it("reports 'none' when the data is calm, so nothing renders alert-coloured", () => {
    const result = detectRowAnomalies({
      columns: ["country", "declines"],
      rows: [
        ["US", 40],
        ["GB", 42],
        ["DE", 39],
        ["FR", 41],
        ["CA", 40],
      ],
      valueColumn: "declines",
    });
    expect(result.reason).toBe("none");
    expect(result.flags.some(Boolean)).toBe(false);
  });

  it("returns an all-false mask when the value column is missing", () => {
    const result = detectRowAnomalies({
      columns: ["a", "b"],
      rows: [["x", 1]],
      valueColumn: "nope",
    });
    expect(result.flags).toEqual([false]);
    expect(result.reason).toBe("none");
  });

  it("coerces numeric strings, which SQLite and MySQL both return", () => {
    const result = detectRowAnomalies({
      columns: ["bucket", "n"],
      rows: [["a", "10"], ["b", "11"], ["c", "10"], ["d", "12"], ["e", "11"], ["f", "500"]],
      valueColumn: "n",
    });
    expect(result.flags[5]).toBe(true);
  });
});
