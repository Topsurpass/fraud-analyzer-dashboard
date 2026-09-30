import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChartSpec, Row } from "@/contracts/api";
import { buildBiaxial, buildCartesian } from "@/services/charts/shape";
import { BiaxialBarChartView } from "./BiaxialBarChartView";
import { CartesianChartView, isTopOfStack } from "./CartesianChartView";

/**
 * Recharts measures its container before drawing and jsdom reports every box as
 * zero, so the plot itself is not reachable here. What is: the accessible
 * description, the legend, the empty states, and the pure stacking rule.
 */

const spec = (over: Partial<ChartSpec> = {}): ChartSpec => ({
  id: "c",
  name: "C",
  type: "stacked_bar",
  x_field: "hour",
  y_field: "count",
  series_field: "outcome",
  warnings: [],
  ...over,
});

describe("isTopOfStack", () => {
  const keys = ["a", "b", "c"];

  it("is true for the last series", () => {
    expect(isTopOfStack({ a: 1, b: 2, c: 3 }, keys, 2)).toBe(true);
  });

  it("is false while a later series has height here", () => {
    expect(isTopOfStack({ a: 1, b: 2, c: 3 }, keys, 0)).toBe(false);
    expect(isTopOfStack({ a: 1, b: 2, c: 3 }, keys, 1)).toBe(false);
  });

  it("skips later series that are missing, zero or negative, so the real top is rounded", () => {
    // `c` has nothing here, so `b` is the top of this column.
    expect(isTopOfStack({ a: 1, b: 2 }, keys, 1)).toBe(true);
    expect(isTopOfStack({ a: 1, b: 2, c: 0 }, keys, 1)).toBe(true);
    expect(isTopOfStack({ a: 1, b: 2, c: -5 }, keys, 1)).toBe(true);
    expect(isTopOfStack({ a: 1, b: 0, c: 0 }, keys, 0)).toBe(true);
  });

  it("treats a missing point as the top rather than throwing", () => {
    expect(isTopOfStack(undefined, keys, 0)).toBe(true);
  });
});

describe("stacked bar", () => {
  const rows: Row[] = [
    ["09", "approved", 100],
    ["09", "declined", 20],
    ["10", "approved", 120],
    ["10", "declined", 30],
  ];
  const data = buildCartesian({
    columns: ["hour", "outcome", "count"],
    rows,
    chart: spec(),
  });

  it("is described as a stacked bar chart, by points and series", () => {
    render(<CartesianChartView data={data} kind="stacked_bar" title="Outcomes" />);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Outcomes: stacked bar chart, 2 points across 2 series",
    );
  });

  it("lists each stacked series in the legend", () => {
    render(<CartesianChartView data={data} kind="stacked_bar" title="Outcomes" />);
    expect(screen.getByRole("button", { name: /approved/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /declined/ })).toBeInTheDocument();
  });

  it("says what happened instead of drawing empty axes", () => {
    const empty = buildCartesian({ columns: ["hour", "outcome", "count"], rows: [], chart: spec() });
    render(<CartesianChartView data={empty} kind="stacked_bar" title="Outcomes" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("two-axis bar", () => {
  const chart = spec({
    type: "biaxial_bar",
    y_field: "approved",
    series_field: "decline_rate",
  });

  it("names both measures and which axis each is on, in words", () => {
    const data = buildBiaxial({
      columns: ["hour", "approved", "decline_rate"],
      rows: [["09", 1500, 4.5], ["10", 1700, 6]],
      chart,
    });
    render(<BiaxialBarChartView data={data} title="Volume vs decline" />);

    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Volume vs decline: bar chart with two axes, 2 points, approved on the left axis and decline_rate on the right",
    );
    // Colour is not the only way to tell which scale a bar belongs to.
    expect(screen.getByRole("button", { name: /approved · left axis/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /decline_rate · right axis/ })).toBeInTheDocument();
  });

  it("explains a missing right-axis column rather than drawing one axis", () => {
    const data = buildBiaxial({
      columns: ["hour", "approved"],
      rows: [["09", 1500]],
      chart: { ...chart, series_field: null },
    });
    render(<BiaxialBarChartView data={data} title="T" />);

    expect(screen.getByText(/second measure/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("says flagged in words on the legend entry of a flagged side", () => {
    const data = buildBiaxial({
      columns: ["hour", "approved", "decline_rate"],
      rows: [["09", 1, 2], ["10", 3, 14]],
      chart,
      flags: {
        flagged_count: 1,
        rows: [{ index: 1, rule_ids: ["r1"] }],
        rules: [{ id: "r1", name: "Rate", severity: "high", matched: 1 }],
        warnings: [],
        dismissed_count: 0,
      },
    });
    render(<BiaxialBarChartView data={data} title="T" />);
    // One per side: the row flags both of its bars.
    expect(screen.getAllByText("anomalous")).toHaveLength(2);
  });
});
