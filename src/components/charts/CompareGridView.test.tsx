import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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

    // Past the threshold the glyph is the filled triangle the badge uses; an
    // ordinary movement keeps the light arrow. Either way direction is a
    // shape and a sign before it is a colour.
    const t2 = screen.getAllByRole("listitem")[0];
    expect(t2.textContent).toContain("▼");
    expect(t2.textContent).toContain("−98%");

    const t3 = screen.getAllByRole("listitem")[2];
    expect(t3.textContent).toContain("↑");
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

    expect(screen.queryByRole("button", { name: /quieter/ })).not.toBeInTheDocument();
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

    /*
     * Two marks on the one bucket, and they are deliberately different: a
     * filled dot for "a flag rule matched this row" and a hollow ring for
     * "this crossed the change threshold". They are separate findings and a
     * bucket can carry either, both, or neither - collapsing them into one
     * mark would make those four states two.
     */
    const filled = [...container.querySelectorAll("circle")].filter(
      (mark) => mark.getAttribute("fill") !== "none",
    );
    const hollow = [...container.querySelectorAll("circle")].filter(
      (mark) => mark.getAttribute("fill") === "none",
    );
    expect(filled).toHaveLength(1);
    expect(hollow).toHaveLength(1);
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

describe("CompareGridView: the surge indicator", () => {
  /** T1 doubles (past a 50% threshold), T2 holds steady. */
  const thresholdSpec = { ...spec, surge_threshold_pct: 50 };
  const judged = buildCompareGrid({
    columns: ["bucket", "terminal", "amount"],
    rows: [
      ["09", "T1", 100],
      ["09", "T2", 100],
      ["10", "T1", 300],
      ["10", "T2", 105],
    ],
    chart: thresholdSpec,
  });

  it("badges only the panel that crossed the threshold", () => {
    render(<CompareGridView data={judged} title="Per terminal" />);

    // A chart where every row wears a badge has told the reader nothing.
    expect(screen.getByTitle("Past the 50% threshold")).toBeInTheDocument();
    expect(screen.getAllByTitle("Past the 50% threshold")).toHaveLength(1);
  });

  it("spells the crossing out for a screen reader, threshold included", () => {
    render(<CompareGridView data={judged} title="Per terminal" />);

    expect(screen.getByText("T1: surge of +200%, past the 50% threshold")).toBeInTheDocument();
  });

  it("summarises how many categories crossed", () => {
    render(<CompareGridView data={judged} title="Per terminal" />);

    expect(screen.getByText("1 past 50%")).toBeInTheDocument();
  });

  it("says nothing about a threshold nothing crossed", () => {
    const quiet = buildCompareGrid({
      columns: ["bucket", "terminal", "amount"],
      rows: [
        ["09", "T1", 100],
        ["10", "T1", 105],
      ],
      chart: thresholdSpec,
    });
    render(<CompareGridView data={quiet} title="Per terminal" />);

    expect(screen.queryByText(/past 50%/)).not.toBeInTheDocument();
  });
});

