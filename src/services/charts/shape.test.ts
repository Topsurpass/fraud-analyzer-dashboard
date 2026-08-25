import { describe, expect, it } from "vitest";
import type { ChartSpec, FlagOutcome } from "@/contracts/api";
import { MAX_PLOT_POINTS } from "./downsample";
import {
  MAX_HEAT_BUCKETS,
  MAX_HEAT_ROWS,
  buildCartesian,
  buildCompare,
  buildHeatmap,
  buildNumber,
  buildPie,
  buildTable,
  resolveFields,
  toNumber,
} from "./shape";

const spec = (overrides: Partial<ChartSpec> = {}): ChartSpec => ({
  id: "c",
  name: "Chart",
  type: "line",
  x_field: null,
  y_field: null,
  series_field: null,
  warnings: [],
  ...overrides,
});

/**
 * A flag outcome naming one rule. Nothing else flags a row any more: the
 * column-name guess and the outlier test were both removed, so every alert in
 * these tests has to come from here.
 */
function caught(name: string, indices: number[]): FlagOutcome {
  return {
    flagged_count: indices.length,
    rows: indices.map((index) => ({ index, rule_ids: ["r1"] })),
    rules: [{ id: "r1", name, severity: "high", matched: indices.length }],
    warnings: [],
    dismissed_count: 0,
  };
}

describe("toNumber", () => {
  it("passes numbers through and coerces the strings SQL drivers return", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber("42.5")).toBe(42.5);
    expect(toNumber(true)).toBe(1);
  });

  it("returns NaN for values that are not numbers, including empty string", () => {
    expect(toNumber(null)).toBeNaN();
    expect(toNumber("")).toBeNaN();
    expect(toNumber("abc")).toBeNaN();
  });
});

describe("resolveFields", () => {
  it("honours a fully configured spec without inventing warnings", () => {
    const fields = resolveFields({
      columns: ["bucket", "flagged"],
      rows: [["09:00", 3]],
      chart: spec({ x_field: "bucket", y_field: "flagged" }),
    });
    expect(fields).toMatchObject({ xKey: "bucket", yKey: "flagged", seriesKey: null });
    expect(fields.warnings).toEqual([]);
  });

  it("warns and recovers when the SQL no longer has the configured field", () => {
    const fields = resolveFields({
      columns: ["bucket", "total"],
      rows: [["09:00", 3]],
      chart: spec({ x_field: "bucket", y_field: "flagged" }),
    });
    expect(fields.yKey).toBe("total");
    expect(fields.warnings).toContain('y_field "flagged" is not in the result set');
    expect(fields.warnings).toContain('value axis defaulted to "total"');
  });

  it("picks the non-numeric column for x and the numeric one for y", () => {
    const fields = resolveFields({
      columns: ["country", "declines"],
      rows: [["US", 40], ["GB", 42]],
      chart: spec({ type: "bar" }),
    });
    expect(fields.xKey).toBe("country");
    expect(fields.yKey).toBe("declines");
  });

  it("carries the engine's own chart warnings through", () => {
    const fields = resolveFields({
      columns: ["a", "b"],
      rows: [["x", 1]],
      chart: spec({ x_field: "a", y_field: "b", warnings: ["engine said so"] }),
    });
    expect(fields.warnings).toContain("engine said so");
  });
});

