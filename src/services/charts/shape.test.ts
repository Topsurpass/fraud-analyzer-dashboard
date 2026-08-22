import { describe, expect, it } from "vitest";
import type { ChartSpec } from "@/contracts/api";
import {
  buildCartesian,
  buildNumber,
  buildPie,
  buildTable,
  resolveFields,
  toNumber,
} from "./shape";

const spec = (overrides: Partial<ChartSpec> = {}): ChartSpec => ({
  type: "line",
  x_field: null,
  y_field: null,
  series_field: null,
  warnings: [],
  ...overrides,
});

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

  it("marks a spike with the alert mask and says why", () => {
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
    expect(built.hasAlerts).toBe(true);
    expect(built.alertReason).toBe("outlier");
    expect(built.data[5].__alert).toEqual({ flagged: true });
    expect(built.data[0].__alert).toEqual({ flagged: false });
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

  it("judges each pivoted series on its own scale", () => {
    // `web` runs an order of magnitude higher than `api`; the api spike must be
    // caught and no web point should be flagged just for being large.
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
    });
    expect(built.data[5].__alert).toMatchObject({ api: true });
    expect(built.data[5].__alert?.web).toBeUndefined();
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

  it("marks rows the flag column already condemned", () => {
    const built = buildTable({
      columns: ["id", "amount", "is_flagged"],
      rows: [[1, 10, 0], [2, 20, 1]],
      chart: spec({ type: "table" }),
    });
    expect(built.alerts).toEqual([false, true]);
    expect(built.alertReason).toBe("flag-column");
    expect(built.alertSource).toBe("is_flagged");
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
