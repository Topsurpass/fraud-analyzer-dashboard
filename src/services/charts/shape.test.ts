import { describe, expect, it } from "vitest";
import type { ChartSpec, FlagOutcome } from "@/contracts/api";
import { MAX_PLOT_POINTS } from "./downsample";
import { DEFAULT_SURGE_THRESHOLD_PCT } from "./severity";
import {
  MAX_HEAT_BUCKETS,
  MAX_HEAT_ROWS,
  MAX_MOVER_ROWS,
  MAX_PANELS,
  panelSegments,
  buildCartesian,
  buildCompare,
  buildHeatmap,
  buildCompareGrid,
  buildMovers,
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

describe("buildMovers", () => {
  const byTerminal = spec({
    type: "movers",
    x_field: "bucket",
    y_field: "amount",
    series_field: "terminal",
  });

  /** Rows grouped by (bucket, terminal), the way such a query returns them. */
  const result = (rows: (string | number | null)[][], flags?: FlagOutcome) => ({
    columns: ["bucket", "terminal", "amount"],
    rows,
    chart: byTerminal,
    ...(flags ? { flags } : {}),
  });

  it("totals each terminal across the older and newer halves of the buckets", () => {
    const data = buildMovers(
      result([
        ["09", "T1", 10],
        ["09", "T2", 5],
        ["10", "T1", 20],
        ["10", "T2", 5],
        // 09 and 10 are the previous window; 11 and 12 the current one.
        ["11", "T1", 100],
        ["11", "T2", 5],
        ["12", "T1", 100],
        ["12", "T2", 5],
      ]),
    );

    const t1 = data.rows.find((row) => row.category === "T1");
    expect(t1).toMatchObject({ previous: 30, current: 200, delta: 170 });
    const t2 = data.rows.find((row) => row.category === "T2");
    expect(t2).toMatchObject({ previous: 10, current: 10, delta: 0 });
  });

  it("splits on distinct buckets, not on row position", () => {
    /*
     * The regression that matters. Rows are interleaved by terminal, so
     * halving the row list would put T1's 10:00 in the previous window and
     * T2's 10:00 in the current one - every total silently wrong.
     */
    const data = buildMovers(
      result([
        ["09", "A", 1],
        ["09", "B", 1],
        ["09", "C", 1],
        ["10", "A", 8],
        ["10", "B", 8],
        ["10", "C", 8],
      ]),
    );

    for (const row of data.rows) {
      expect(row.previous).toBe(1);
      expect(row.current).toBe(8);
    }
  });

  it("ranks by the size of the change, not by either total", () => {
    // T1 is far bigger in absolute terms; T2 is the one that moved. The
    // biggest terminal is a fact an analyst already knows.
    const data = buildMovers(
      result([
        ["09", "T1", 1000],
        ["09", "T2", 10],
        ["10", "T1", 1010],
        ["10", "T2", 500],
      ]),
    );

    expect(data.rows[0].category).toBe("T2");
  });

  it("ranks a collapse as highly as a spike", () => {
    // A terminal going dark is as much a finding as one lighting up.
    const data = buildMovers(
      result([
        ["09", "Quiet", 900],
        ["09", "Steady", 100],
        ["10", "Quiet", 0],
        ["10", "Steady", 110],
      ]),
    );

    expect(data.rows[0].category).toBe("Quiet");
    expect(data.rows[0].delta).toBe(-900);
  });

  it("reports proportional change, and refuses to compute it against zero", () => {
    const data = buildMovers(
      result([
        ["09", "Grew", 100],
        ["09", "New", 0],
        ["10", "Grew", 150],
        ["10", "New", 40],
      ]),
    );

    expect(data.rows.find((row) => row.category === "Grew")?.pctChange).toBeCloseTo(0.5);
    // 0 -> 40 is not "up 100%": a ratio against zero has no value.
    expect(data.rows.find((row) => row.category === "New")?.pctChange).toBeNull();
  });

  it("names the buckets each window spans", () => {
    const data = buildMovers(
      result([
        ["09", "T1", 1],
        ["10", "T1", 1],
        ["11", "T1", 1],
        ["12", "T1", 1],
      ]),
    );

    expect(data.previousSpan).toEqual(["09", "10"]);
    expect(data.currentSpan).toEqual(["11", "12"]);
  });

  it("drops the oldest bucket when there is an odd number of them", () => {
    // Three buckets cannot make two equal windows, and the dropped bucket must
    // land in neither total rather than skewing one.
    const data = buildMovers(
      result([
        ["09", "T1", 99],
        ["10", "T1", 1],
        ["11", "T1", 5],
      ]),
    );

    expect(data.rows[0]).toMatchObject({ previous: 1, current: 5 });
    expect(data.warnings.join(" ")).toContain("oldest was dropped");
  });

  it("totals the whole window even when the ranking is capped", () => {
    const rows: (string | number)[][] = [];
    for (let index = 0; index < MAX_MOVER_ROWS + 10; index += 1) {
      rows.push(["09", `T${index}`, 1]);
      rows.push(["10", `T${index}`, 1 + index]);
    }

    const data = buildMovers(result(rows));

    expect(data.rows).toHaveLength(MAX_MOVER_ROWS);
    expect(data.warnings.join(" ")).toContain(`of ${MAX_MOVER_ROWS + 10} categories`);
    // Every category counts toward the headline, including the cut ones.
    expect(data.previousTotal).toBe(MAX_MOVER_ROWS + 10);
  });

  it("marks a category any of whose rows were flagged", () => {
    const data = buildMovers(
      result(
        [
          ["09", "T1", 10],
          ["09", "T2", 10],
          ["10", "T1", 900],
          ["10", "T2", 10],
        ],
        caught("Spike", [2]),
      ),
    );

    expect(data.rows.find((row) => row.category === "T1")?.alert).toBe(true);
    expect(data.rows.find((row) => row.category === "T2")?.alert).toBe(false);
    expect(data.hasAlerts).toBe(true);
  });

  it("asks for a category column instead of guessing one", () => {
    const data = buildMovers({
      columns: ["bucket", "amount"],
      rows: [
        ["09", 5],
        ["10", 6],
      ],
      chart: spec({ type: "movers", x_field: "bucket", y_field: "amount" }),
    });

    expect(data.rows).toEqual([]);
    expect(data.warnings.join(" ")).toContain("category column");
  });

  it("refuses to compare when the result holds a single bucket", () => {
    const data = buildMovers(
      result([
        ["09", "T1", 5],
        ["09", "T2", 6],
      ]),
    );

    expect(data.rows).toEqual([]);
    expect(data.warnings.join(" ")).toContain("at least two time buckets");
  });
});

describe("buildCompareGrid", () => {
  const byTerminal = spec({
    type: "compare_grid",
    x_field: "bucket",
    y_field: "amount",
    series_field: "terminal",
  });

  const result = (rows: (string | number | null)[][], flags?: FlagOutcome) => ({
    columns: ["bucket", "terminal", "amount"],
    rows,
    chart: byTerminal,
    ...(flags ? { flags } : {}),
  });

  /** Four buckets, two terminals, interleaved the way such a query returns. */
  const sample = result([
    ["09", "T1", 10],
    ["09", "T2", 500],
    ["10", "T1", 20],
    ["10", "T2", 500],
    ["11", "T1", 100],
    ["11", "T2", 10],
    ["12", "T1", 200],
    ["12", "T2", 10],
  ]);

  it("gives each category its own panel of aligned points", () => {
    const data = buildCompareGrid(sample);

    expect(data.panels).toHaveLength(2);
    const t1 = data.panels.find((panel) => panel.category === "T1");
    // Two buckets a side: 11 sits over 09, 12 over 10.
    expect(t1?.points.map((point) => point.previous)).toEqual([10, 20]);
    expect(t1?.points.map((point) => point.current)).toEqual([100, 200]);
  });

  it("aligns each panel by position within its window, not by bucket label", () => {
    const data = buildCompareGrid(sample);
    const t1 = data.panels.find((panel) => panel.category === "T1");

    // The axis reads as the current window; each point names where its
    // previous value was actually measured.
    expect(t1?.points.map((point) => point.bucket)).toEqual(["11", "12"]);
    expect(t1?.points.map((point) => point.previousBucket)).toEqual(["09", "10"]);
  });

  it("splits on distinct buckets, not on row position", () => {
    /*
     * The regression that matters, same as buildMovers: rows are interleaved
     * by terminal, so halving the row list would put T1's 10 in the previous
     * window and T2's 10 in the current one.
     */
    const data = buildCompareGrid(
      result([
        ["09", "A", 1],
        ["09", "B", 1],
        ["09", "C", 1],
        ["10", "A", 8],
        ["10", "B", 8],
        ["10", "C", 8],
      ]),
    );

    for (const panel of data.panels) {
      expect(panel.points.map((point) => point.previous)).toEqual([1]);
      expect(panel.points.map((point) => point.current)).toEqual([8]);
    }
  });

  it("ranks panels by how far each category moved", () => {
    const data = buildCompareGrid(sample);

    // T2 fell by 980, T1 rose by 270.
    expect(data.panels.map((panel) => panel.category)).toEqual(["T2", "T1"]);
  });

  it("scales each panel to its own peak so a big neighbour cannot flatten it", () => {
    // T2 does fifty times T1's volume. On a shared scale T1 would be a
    // straight line on the axis, which is the failure this chart exists to
    // avoid.
    const data = buildCompareGrid(sample);

    expect(data.panels.find((panel) => panel.category === "T1")?.peak).toBe(200);
    expect(data.panels.find((panel) => panel.category === "T2")?.peak).toBe(500);
  });

  it("totals each window per panel and reports the proportional change", () => {
    const data = buildCompareGrid(sample);
    const t1 = data.panels.find((panel) => panel.category === "T1");

    expect(t1).toMatchObject({ previousTotal: 30, currentTotal: 300, delta: 270 });
    expect(t1?.pctChange).toBeCloseTo(9);
  });

  it("refuses a percentage when the previous window was zero", () => {
    const data = buildCompareGrid(
      result([
        ["09", "New", 0],
        ["10", "New", 0],
        ["11", "New", 40],
        ["12", "New", 40],
      ]),
    );

    expect(data.panels[0].pctChange).toBeNull();
  });

  it("leaves a missing bucket null instead of reading it as zero", () => {
    // A terminal that returned no row for an hour was not necessarily idle in
    // it, and only the query knows which. Guessing zero invents a cliff.
    const data = buildCompareGrid(
      result([
        ["09", "T1", 5],
        ["10", "T1", 5],
        ["11", "T1", 7],
        // No 12:00 row for T1 at all.
        ["12", "T2", 1],
        ["09", "T2", 1],
        ["10", "T2", 1],
        ["11", "T2", 1],
      ]),
    );

    const t1 = data.panels.find((panel) => panel.category === "T1");
    expect(t1?.points.map((point) => point.current)).toEqual([7, null]);
  });

  it("names the buckets each window covers", () => {
    const data = buildCompareGrid(sample);

    expect(data.previousSpan).toEqual(["09", "10"]);
    expect(data.currentSpan).toEqual(["11", "12"]);
    expect(data.buckets).toEqual(["11", "12"]);
  });

  it("drops the oldest bucket when there is an odd number of them", () => {
    const data = buildCompareGrid(
      result([
        ["09", "T1", 99],
        ["10", "T1", 1],
        ["11", "T1", 5],
      ]),
    );

    expect(data.panels[0].points.map((point) => point.previous)).toEqual([1]);
    expect(data.panels[0].points.map((point) => point.current)).toEqual([5]);
    expect(data.warnings.join(" ")).toContain("oldest was dropped");
  });

  it("sums a repeated bucket and category pair into the one slot it describes", () => {
    const data = buildCompareGrid(
      result([
        ["09", "T1", 5],
        ["10", "T1", 1],
        ["10", "T1", 2],
      ]),
    );

    // 09 is dropped as the odd bucket; 10 is the current window and holds both.
    expect(data.panels[0].points[0].current).toBe(3);
  });

  it("caps the number of panels and says how many it dropped", () => {
    const rows: (string | number)[][] = [];
    for (let index = 0; index < MAX_PANELS + 6; index += 1) {
      rows.push(["09", `T${index}`, 1]);
      rows.push(["10", `T${index}`, 1 + index]);
    }

    const data = buildCompareGrid(result(rows));

    expect(data.panels).toHaveLength(MAX_PANELS);
    expect(data.warnings.join(" ")).toContain(`of ${MAX_PANELS + 6} categories`);
  });

  it("marks the panel and the exact bucket a flagged row landed in", () => {
    const data = buildCompareGrid(
      result(
        [
          ["09", "T1", 10],
          ["10", "T1", 10],
          ["11", "T1", 10],
          ["12", "T1", 900],
        ],
        // Row 3 is T1 at 12:00, the last bucket of the current window.
        caught("Spike", [3]),
      ),
    );

    expect(data.panels[0].alert).toBe(true);
    expect(data.panels[0].points.map((point) => point.alert)).toEqual([false, true]);
    expect(data.hasAlerts).toBe(true);
  });

  it("asks for a category column instead of guessing one", () => {
    const data = buildCompareGrid({
      columns: ["bucket", "amount"],
      rows: [
        ["09", 5],
        ["10", 6],
      ],
      chart: spec({ type: "compare_grid", x_field: "bucket", y_field: "amount" }),
    });

    expect(data.panels).toEqual([]);
    expect(data.warnings.join(" ")).toContain("category column");
  });

  it("refuses to compare when the result holds a single bucket", () => {
    const data = buildCompareGrid(
      result([
        ["09", "T1", 5],
        ["09", "T2", 6],
      ]),
    );

    expect(data.panels).toEqual([]);
    expect(data.warnings.join(" ")).toContain("at least two time buckets");
  });
});

describe("panelSegments", () => {
  it("maps values onto the box with the peak at the top", () => {
    // y is inverted: the peak sits at 0 and a zero sits on the baseline.
    expect(panelSegments([0, 10], 100, 20, 10)).toEqual(["0.00,20.00 100.00,0.00"]);
  });

  it("breaks the line at a gap rather than drawing through it", () => {
    // A straight line across a missing bucket invents activity that was never
    // queried, and it is indistinguishable from a real trend.
    const segments = panelSegments([1, 1, null, 1, 1], 100, 20, 1);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toBe("0.00,0.00 25.00,0.00");
    expect(segments[1]).toBe("75.00,0.00 100.00,0.00");
  });

  it("drops a lone point, which would render as nothing anyway", () => {
    expect(panelSegments([null, 5, null], 100, 20, 5)).toEqual([]);
  });

  it("draws a flat line rather than dividing by a zero peak", () => {
    expect(panelSegments([0, 0], 100, 20, 0)).toEqual(["0.00,20.00 100.00,20.00"]);
  });

  it("returns nothing for an empty window", () => {
    expect(panelSegments([], 100, 20, 10)).toEqual([]);
  });
});

describe("surge thresholds on the period charts", () => {
  const gridSpec = (threshold: number | null) =>
    spec({
      type: "compare_grid",
      x_field: "bucket",
      y_field: "amount",
      series_field: "terminal",
      surge_threshold_pct: threshold,
    });

  /** T1 doubles, T2 holds steady. */
  const twoTerminals = (threshold: number | null) => ({
    columns: ["bucket", "terminal", "amount"],
    rows: [
      ["09", "T1", 100],
      ["09", "T2", 100],
      ["10", "T1", 200],
      ["10", "T2", 105],
    ],
    chart: gridSpec(threshold),
  });

  it("judges each panel against the chart's own threshold", () => {
    const data = buildCompareGrid(twoTerminals(50));

    expect(data.threshold).toBe(50);
    expect(data.panels.find((panel) => panel.category === "T1")?.verdict.severity).toBe("surge");
    expect(data.panels.find((panel) => panel.category === "T2")?.verdict.severity).toBe("normal");
  });

  it("goes quiet when the threshold is raised above the movement", () => {
    // The whole point of configuring it: a card watching the overnight window
    // carries a bigger number so the ordinary nightly fall stays unbadged.
    const data = buildCompareGrid(twoTerminals(150));

    expect(data.panels.every((panel) => panel.verdict.severity === "normal")).toBe(true);
    expect(data.surgingCount).toBe(0);
  });

  it("falls back to the default when a chart carries no threshold", () => {
    const data = buildCompareGrid(twoTerminals(null));

    expect(data.threshold).toBe(DEFAULT_SURGE_THRESHOLD_PCT);
  });

  it("counts surging categories before the panel cap, not after", () => {
    // The card's summary describes the data; counting after the slice would
    // report only the ones that happened to fit on screen.
    const rows: (string | number)[][] = [];
    for (let index = 0; index < MAX_PANELS + 6; index += 1) {
      rows.push(["09", `T${index}`, 1]);
      rows.push(["10", `T${index}`, 10]);
    }

    const data = buildCompareGrid({
      columns: ["bucket", "terminal", "amount"],
      rows,
      chart: gridSpec(50),
    });

    expect(data.panels).toHaveLength(MAX_PANELS);
    expect(data.surgingCount).toBe(MAX_PANELS + 6);
  });

  it("finds the single hour that jumped even when the totals barely moved", () => {
    /*
     * The reason bucket-level surges exist at all. This terminal's two windows
     * total 210 against 210 - dead flat - while one hour inside the current
     * window went from 5 to 200.
     */
    const data = buildCompareGrid({
      columns: ["bucket", "terminal", "amount"],
      rows: [
        ["09", "T1", 105],
        ["10", "T1", 105],
        ["11", "T1", 5],
        ["12", "T1", 205],
      ],
      chart: gridSpec(50),
    });

    const panel = data.panels[0];
    expect(panel.verdict.severity).toBe("normal");
    expect(panel.surges.map((surge) => surge.index)).toEqual([1]);
    expect(panel.surges[0].verdict.severity).toBe("surge");
  });

  it("never compares across the join between the two windows", () => {
    /*
     * The previous window's last bucket and the current window's first are
     * adjacent in the array and a whole window apart in time. Judging that
     * step would report a surge at an hour whose neighbour was six hours ago.
     */
    const data = buildCompareGrid({
      columns: ["bucket", "terminal", "amount"],
      rows: [
        ["09", "T1", 1000],
        ["10", "T1", 1000],
        // A huge step down from the previous window, but flat within its own.
        ["11", "T1", 10],
        ["12", "T1", 10],
      ],
      chart: gridSpec(50),
    });

    expect(data.panels[0].surges).toEqual([]);
    // The window-over-window verdict still catches it, which is its job.
    expect(data.panels[0].verdict.severity).toBe("drop");
  });

  it("judges movers rows against the same threshold", () => {
    const data = buildMovers({
      columns: ["bucket", "terminal", "amount"],
      rows: [
        ["09", "T1", 100],
        ["09", "T2", 100],
        ["10", "T1", 200],
        ["10", "T2", 105],
      ],
      chart: spec({
        type: "movers",
        x_field: "bucket",
        y_field: "amount",
        series_field: "terminal",
        surge_threshold_pct: 50,
      }),
    });

    expect(data.threshold).toBe(50);
    expect(data.surgingCount).toBe(1);
    expect(data.rows.find((row) => row.category === "T1")?.verdict.severity).toBe("surge");
  });

  it("judges the compare headline against the threshold too", () => {
    const data = buildCompare({
      columns: ["bucket", "amount"],
      rows: [
        ["t0", 100],
        ["t1", 100],
        ["t2", 300],
        ["t3", 300],
      ],
      chart: spec({
        type: "compare",
        x_field: "bucket",
        y_field: "amount",
        surge_threshold_pct: 50,
      }),
    });

    expect(data.verdict.severity).toBe("surge");
    expect(data.verdict.pctChange).toBeCloseTo(2);
  });
});

describe("counting what is worth investigating", () => {
  const gridSpec = spec({
    type: "compare_grid",
    x_field: "bucket",
    y_field: "amount",
    series_field: "terminal",
    surge_threshold_pct: 120,
  });

  it("counts a panel whose hours jumped even when its totals did not", () => {
    /*
     * Taken from the live Fundgate data: 7017010168's six-hour total fell 77%
     * while one hour inside it rose 18,000%. Counting only window totals
     * reported that card as having nothing to look at, which is the exact
     * opposite of the truth.
     */
    const data = buildCompareGrid({
      columns: ["bucket", "terminal", "amount"],
      rows: [
        ["09", "T1", 100],
        ["10", "T1", 100],
        ["11", "T1", 105],
        // Inside the current window: a 100x jump against the hour before.
        ["12", "T1", 10_500],
      ],
      chart: gridSpec,
    });

    expect(data.panels[0].verdict.severity).toBe("surge");
    expect(data.panels[0].surges).toHaveLength(1);
    expect(data.surgingCount).toBe(1);
  });

  it("counts an hour-level jump on a panel whose window change stayed quiet", () => {
    const data = buildCompareGrid({
      columns: ["bucket", "terminal", "amount"],
      rows: [
        ["09", "T1", 105],
        ["10", "T1", 105],
        ["11", "T1", 5],
        ["12", "T1", 205],
      ],
      chart: gridSpec,
    });

    // Two windows of 210 against 210: dead flat, and still worth opening.
    expect(data.panels[0].verdict.severity).toBe("normal");
    expect(data.panels[0].surges.length).toBeGreaterThan(0);
    expect(data.surgingCount).toBe(1);
  });

  it("counts a panel once however many ways it crossed", () => {
    const data = buildCompareGrid({
      columns: ["bucket", "terminal", "amount"],
      rows: [
        ["09", "T1", 100],
        ["10", "T1", 100],
        ["11", "T1", 5000],
        ["12", "T1", 50_000],
      ],
      chart: gridSpec,
    });

    expect(data.surgingCount).toBe(1);
  });

  it("stays at zero when nothing crossed either way", () => {
    const data = buildCompareGrid({
      columns: ["bucket", "terminal", "amount"],
      rows: [
        ["09", "T1", 100],
        ["10", "T1", 100],
        ["11", "T1", 105],
        ["12", "T1", 108],
      ],
      chart: gridSpec,
    });

    expect(data.surgingCount).toBe(0);
  });
});
