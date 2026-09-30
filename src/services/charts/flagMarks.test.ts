import { describe, expect, it } from "vitest";
import type { ChartSpec, FlagOutcome, Row } from "@/contracts/api";
import { buildCartesian, buildHeatmap, buildPie, mergeFlagMark } from "./shape";
import { flaggedBuckets } from "@/components/charts/CartesianChartView";
import { MAX_PLOT_SERIES } from "./downsample";

/**
 * A chart that only says "something here is flagged" makes the analyst open the
 * table to learn why. These pin the other half: the rule names and severity
 * reach the mark, through every step that merges or folds marks together.
 */

const spec = (over: Partial<ChartSpec> = {}): ChartSpec => ({
  id: "c",
  name: "C",
  type: "bar",
  x_field: "hour",
  y_field: "amount",
  series_field: null,
  warnings: [],
  ...over,
});

function outcome(
  hits: { index: number; rules: string[] }[],
  rules: { id: string; name: string; severity: "low" | "medium" | "high" }[],
): FlagOutcome {
  return {
    flagged_count: hits.length,
    rows: hits.map((hit) => ({ index: hit.index, rule_ids: hit.rules })),
    rules: rules.map((rule) => ({ ...rule, matched: 1 })),
    warnings: [],
    dismissed_count: 0,
  };
}

const BIG = { id: "big", name: "Big transfer", severity: "high" as const };
const FAST = { id: "fast", name: "Velocity", severity: "low" as const };

describe("mergeFlagMark", () => {
  it("unions rule names without repeats and keeps the worst severity", () => {
    const first = mergeFlagMark(undefined, ["A", "B"], "low");
    const merged = mergeFlagMark(first, ["B", "C"], "high");
    expect(merged.rules).toEqual(["A", "B", "C"]);
    expect(merged.severity).toBe("high");
    // A milder later hit never downgrades it.
    expect(mergeFlagMark(merged, ["D"], "low").severity).toBe("high");
    expect(mergeFlagMark(undefined, [], null).severity).toBeNull();
  });
});

describe("line and bar points", () => {
  it("names the rule on the flagged point and leaves the rest unmarked", () => {
    const data = buildCartesian({
      columns: ["hour", "amount"],
      rows: [["09", 10], ["10", 900], ["11", 12]],
      chart: spec(),
      flags: outcome([{ index: 1, rules: ["big"] }], [BIG]),
    });
    expect(data.data[1].__flag).toEqual({ amount: { rules: ["Big transfer"], severity: "high" } });
    expect(data.data[0].__flag).toBeUndefined();
    expect(data.data[2].__flag).toBeUndefined();
  });

  it("merges every rule that hit one pivoted cell, worst severity winning", () => {
    const data = buildCartesian({
      columns: ["hour", "terminal", "amount"],
      rows: [["09", "T1", 5], ["09", "T1", 7], ["09", "T2", 3]],
      chart: spec({ series_field: "terminal" }),
      flags: outcome(
        [
          { index: 0, rules: ["fast"] },
          { index: 1, rules: ["big"] },
        ],
        [BIG, FAST],
      ),
    });
    const cell = data.data[0].__flag?.T1;
    expect(cell?.rules.sort()).toEqual(["Big transfer", "Velocity"]);
    expect(cell?.severity).toBe("high");
    expect(data.data[0].__flag?.T2).toBeUndefined();
  });

  it("keeps the rules when a flagged series is folded into Other", () => {
    const rows: Row[] = [];
    for (let series = 0; series < 40; series += 1) rows.push(["09", `TERM-${series}`, series + 1]);
    const data = buildCartesian({
      columns: ["hour", "terminal", "amount"],
      rows,
      chart: spec({ series_field: "terminal" }),
      // Row 0 is TERM-0, the quietest, so it lands in the fold.
      flags: outcome([{ index: 0, rules: ["big"] }], [BIG]),
    });
    expect(data.seriesKeys).toHaveLength(MAX_PLOT_SERIES);
    expect(data.data[0].__flag?.Other).toEqual({ rules: ["Big transfer"], severity: "high" });
  });
});

describe("flaggedBuckets", () => {
  it("lists only columns with a flagged point, with their rules", () => {
    const data = buildCartesian({
      columns: ["hour", "amount"],
      rows: [["09", 10], ["10", 900], ["11", 12], ["12", 800]],
      chart: spec(),
      flags: outcome(
        [
          { index: 1, rules: ["big"] },
          { index: 3, rules: ["big", "fast"] },
        ],
        [BIG, FAST],
      ),
    });
    const buckets = flaggedBuckets(data);
    expect(buckets.map((bucket) => bucket.label)).toEqual(["10", "12"]);
    expect(buckets[1].mark.rules.sort()).toEqual(["Big transfer", "Velocity"]);
    expect(buckets[1].mark.severity).toBe("high");
  });

  it("is empty when nothing is flagged", () => {
    const data = buildCartesian({
      columns: ["hour", "amount"],
      rows: [["09", 10]],
      chart: spec(),
    });
    expect(flaggedBuckets(data)).toEqual([]);
  });
});

describe("pie slices", () => {
  it("carries the rules of every row merged into a slice", () => {
    const built = buildPie({
      columns: ["outcome", "count"],
      rows: [["blocked", 5], ["blocked", 7], ["approved", 90]],
      chart: spec({ type: "pie", x_field: "outcome", y_field: "count" }),
      flags: outcome(
        [
          { index: 0, rules: ["fast"] },
          { index: 1, rules: ["big"] },
        ],
        [BIG, FAST],
      ),
    });
    const blocked = built.slices.find((slice) => slice.name === "blocked");
    expect(blocked?.rules.sort()).toEqual(["Big transfer", "Velocity"]);
    expect(blocked?.severity).toBe("high");
    expect(built.slices.find((slice) => slice.name === "approved")?.rules).toEqual([]);
  });
});

describe("heatmap cells", () => {
  it("names the rules on a flagged cell only", () => {
    const grid = spec({ type: "heatmap", x_field: "hour", y_field: "flags", series_field: "country" });
    const data = buildHeatmap({
      columns: ["hour", "country", "flags"],
      rows: [["09", "NG", 4], ["10", "NG", 40]],
      chart: grid,
      flags: outcome([{ index: 1, rules: ["big"] }], [BIG]),
    });
    const [first, second] = data.rows[0].cells;
    expect(first.rules).toEqual([]);
    expect(second.rules).toEqual(["Big transfer"]);
  });
});