describe("buildCartesian", () => {
  it("shapes a single-series result the way Recharts wants it", () => {
    const built = buildCartesian({
      columns: ["country", "declines"],
      rows: [["RU", 92], ["NG", 84], ["VN", 64]],
      chart: spec({ type: "bar", x_field: "country", y_field: "declines" }),
    });
    expect(built.seriesKeys).toEqual(["declines"]);
    expect(built.xKey).toBe("country");
    expect(built.data[0]).toMatchObject({ country: "RU", declines: 92 });
    expect(built.data).toHaveLength(3);
  });

  it("returns empty data rather than throwing when there is nothing to plot", () => {
    const built = buildCartesian({ columns: [], rows: [], chart: spec() });
    expect(built.data).toEqual([]);
    expect(built.seriesKeys).toEqual([]);
  });

  it("pivots long-form series rows into one object per x value", () => {
    // This is the exact shape the engine returns for the seeded
    // "Authorisations by channel" query.
    const built = buildCartesian({
      columns: ["bucket", "channel", "approvals"],
      rows: [
        ["11:53", "api", 1],
        ["11:54", "api", 2],
        ["11:54", "mobile", 5],
        ["11:55", "web", 3],
      ],
      chart: spec({ x_field: "bucket", y_field: "approvals", series_field: "channel" }),
    });

    expect(built.seriesKeys).toEqual(["api", "mobile", "web"]);
    expect(built.data).toHaveLength(3);
    expect(built.data[0]).toMatchObject({ bucket: "11:53", api: 1 });
    expect(built.data[1]).toMatchObject({ bucket: "11:54", api: 2, mobile: 5 });
    expect(built.data[2]).toMatchObject({ bucket: "11:55", web: 3 });
  });

  it("preserves first-seen order on both axes", () => {
    const built = buildCartesian({
      columns: ["bucket", "channel", "n"],
      rows: [
        ["b", "web", 1],
        ["a", "api", 1],
        ["b", "api", 1],
      ],
      chart: spec({ x_field: "bucket", y_field: "n", series_field: "channel" }),
    });
    expect(built.data.map((point) => point.bucket)).toEqual(["b", "a"]);
    expect(built.seriesKeys).toEqual(["web", "api"]);
  });

  it("sums duplicate x/series pairs instead of dropping volume", () => {
    const built = buildCartesian({
      columns: ["bucket", "channel", "n"],
      rows: [
        ["09:00", "web", 2],
        ["09:00", "web", 3],
      ],
      chart: spec({ x_field: "bucket", y_field: "n", series_field: "channel" }),
    });
    expect(built.data[0].web).toBe(5);
  });

  it("marks the rows a rule caught and says so", () => {
    const built = buildCartesian({
      columns: ["bucket", "flagged"],
      rows: [
        ["09:00", 3],
        ["09:05", 4],
        ["09:10", 3],
        ["09:15", 5],
        ["09:20", 4],
        ["09:25", 140],
      ],
      chart: spec({ x_field: "bucket", y_field: "flagged" }),
      flags: caught("Spike", [5]),
    });
    expect(built.hasAlerts).toBe(true);
    expect(built.alertReason).toBe("flag-rule");
    expect(built.data[5].__alert).toEqual({ flagged: true });
    expect(built.data[0].__alert).toEqual({ flagged: false });
  });

  it("leaves the same obvious spike alone when no rule names it", () => {
    // 140 among single digits is exactly what the deleted z-score caught.
    const built = buildCartesian({
      columns: ["bucket", "flagged"],
      rows: [
        ["09:00", 3],
        ["09:05", 4],
        ["09:10", 3],
        ["09:15", 5],
        ["09:20", 4],
        ["09:25", 140],
      ],
      chart: spec({ x_field: "bucket", y_field: "flagged" }),
    });
    expect(built.hasAlerts).toBe(false);
    expect(built.alertReason).toBe("none");
  });

  it("leaves a calm series entirely unalerted", () => {
    const built = buildCartesian({
      columns: ["country", "declines"],
      rows: [["US", 40], ["GB", 42], ["DE", 39], ["FR", 41], ["CA", 40]],
      chart: spec({ type: "bar", x_field: "country", y_field: "declines" }),
    });
    expect(built.hasAlerts).toBe(false);
    expect(built.alertReason).toBe("none");
  });

  it("marks the pivoted cell belonging to the flagged row", () => {
    // Regression: this path used to ignore flag rules entirely and run its own
    // outlier test per series, so a chart with a series field showed guesses
    // instead of what the analyst wrote.
    const rows: [string, string, number][] = [];
    const buckets = ["01", "02", "03", "04", "05", "06"];
    buckets.forEach((bucket, index) => {
      rows.push([bucket, "web", 900 + index]);
      rows.push([bucket, "api", index === 5 ? 400 : 10 + index]);
    });
    const built = buildCartesian({
      columns: ["bucket", "channel", "n"],
      rows,
      chart: spec({ x_field: "bucket", y_field: "n", series_field: "channel" }),
      // Row 11 is bucket "06", channel "api".
      flags: caught("Api spike", [11]),
    });
    expect(built.hasAlerts).toBe(true);
    expect(built.alertReason).toBe("flag-rule");
    expect(built.data[5].__alert).toMatchObject({ api: true });
    expect(built.data[5].__alert?.web).toBeUndefined();
  });

  it("marks no pivoted cell when the query has no rules", () => {
    const rows: [string, string, number][] = [];
    ["01", "02", "03", "04", "05", "06"].forEach((bucket, index) => {
      rows.push([bucket, "web", 900 + index]);
      rows.push([bucket, "api", index === 5 ? 400 : 10 + index]);
    });
    const built = buildCartesian({
      columns: ["bucket", "channel", "n"],
      rows,
      chart: spec({ x_field: "bucket", y_field: "n", series_field: "channel" }),
    });
    expect(built.hasAlerts).toBe(false);
    expect(built.data.every((point) => Object.keys(point.__alert ?? {}).length === 0)).toBe(
      true,
    );
  });
});

