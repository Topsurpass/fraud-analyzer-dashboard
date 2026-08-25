import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildHeatmap } from "@/services/charts/shape";
import type { ChartSpec } from "@/contracts/api";
import { HeatmapView } from "./HeatmapView";

const grid: ChartSpec = {
  id: "c",
  name: "By terminal",
  type: "heatmap",
  x_field: "hour",
  y_field: "amount",
  series_field: "terminal",
  warnings: [],
};

function build(rows: (string | number | null)[][], flags = null) {
  return buildHeatmap({
    columns: ["hour", "terminal", "amount"],
    rows,
    chart: grid,
    flags,
  });
}

const sample = build([
  ["09", "T1", 10],
  ["10", "T1", 90],
  ["09", "T2", 20],
  ["10", "T2", 30],
]);

describe("HeatmapView", () => {
  it("gives every category a row header a screen reader can reach", () => {
    render(<HeatmapView data={sample} title="By terminal" />);

    // A row header, not a plain cell: this is what makes the grid navigable
    // rather than a wall of unlabelled colour.
    expect(screen.getByRole("rowheader", { name: "T1" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "T2" })).toBeInTheDocument();
  });

  it("describes the grid's size in the accessible name of the table", () => {
    render(<HeatmapView data={sample} title="By terminal" />);

    expect(
      screen.getByRole("table", { name: /2 categories across 2 buckets/ }),
    ).toBeInTheDocument();
  });

  it("pins the hovered value to a readout instead of a floating tooltip", () => {
    // A tooltip under the pointer hides the neighbouring cells, which are the
    // comparison the chart exists to make.
    render(<HeatmapView data={sample} title="By terminal" />);

    // mouseOver, not mouseEnter: React derives enter/leave from the bubbling
    // mouseover at the root, so a dispatched mouseenter never reaches it.
    fireEvent.mouseOver(screen.getByTitle("T1 · 10 · 90"));

    expect(screen.getByText("T1 · 10 · 90")).toBeInTheDocument();
  });

  it("shows the value range when nothing is hovered", () => {
    render(<HeatmapView data={sample} title="By terminal" />);

    expect(screen.getByText(/2 categories · 2 buckets/)).toBeInTheDocument();
  });

  it("says a cell has no rows rather than calling it zero", () => {
    const data = build([
      ["09", "T1", 10],
      ["10", "T2", 90],
    ]);
    render(<HeatmapView data={data} title="By terminal" />);

    expect(screen.getByTitle("T1 · 10 · no rows")).toBeInTheDocument();
  });

  it("outlines a flagged cell instead of tinting it, so big and flagged stay apart", () => {
    const data = build(
      [
        ["09", "T1", 10],
        ["10", "T1", 90],
      ],
      // Row 1 is the 10:00 cell.
      {
        flagged_count: 1,
        rows: [{ index: 1, rule_ids: ["r1"] }],
        rules: [{ id: "r1", name: "Spike", severity: "high", matched: 1 }],
        warnings: [],
        dismissed_count: 0,
      } as never,
    );
    render(<HeatmapView data={data} title="By terminal" />);

    expect(screen.getByTitle("T1 · 10 · 90")).toHaveStyle({
      outline: "1.5px solid var(--signal-alert)",
    });
    // And the legend explains what the outline means.
    expect(screen.getByText("flagged")).toBeInTheDocument();
  });

  it("emits the exact selector the browser smoke lane counts", () => {
    // scripts/smoke.mjs proves a heatmap drew something by counting
    // `th[scope=row]`. That lane needs a real browser, so this pins the
    // selector here: if the markup changes, this fails in the free lane rather
    // than silently turning the paid one into a no-op.
    const { container } = render(<HeatmapView data={sample} title="By terminal" />);

    expect(container.querySelectorAll("th[scope=row]")).toHaveLength(sample.rows.length);
  });

  it("renders the empty state with the reason the grid could not be built", () => {
    const data = buildHeatmap({
      columns: ["hour", "amount"],
      rows: [["09", 5]],
      chart: { ...grid, series_field: null },
    });

    render(<HeatmapView data={data} title="By terminal" />);

    expect(screen.getByText(/category column/)).toBeInTheDocument();
  });
});