describe("CompareGridView: maximising a panel", () => {
  it("opens one panel over the whole card when its name is clicked", () => {
    render(<CompareGridView data={sample} title="Per terminal" />);

    fireEvent.click(screen.getByRole("button", { name: "Maximise T1" }));

    // The grid is replaced, not overlaid: one panel, and a way back.
    expect(screen.queryByRole("button", { name: "Maximise T1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← All terminals" })).toBeInTheDocument();
  });

  it("labels the buckets, which the small panel has no room for", () => {
    render(<CompareGridView data={sample} title="Per terminal" />);
    fireEvent.click(screen.getByRole("button", { name: "Maximise T1" }));

    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("names the hours that crossed the threshold, not just marking them", () => {
    /*
     * The reason to open a panel at all. This terminal's two windows total the
     * same, so the panel badge stays quiet - but one hour inside the current
     * window went from 5 to 205, and the maximised view says which.
     */
    const data = buildCompareGrid({
      columns: ["bucket", "terminal", "amount"],
      rows: [
        ["09", "T1", 105],
        ["10", "T1", 105],
        ["11", "T1", 5],
        ["12", "T1", 205],
      ],
      chart: { ...spec, surge_threshold_pct: 50 },
    });
    render(<CompareGridView data={data} title="Per terminal" />);
    fireEvent.click(screen.getByRole("button", { name: "Maximise T1" }));

    expect(screen.getByText(/Crossed 50% at 12 \(\+4000%\)/)).toBeInTheDocument();
  });

  it("says plainly when no hour crossed, rather than showing nothing", () => {
    render(<CompareGridView data={sample} title="Per terminal" />);
    fireEvent.click(screen.getByRole("button", { name: "Maximise T3" }));

    expect(screen.getByText(/No hour crossed the/)).toBeInTheDocument();
  });

  it("goes back to the grid", () => {
    render(<CompareGridView data={sample} title="Per terminal" />);
    fireEvent.click(screen.getByRole("button", { name: "Maximise T1" }));
    fireEvent.click(screen.getByRole("button", { name: "← All terminals" }));

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("CompareGridView: choosing terminals", () => {
  beforeEach(() => window.localStorage.clear());

  it("narrows the grid to the chosen categories", () => {
    render(<CompareGridView data={sample} title="Per terminal" chartId="c1" />);

    fireEvent.click(screen.getByRole("button", { name: "Choose terminals" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /T1/ }));

    expect(screen.getAllByRole("listitem").filter((item) => item.querySelector("svg"))).toHaveLength(
      1,
    );
  });

  it("reports how many are chosen out of how many exist", () => {
    render(<CompareGridView data={sample} title="Per terminal" chartId="c1" />);

    fireEvent.click(screen.getByRole("button", { name: "Choose terminals" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /T1/ }));

    expect(screen.getByText("Showing 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 chosen" })).toBeInTheDocument();
  });

  it("remembers the choice per chart, so it survives a reload", () => {
    // Re-picking four terminals out of thirty-one after every reload is the
    // friction that makes a feature go unused.
    const first = render(<CompareGridView data={sample} title="Per terminal" chartId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose terminals" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /T2/ }));
    first.unmount();

    render(<CompareGridView data={sample} title="Per terminal" chartId="c1" />);
    expect(screen.getByRole("button", { name: "1 chosen" })).toBeInTheDocument();
  });

  it("keeps two charts of the same query apart", () => {
    // The point of several charts on one result is that they are looked at
    // differently, so one chart's focus must not move another's.
    const first = render(<CompareGridView data={sample} title="Per terminal" chartId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose terminals" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /T2/ }));
    first.unmount();

    render(<CompareGridView data={sample} title="Per terminal" chartId="c2" />);
    expect(screen.getByRole("button", { name: "Choose terminals" })).toBeInTheDocument();
  });

  it("clears back to every category", () => {
    render(<CompareGridView data={sample} title="Per terminal" chartId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose terminals" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /T1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));

    expect(screen.getByRole("button", { name: "Choose terminals" })).toBeInTheDocument();
  });

  it("says so when the chosen terminals are absent from this result", () => {
    // A saved selection outlives the data it was made against, and an empty
    // card with no explanation reads as a broken chart.
    window.localStorage.setItem("fae.chart-focus.c1", JSON.stringify(["GONE"]));
    render(<CompareGridView data={sample} title="Per terminal" chartId="c1" />);

    expect(screen.getByText(/No chosen terminal appears/)).toBeInTheDocument();
  });
});

describe("CompareGridView: hour-level surges", () => {
  /** Flat six-hour totals hiding a 40x jump in one hour. */
  const hidden = buildCompareGrid({
    columns: ["bucket", "terminal", "amount"],
    rows: [
      ["09", "T1", 105],
      ["10", "T1", 105],
      ["11", "T1", 5],
      ["12", "T1", 205],
    ],
    chart: { ...spec, surge_threshold_pct: 50 },
  });

  it("shows an hour count on a panel whose window badge stays quiet", () => {
    render(<CompareGridView data={hidden} title="Per terminal" />);

    // Without this the panel reads "flat" and the reader never opens it.
    expect(
      screen.getByTitle("1 hour crossed the threshold against the hour before"),
    ).toBeInTheDocument();
  });

  it("counts such a panel in the card's summary", () => {
    render(<CompareGridView data={hidden} title="Per terminal" />);

    expect(screen.getByText("1 past 50%")).toBeInTheDocument();
  });

  it("rings the hour on the line, hollow so it is not the flag mark", () => {
    const { container } = render(<CompareGridView data={hidden} title="Per terminal" />);

    const hollow = [...container.querySelectorAll("circle")].filter(
      (mark) => mark.getAttribute("fill") === "none",
    );
    expect(hollow).toHaveLength(1);
  });

  it("puts no hour count on a panel where every step was ordinary", () => {
    const calm = buildCompareGrid({
      columns: ["bucket", "terminal", "amount"],
      rows: [
        ["09", "T1", 100],
        ["10", "T1", 100],
        ["11", "T1", 105],
        ["12", "T1", 108],
      ],
      chart: { ...spec, surge_threshold_pct: 50 },
    });
    render(<CompareGridView data={calm} title="Per terminal" />);

    expect(screen.queryByTitle(/crossed the threshold against the hour before/)).not.toBeInTheDocument();
  });
});