describe("buildPie", () => {
  it("maps rows to named slices and totals them", () => {
    const built = buildPie({
      columns: ["reason", "count"],
      rows: [["suspected_fraud", 120], ["expired_card", 30]],
      chart: spec({ type: "pie", x_field: "reason", y_field: "count" }),
    });
    expect(built.slices).toEqual([
      { name: "suspected_fraud", value: 120, alert: false },
      { name: "expired_card", value: 30, alert: false },
    ]);
    expect(built.total).toBe(150);
  });

  it("labels a null category rather than rendering a nameless wedge", () => {
    const built = buildPie({
      columns: ["reason", "count"],
      rows: [[null, 5]],
      chart: spec({ type: "pie", x_field: "reason", y_field: "count" }),
    });
    expect(built.slices[0].name).toBe("NULL");
  });

  it("clamps negatives to zero, since a wedge cannot be negative", () => {
    const built = buildPie({
      columns: ["reason", "count"],
      rows: [["a", -5]],
      chart: spec({ type: "pie", x_field: "reason", y_field: "count" }),
    });
    expect(built.slices[0].value).toBe(0);
  });
});

describe("buildNumber", () => {
  it("reads the single scalar the query returned", () => {
    const built = buildNumber({
      columns: ["flagged_last_hour"],
      rows: [[20]],
      chart: spec({ type: "number", y_field: "flagged_last_hour" }),
    });
    expect(built.value).toBe(20);
    expect(built.label).toBe("flagged_last_hour");
    expect(built.extraRows).toBe(0);
  });

  it("reports rows a number card cannot show instead of hiding them", () => {
    const built = buildNumber({
      columns: ["n"],
      rows: [[1], [2], [3]],
      chart: spec({ type: "number", y_field: "n" }),
    });
    expect(built.value).toBe(1);
    expect(built.extraRows).toBe(2);
  });

  it("keeps the raw cell when the result is not numeric", () => {
    const built = buildNumber({
      columns: ["status"],
      rows: [["degraded"]],
      chart: spec({ type: "number", y_field: "status" }),
    });
    expect(built.value).toBeNull();
    expect(built.raw).toBe("degraded");
  });

  it("survives an empty result set", () => {
    const built = buildNumber({
      columns: ["n"],
      rows: [],
      chart: spec({ type: "number", y_field: "n" }),
    });
    expect(built.value).toBeNull();
  });
});

