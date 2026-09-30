import { describe, expect, it } from "vitest";
import type { ChartSpec, FlagOutcome, Row } from "@/contracts/api";
import { MAX_PLOT_POINTS } from "./downsample";
import { buildBiaxial } from "./shape";

/**
 * A two-axis chart reads one row per x with a column per measure. The field
 * mapping is unusual - `series_field` is the right-hand measure, because a chart
 * spec has one `y_field` - so these pin the mapping and what it does when the
 * query does not fit it.
 */

const spec = (over: Partial<ChartSpec> = {}): ChartSpec => ({
  id: "c",
  name: "C",
  type: "biaxial_bar",
  x_field: "hour",
  y_field: "approved",
  series_field: "decline_rate",
  warnings: [],
  ...over,
});

const COLUMNS = ["hour", "approved", "decline_rate"];

function flags(index: number): FlagOutcome {
  return {
    flagged_count: 1,
    rows: [{ index, rule_ids: ["r1"] }],
    rules: [{ id: "r1", name: "Rate over 10%", severity: "high", matched: 1 }],
    warnings: [],
    dismissed_count: 0,
  };
}

describe("buildBiaxial", () => {
  it("puts y_field on the left and series_field on the right, one point per row", () => {
    const data = buildBiaxial({
      columns: COLUMNS,
      rows: [["09", 1500, 4.5], ["10", 1700, 6]],
      chart: spec(),
    });
    expect(data.xKey).toBe("hour");
    expect(data.leftKey).toBe("approved");
    expect(data.rightKey).toBe("decline_rate");
    expect(data.data).toHaveLength(2);
    expect(data.data[1]).toMatchObject({ hour: "10", approved: 1700, decline_rate: 6 });
  });

  it("reads numeric strings, as MySQL and SQLite return them", () => {
    const data = buildBiaxial({
      columns: COLUMNS,
      rows: [["09", "1500", "4.5"]],
      chart: spec(),
    });
    expect(data.data[0]).toMatchObject({ approved: 1500, decline_rate: 4.5 });
  });

  it("turns a non-numeric cell into a gap, not a bar of unknown height", () => {
    const data = buildBiaxial({
      columns: COLUMNS,
      rows: [["09", null, "n/a"]],
      chart: spec(),
    });
    expect(data.data[0].approved).toBeNull();
    expect(data.data[0].decline_rate).toBeNull();
  });

  it("says what is missing when there is no right-axis column, and draws nothing", () => {
    const data = buildBiaxial({
      columns: COLUMNS,
      rows: [["09", 1, 2]],
      chart: spec({ series_field: null }),
    });
    expect(data.data).toEqual([]);
    expect(data.warnings.at(-1)).toMatch(/second measure/);
  });

  it("refuses one column on both axes, which is a single bar drawn twice", () => {
    const data = buildBiaxial({
      columns: COLUMNS,
      rows: [["09", 1, 2]],
      chart: spec({ series_field: "approved" }),
    });
    expect(data.data).toEqual([]);
    expect(data.warnings.at(-1)).toMatch(/different column/);
  });

  it("warns when the named right-axis column is not in the result", () => {
    const data = buildBiaxial({
      columns: COLUMNS,
      rows: [["09", 1, 2]],
      chart: spec({ series_field: "nope" }),
    });
    expect(data.data).toEqual([]);
    expect(data.warnings.join(" ")).toContain('series_field "nope" is not in the result set');
  });

  it("flags both bars of a flagged row, with the rule named, and no other row", () => {
    const data = buildBiaxial({
      columns: COLUMNS,
      rows: [["09", 1, 2], ["10", 3, 14]],
      chart: spec(),
      flags: flags(1),
    });
    expect(data.hasAlerts).toBe(true);
    expect(data.data[1].__alert).toEqual({ approved: true, decline_rate: true });
    expect(data.data[1].__flag?.decline_rate).toEqual({
      rules: ["Rate over 10%"],
      severity: "high",
    });
    expect(data.data[0].__alert).toEqual({ approved: false, decline_rate: false });
    expect(data.data[0].__flag).toBeUndefined();
  });

  it("bounds the plot but keeps every flagged point", () => {
    const rows: Row[] = Array.from({ length: MAX_PLOT_POINTS * 4 }, (_row, index) => [
      `t${index}`,
      index % 50,
      index % 7,
    ]);
    const flaggedIndex = 1234;
    const data = buildBiaxial({ columns: COLUMNS, rows, chart: spec(), flags: flags(flaggedIndex) });
    expect(data.data.length).toBeLessThanOrEqual(MAX_PLOT_POINTS + 1);
    expect(data.data.some((point) => point.hour === `t${flaggedIndex}`)).toBe(true);
  });
});
