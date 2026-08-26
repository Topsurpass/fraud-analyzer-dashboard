import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildMovers } from "@/services/charts/shape";
import type { ChartSpec } from "@/contracts/api";
import { MoversView } from "./MoversView";

const spec: ChartSpec = {
  id: "c",
  name: "Movers",
  type: "movers",
  x_field: "bucket",
  y_field: "amount",
  series_field: "terminal",
  warnings: [],
};

function build(rows: (string | number | null)[][], flags = null) {
  return buildMovers({ columns: ["bucket", "terminal", "amount"], rows, chart: spec, flags });
}

/** T1 quadruples, T2 goes dark, T3 barely moves. */
const sample = build([
  ["09", "T1", 100],
  ["09", "T2", 500],
  ["09", "T3", 50],
  ["10", "T1", 100],
  ["10", "T2", 500],
  ["10", "T3", 50],
  ["11", "T1", 400],
  ["11", "T2", 10],
  ["11", "T3", 55],
  ["12", "T1", 400],
  ["12", "T2", 10],
  ["12", "T3", 55],
]);

describe("MoversView", () => {
  it("gives every category a row header naming the terminal", () => {
    render(<MoversView data={sample} title="Movers" />);

    expect(screen.getByRole("rowheader", { name: /T1/ })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /T2/ })).toBeInTheDocument();
  });

  it("puts the biggest mover first, whichever direction it moved", () => {
    render(<MoversView data={sample} title="Movers" />);

    // T2 fell by 980, T1 rose by 600. Order is by size of change.
    const headers = screen.getAllByRole("rowheader").map((cell) => cell.textContent);
    expect(headers[0]).toContain("T2");
    expect(headers[1]).toContain("T1");
    expect(headers[2]).toContain("T3");
  });

  it("shows each terminal's current total and its proportional change", () => {
    render(<MoversView data={sample} title="Movers" />);

    const t1 = screen.getByRole("row", { name: /T1/ });
    expect(within(t1).getByText("800")).toBeInTheDocument();
    // 200 -> 800 is a quadrupling.
    expect(t1.textContent).toContain("+300%");
  });

  it("marks direction with a glyph and a sign, not with colour alone", () => {
    render(<MoversView data={sample} title="Movers" />);

    // Past the threshold the glyph is the badge's filled triangle; under it,
    // a light arrow. Either way direction is a shape and a sign, not a colour.
    const t2 = screen.getByRole("row", { name: /T2/ });
    expect(t2.textContent).toContain("▼");
    expect(t2.textContent).toContain("−98%");

    const t3 = screen.getByRole("row", { name: /T3/ });
    expect(t3.textContent).toContain("↑");
  });

  it("reads out the previous total for a row that only draws it as a mark", () => {
    // The hollow mark is aria-hidden, so without this the previous window is
    // invisible to a screen reader - and it is half the chart.
    render(<MoversView data={sample} title="Movers" />);

    const t1 = screen.getByRole("row", { name: /T1/ });
    expect(t1.textContent).toContain("from 200");
  });

  it("names the buckets each window covers", () => {
    render(<MoversView data={sample} title="Movers" />);

    // Two windows of unstated length are two numbers nobody can act on.
    expect(screen.getByText("09–10")).toBeInTheDocument();
    expect(screen.getByText("11–12")).toBeInTheDocument();
  });

  it("leads with both totals and how many categories went each way", () => {
    render(<MoversView data={sample} title="Movers" />);

    expect(screen.getByText("930")).toBeInTheDocument();
    // formatAxisValue compacts past a thousand.
    expect(screen.getByText("1.3K")).toBeInTheDocument();
    expect(screen.getByText("2 up · 1 down")).toBeInTheDocument();
  });

  it("says a category is new rather than inventing a percentage from zero", () => {
    const data = build([
      ["09", "New", 0],
      ["10", "New", 0],
      ["11", "New", 40],
      ["12", "New", 40],
    ]);
    render(<MoversView data={data} title="Movers" />);

    // A ratio against zero has no value, so the badge names the situation.
    expect(screen.getByText("from nothing")).toBeInTheDocument();
  });

  it("says a category that stopped has no activity", () => {
    const data = build([
      ["09", "Gone", 0],
      ["10", "Gone", 0],
      ["11", "Gone", 0],
      ["12", "Gone", 0],
    ]);
    render(<MoversView data={data} title="Movers" />);

    expect(screen.getByText("no change")).toBeInTheDocument();
  });

  it("marks a flagged category in text as well as with a dot", () => {
    const data = build(
      [
        ["09", "T1", 10],
        ["10", "T1", 10],
        ["11", "T1", 900],
        ["12", "T1", 900],
      ],
      {
        flagged_count: 1,
        rows: [{ index: 2, rule_ids: ["r1"] }],
        rules: [{ id: "r1", name: "Spike", severity: "high", matched: 1 }],
        warnings: [],
        dismissed_count: 0,
      } as never,
    );
    render(<MoversView data={data} title="Movers" />);

    // The dot is aria-hidden, so the word is what carries the flag to a reader.
    expect(screen.getByRole("rowheader").textContent).toContain("(flagged)");
  });

  it("emits the exact selector the browser smoke lane counts", () => {
    // scripts/smoke.mjs proves this chart drew by counting `th[scope=row]`;
    // that lane needs a real browser, so the selector is pinned here too.
    const { container } = render(<MoversView data={sample} title="Movers" />);

    expect(container.querySelectorAll("th[scope=row]")).toHaveLength(3);
  });

  it("explains why it drew nothing when there is only one bucket", () => {
    const data = build([
      ["09", "T1", 5],
      ["09", "T2", 6],
    ]);
    render(<MoversView data={data} title="Movers" />);

    expect(screen.getByText(/at least two time buckets/)).toBeInTheDocument();
  });
});