describe("buildTable", () => {
  it("keeps columns and rows verbatim, because the table is the audit view", () => {
    const built = buildTable({
      columns: ["id", "amount", "is_flagged"],
      rows: [[1, 10, 0], [2, 20, 1]],
      chart: spec({ type: "table" }),
    });
    expect(built.columns).toEqual(["id", "amount", "is_flagged"]);
    expect(built.rows).toHaveLength(2);
  });

  it("marks the rows a rule caught", () => {
    const built = buildTable({
      columns: ["id", "amount", "is_flagged"],
      rows: [[1, 10, 0], [2, 20, 1]],
      chart: spec({ type: "table" }),
      flags: caught("Large", [1]),
    });
    expect(built.alerts).toEqual([false, true]);
    expect(built.alertReason).toBe("flag-rule");
  });

  it("ignores a column called is_flagged when no rule mentions it", () => {
    const built = buildTable({
      columns: ["id", "amount", "is_flagged"],
      rows: [[1, 10, 0], [2, 20, 1]],
      chart: spec({ type: "table" }),
    });
    expect(built.alerts).toEqual([false, false]);
    expect(built.alertReason).toBe("none");
  });

  it("identifies numeric columns so figures can be right-aligned", () => {
    const built = buildTable({
      columns: ["merchant", "amount"],
      rows: [["Northwind", 10.5], ["Kestrel", 3]],
      chart: spec({ type: "table" }),
    });
    expect(built.numericColumns).toEqual([false, true]);
  });
});

