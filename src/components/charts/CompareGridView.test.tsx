import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildCompareGrid } from "@/services/charts/shape";
import type { ChartSpec } from "@/contracts/api";
import { CompareGridView } from "./CompareGridView";

const spec: ChartSpec = {
  id: "c",
  name: "Per terminal",
  type: "compare_grid",
  x_field: "bucket",
  y_field: "amount",
  series_field: "terminal",
  warnings: [],
};

function build(rows: (string | number | null)[][], flags = null) {
  return buildCompareGrid({ columns: ["bucket", "terminal", "amount"], rows, chart: spec, flags });
}

/** T1 rises tenfold, T2 collapses, T3 barely moves. */
const sample = build([
  ["09", "T1", 10],
  ["09", "T2", 500],
  ["09", "T3", 50],
  ["10", "T1", 20],
  ["10", "T2", 500],
  ["10", "T3", 50],
  ["11", "T1", 100],
  ["11", "T2", 10],
  ["11", "T3", 55],
  ["12", "T1", 200],
  ["12", "T2", 10],
  ["12", "T3", 55],
]);

describe("CompareGridView", () => {
  it("draws a panel per category, each with both windows", () => {
    const { container } = render(<CompareGridView data={sample} title="Per terminal" />);

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    // Two polylines per panel: one window each.
    expect(container.querySelectorAll("polyline")).toHaveLength(6);
  });

  it("names each panel and orders them by how far the category moved", () => {
    render(<CompareGridView data={sample} title="Per terminal" />);

    const names = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(names[0]).toContain("T2");
    expect(names[1]).toContain("T1");
    expect(names[2]).toContain("T3");
  });

  it("prints each panel's own totals and peak, since panels are scaled apart", () => {
    // Two panels of identical height can be a hundredfold apart, and without
    // the peak nothing on screen would say so.
    render(<CompareGridView data={sample} title="Per terminal" />);

    const t1 = screen.getAllByRole("listitem")[1];
    expect(within(t1).getByText("30")).toBeInTheDocument();
    expect(within(t1).getByText("300")).toBeInTheDocument();
    expect(within(t1).getByText("200")).toBeInTheDocument();
  });

  it("gives each panel an accessible description carrying both totals", () => {
    // The lines themselves are unreadable to a screen reader; the label is the
    // only place the panel's content exists as text.
    render(<CompareGridView data={sample} title="Per terminal" />);

    expect(
      screen.getByRole("img", { name: /T1: 30 in 09–10, 300 in 11–12, \+900%/ }),
    ).toBeInTheDocument();
  });

  it("names the two windows it compared", () => {
    render(<CompareGridView data={sample} title="Per terminal" />);

    expect(screen.getByText("09–10")).toBeInTheDocument();
    expect(screen.getByText("11–12")).toBeInTheDocument();
  });

  it("marks direction with a glyph and a sign, not colour alone", () => {
    render(<CompareGridView data={sample} title="Per terminal" />);

    const t2 = screen.getAllByRole("listitem")[0];
    expect(t2.textContent).toContain("↓");
    expect(t2.textContent).toContain("−98%");
  });

  it("shows only the biggest movers, with the rest a click away", () => {
    // Twenty quiet panels ahead of the interesting ones is a scroll, not a
    // chart.
    const rows: (string | number)[][] = [];
    for (let index = 0; index < 14; index += 1) {
      rows.push(["09", `T${index}`, 1]);
      rows.push(["10", `T${index}`, 1 + index]);
    }
    render(<CompareGridView data={build(rows)} title="Per terminal" />);

    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "Show 6 quieter" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(14);
  });

  it("does not offer to expand when every panel is already shown", () => {
    render(<CompareGridView data={sample} title="Per terminal" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("puts a mark on the exact bucket that was flagged", () => {
    const data = build(
      [
        ["09", "T1", 10],
        ["10", "T1", 10],
        ["11", "T1", 10],
        ["12", "T1", 900],
      ],
      {
        flagged_count: 1,
        rows: [{ index: 3, rule_ids: ["r1"] }],
        rules: [{ id: "r1", name: "Spike", severity: "high", matched: 1 }],
        warnings: [],
        dismissed_count: 0,
      } as never,
    );
    const { container } = render(<CompareGridView data={data} title="Per terminal" />);

    // One dot, on the one flagged bucket, not on the panel as a whole.
    expect(container.querySelectorAll("circle")).toHaveLength(1);
  });

  it("explains why it drew nothing when there is only one bucket", () => {
    const data = build([
      ["09", "T1", 5],
      ["09", "T2", 6],
    ]);
    render(<CompareGridView data={data} title="Per terminal" />);

    expect(screen.getByText(/at least two time buckets/)).toBeInTheDocument();
  });

  it("emits the exact selector the browser smoke lane counts", () => {
    // scripts/smoke.mjs counts `polyline`; that lane needs a real browser, so
    // the selector is pinned here to keep it from silently becoming a no-op.
    const { container } = render(<CompareGridView data={sample} title="Per terminal" />);

    expect(container.querySelectorAll("polyline").length).toBeGreaterThanOrEqual(2);
  });
});