describe("large series", () => {
  function series(count: number) {
    return Array.from({ length: count }, (_, index) => [`t${index}`, index % 50]);
  }

  it("caps the points handed to the chart", () => {
    // Every point is an SVG node. Ten thousand for a 900px plot is ten points
    // fighting over each pixel column, none of which the eye can resolve.
    const built = buildCartesian({
      columns: ["bucket", "n"],
      rows: series(10_000),
      chart: spec({ x_field: "bucket", y_field: "n" }),
    });
    expect(built.data.length).toBeLessThanOrEqual(900);
    expect(built.data.length).toBeGreaterThan(100);
  });

  it("keeps a flagged row visible however much it downsamples", () => {
    // A finding missing from the chart would disagree with the table beside it
    // about what was flagged, which is worse than a slow chart.
    const built = buildCartesian({
      columns: ["bucket", "n"],
      rows: series(10_000),
      chart: spec({ x_field: "bucket", y_field: "n" }),
      flags: caught("Spike", [7_777]),
    });
    const alerted = built.data.filter(
      (point) => (point.__alert as Record<string, boolean>)?.n === true,
    );
    expect(alerted).toHaveLength(1);
  });

  it("leaves a series that already fits untouched", () => {
    const built = buildCartesian({
      columns: ["bucket", "n"],
      rows: series(120),
      chart: spec({ x_field: "bucket", y_field: "n" }),
    });
    expect(built.data).toHaveLength(120);
  });

  it("caps a pivoted multi-series chart too", () => {
    const rows: [string, string, number][] = [];
    for (let index = 0; index < 4_000; index++) {
      rows.push([`t${index}`, "web", index % 40]);
      rows.push([`t${index}`, "api", index % 25]);
    }
    const built = buildCartesian({
      columns: ["bucket", "channel", "n"],
      rows,
      chart: spec({ x_field: "bucket", y_field: "n", series_field: "channel" }),
    });
    expect(built.data.length).toBeLessThanOrEqual(900);
    // Both series survive: downsampling drops points, never columns.
    expect(built.seriesKeys.sort()).toEqual(["api", "web"]);
  });

  it("does not reorder the x axis while downsampling", () => {
    const built = buildCartesian({
      columns: ["bucket", "n"],
      rows: series(5_000),
      chart: spec({ x_field: "bucket", y_field: "n" }),
    });
    const order = built.data.map((point) =>
      Number.parseInt(String(point.bucket).slice(1), 10),
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("a pie with repeated categories", () => {
  it("merges rows that share a category instead of drawing two slices", () => {
    // Two wedges labelled the same thing are not two things: they are one
    // category the query returned on two rows. Drawing both also gave React two
    // children with the same key, which is how this was noticed.
    const built = buildPie({
      columns: ["rate", "n"],
      rows: [["100.00", 5], ["100.00", 3], ["50.00", 2]],
      chart: spec({ type: "pie", x_field: "rate", y_field: "n" }),
    });

    expect(built.slices.map((slice) => slice.name)).toEqual(["100.00", "50.00"]);
    expect(built.slices[0].value).toBe(8);
    expect(built.total).toBe(10);
  });

  it("keeps every category name unique", () => {
    const built = buildPie({
      columns: ["v"],
      rows: [["a"], ["a"], ["b"], ["a"]],
      chart: spec({ type: "pie", x_field: "v", y_field: "v" }),
    });
    const names = built.slices.map((slice) => slice.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("a merged slice is flagged when any row behind it was", () => {
    // The wedge stands for all of them, so it has to carry the worst of them.
    const built = buildPie({
      columns: ["v", "n"],
      rows: [["a", 1], ["a", 1]],
      chart: spec({ type: "pie", x_field: "v", y_field: "n" }),
      flags: caught("Odd", [1]),
    });
    expect(built.slices).toHaveLength(1);
    expect(built.slices[0].alert).toBe(true);
  });

  it("keeps distinct categories apart", () => {
    const built = buildPie({
      columns: ["v", "n"],
      rows: [["a", 1], ["b", 2]],
      chart: spec({ type: "pie", x_field: "v", y_field: "n" }),
    });
    expect(built.slices).toHaveLength(2);
  });
});

describe("buildCompare", () => {
  /** `count` buckets of a measure, oldest first, the way a query orders them. */
  const series = (values: number[]) => ({
    columns: ["bucket", "amount"],
    rows: values.map((value, index) => [`t${index}`, value]),
    chart: spec({ type: "compare", x_field: "bucket", y_field: "amount" }),
  });

  it("splits the result in half and lays the older window under the newer", () => {
    // Four buckets: t0,t1 are the previous window; t2,t3 the current one.
    const data = buildCompare(series([10, 20, 30, 40]));

    expect(data.points).toHaveLength(2);
    // Labelled by the current window, which is the axis an analyst is reading.
    expect(data.points.map((point) => point.bucket)).toEqual(["t2", "t3"]);
    expect(data.points.map((point) => point.current)).toEqual([30, 40]);
    expect(data.points.map((point) => point.previous)).toEqual([10, 20]);
  });

  it("reports the delta per bucket and the widest gap between the lines", () => {
    // The jump is at the second bucket: 60 against 20 is the story.
    const data = buildCompare(series([10, 20, 12, 60]));

    expect(data.points.map((point) => point.delta)).toEqual([2, 40]);
    expect(data.widestGap).toEqual({ bucket: "t3", delta: 40 });
  });

  it("finds the widest gap when the current window has fallen, not risen", () => {
    // A terminal going quiet is as much a signal as one going loud, so the
    // widest gap is by magnitude and keeps its sign.
    const data = buildCompare(series([80, 90, 70, 10]));

    expect(data.widestGap).toEqual({ bucket: "t3", delta: -80 });
  });

  it("totals each window so a period-over-period change can be read", () => {
    const data = buildCompare(series([10, 20, 30, 40]));

    expect(data.previousTotal).toBe(30);
    expect(data.currentTotal).toBe(70);
  });

  it("drops the oldest row when the count is odd, so both windows match", () => {
    // Five rows cannot split evenly; keeping the extra would make the previous
    // line cover more time than the current one and the gap would be a lie.
    const data = buildCompare(series([99, 10, 20, 30, 40]));

    expect(data.points.map((point) => point.previous)).toEqual([10, 20]);
    expect(data.points.map((point) => point.current)).toEqual([30, 40]);
    expect(data.warnings.join(" ")).toContain("oldest was dropped");
  });

  it("refuses to draw a comparison from fewer than four rows", () => {
    const data = buildCompare(series([10, 20, 30]));

    expect(data.points).toEqual([]);
    expect(data.warnings.join(" ")).toContain("at least four rows");
  });

  it("carries a flag on a current-window bucket through to the point", () => {
    const result = {
      ...series([10, 20, 30, 40]),
      // Row 3 is the last bucket of the current window.
      flags: caught("Spike", [3]),
    };

    const data = buildCompare(result);

    expect(data.points.map((point) => point.alert)).toEqual([false, true]);
    expect(data.hasAlerts).toBe(true);
  });

  it("holds a null where a value is missing instead of reading it as zero", () => {
    // A bucket with no value is not a bucket worth zero; a comparison that
    // treats it as zero invents a cliff the data never had.
    const data = buildCompare({
      columns: ["bucket", "amount"],
      rows: [
        ["t0", 10],
        ["t1", null],
        ["t2", 30],
        ["t3", 40],
      ],
      chart: spec({ type: "compare", x_field: "bucket", y_field: "amount" }),
    });

    expect(data.points[1].previous).toBeNull();
    expect(data.points[1].delta).toBeNull();
  });
});

describe("buildHeatmap", () => {
  const grid = spec({
    type: "heatmap",
    x_field: "hour",
    y_field: "amount",
    series_field: "terminal",
  });

  it("places each category on a row and each bucket on a column", () => {
    const data = buildHeatmap({
      columns: ["hour", "terminal", "amount"],
      rows: [
        ["09", "T1", 5],
        ["10", "T1", 7],
        ["09", "T2", 1],
        ["10", "T2", 2],
      ],
      chart: grid,
    });

    expect(data.buckets).toEqual(["09", "10"]);
    expect(data.rows.map((row) => row.category)).toEqual(["T1", "T2"]);
    expect(data.rows[0].cells.map((cell) => cell.value)).toEqual([5, 7]);
  });

  it("scales intensity across the whole grid, not per row", () => {
    // The point of the grid is comparing rows to each other. Normalising per
    // row would paint the quietest terminal's peak as dark as the busiest.
    const data = buildHeatmap({
      columns: ["hour", "terminal", "amount"],
      rows: [
        ["09", "T1", 0],
        ["10", "T1", 100],
        ["09", "T2", 50],
        ["10", "T2", 50],
      ],
      chart: grid,
    });

    expect(data.min).toBe(0);
    expect(data.max).toBe(100);
    expect(data.rows[0].cells.map((cell) => cell.intensity)).toEqual([0, 1]);
    expect(data.rows[1].cells.map((cell) => cell.intensity)).toEqual([0.5, 0.5]);
  });

  it("leaves a gap null rather than drawing a missing cell as a cold zero", () => {
    const data = buildHeatmap({
      columns: ["hour", "terminal", "amount"],
      rows: [
        ["09", "T1", 5],
        ["10", "T2", 9],
      ],
      chart: grid,
    });

    const t1 = data.rows.find((row) => row.category === "T1");
    expect(t1?.cells.map((cell) => cell.value)).toEqual([5, null]);
  });

  it("sums repeated category/bucket pairs into the one cell they describe", () => {
    const data = buildHeatmap({
      columns: ["hour", "terminal", "amount"],
      rows: [
        ["09", "T1", 5],
        ["09", "T1", 3],
      ],
      chart: grid,
    });

    expect(data.rows[0].cells[0].value).toBe(8);
  });

  it("colours a flat grid as one shade instead of dividing by a zero range", () => {
    const data = buildHeatmap({
      columns: ["hour", "terminal", "amount"],
      rows: [
        ["09", "T1", 7],
        ["10", "T1", 7],
      ],
      chart: grid,
    });

    expect(data.rows[0].cells.every((cell) => Number.isFinite(cell.intensity))).toBe(true);
    expect(data.rows[0].cells.map((cell) => cell.intensity)).toEqual([1, 1]);
  });

  it("keeps the busiest categories and says how many it dropped", () => {
    const rows = Array.from({ length: MAX_HEAT_ROWS + 5 }, (_, index) => [
      "09",
      `T${index}`,
      index,
    ]);

    const data = buildHeatmap({ columns: ["hour", "terminal", "amount"], rows, chart: grid });

    expect(data.rows).toHaveLength(MAX_HEAT_ROWS);
    // Sorted by total, so the highest-numbered terminals survive.
    expect(data.rows[0].category).toBe(`T${MAX_HEAT_ROWS + 4}`);
    expect(data.warnings.join(" ")).toContain(`${MAX_HEAT_ROWS + 5} categories`);
  });

  it("keeps the most recent buckets when there are too many to read", () => {
    const rows = Array.from({ length: MAX_HEAT_BUCKETS + 3 }, (_, index) => [
      `b${index}`,
      "T1",
      index,
    ]);

    const data = buildHeatmap({ columns: ["hour", "terminal", "amount"], rows, chart: grid });

    expect(data.buckets).toHaveLength(MAX_HEAT_BUCKETS);
    // The right edge is where a fraud queue looks, so the tail is what stays.
    expect(data.buckets.at(-1)).toBe(`b${MAX_HEAT_BUCKETS + 2}`);
    expect(data.buckets[0]).toBe("b3");
  });

  it("marks the cell a flagged row landed in", () => {
    const data = buildHeatmap({
      columns: ["hour", "terminal", "amount"],
      rows: [
        ["09", "T1", 5],
        ["10", "T1", 900],
      ],
      chart: grid,
      flags: caught("Spike", [1]),
    });

    expect(data.rows[0].cells.map((cell) => cell.alert)).toEqual([false, true]);
    expect(data.hasAlerts).toBe(true);
  });

  it("asks for a category column instead of guessing one", () => {
    const data = buildHeatmap({
      columns: ["hour", "amount"],
      rows: [["09", 5]],
      chart: spec({ type: "heatmap", x_field: "hour", y_field: "amount" }),
    });

    expect(data.rows).toEqual([]);
    expect(data.warnings.join(" ")).toContain("category column");
  });
});

describe("buildCompare previous bucket labels", () => {
  it("records which bucket each previous value was measured in", () => {
    // The axis shows the current window, so t2's previous value is t0's. A
    // tooltip that said only "previous" would imply both were measured at t2.
    const data = buildCompare({
      columns: ["bucket", "amount"],
      rows: [
        ["t0", 10],
        ["t1", 20],
        ["t2", 30],
        ["t3", 40],
      ],
      chart: spec({ type: "compare", x_field: "bucket", y_field: "amount" }),
    });

    expect(data.points.map((point) => point.previousBucket)).toEqual(["t0", "t1"]);
  });
});

describe("buildCompare at scale", () => {
  /** 10k rows is the stated ceiling for a single query. */
  const wide = (count: number) => ({
    columns: ["bucket", "amount"],
    rows: Array.from({ length: count }, (_, index) => [
      `t${index}`,
      Math.sin(index / 40) * 100 + 200,
    ]),
    chart: spec({ type: "compare", x_field: "bucket", y_field: "amount" }),
  });

  it("thins the plot but keeps the totals over every bucket", () => {
    const all = buildCompare(wide(400));
    const many = buildCompare(wide(10_000));

    expect(many.points.length).toBeLessThanOrEqual(MAX_PLOT_POINTS);
    // The headline must not move because the plot got thinner. 400 rows are
    // under the threshold, so that run is the unthinned reference for shape.
    expect(all.points.length).toBe(200);
    expect(many.warnings.join(" ")).toContain("totals cover them all");
  });

  it("totals every bucket even when only some are drawn", () => {
    // Flat data makes the arithmetic checkable by hand: 5000 buckets a side at
    // 10 each is 50000, whatever the plot ends up showing.
    const flat = {
      columns: ["bucket", "amount"],
      rows: Array.from({ length: 10_000 }, (_, index) => [`t${index}`, 10]),
      chart: spec({ type: "compare", x_field: "bucket", y_field: "amount" }),
    };

    const data = buildCompare(flat);

    expect(data.points.length).toBeLessThanOrEqual(MAX_PLOT_POINTS);
    expect(data.currentTotal).toBe(50_000);
    expect(data.previousTotal).toBe(50_000);
  });

  it("keeps a flagged bucket in the plot rather than thinning it away", () => {
    // The one bucket that broke a rule is the one a downsampler is most likely
    // to drop, and the only one an analyst is looking for.
    const rows = Array.from({ length: 4000 }, (_, index) => [`t${index}`, 10]);
    const data = buildCompare({
      columns: ["bucket", "amount"],
      rows,
      chart: spec({ type: "compare", x_field: "bucket", y_field: "amount" }),
      flags: caught("Spike", [3777]),
    });

    expect(data.points.some((point) => point.bucket === "t3777")).toBe(true);
    expect(data.hasAlerts).toBe(true);
  });
});
