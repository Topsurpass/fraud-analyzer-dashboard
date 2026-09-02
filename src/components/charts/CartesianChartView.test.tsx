import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChartSpec, Row } from "@/contracts/api";
import { buildCartesian } from "@/services/charts/shape";
import { MAX_PLOT_POINTS, MAX_PLOT_SERIES } from "@/services/charts/downsample";
import { CartesianChartView } from "./CartesianChartView";

/**
 * Recharts measures its container before it draws anything, and jsdom reports
 * every box as zero, so the plot itself is not reachable from here. What is
 * reachable is everything the card says *about* the plot - the legend, the
 * accessible description, the empty state - and that is where the bounds this
 * view now enforces become visible to a reader.
 */

const spec = (overrides: Partial<ChartSpec> = {}): ChartSpec => ({
  id: "c",
  name: "Volume",
  type: "line",
  x_field: "bucket",
  y_field: "amount",
  series_field: null,
  warnings: [],
  ...overrides,
});

function seriesRows(count: number, buckets = 3): Row[] {
  const rows: Row[] = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    for (let series = 0; series < count; series += 1) {
      rows.push([`b${bucket}`, `TERM-${series}`, series + 1]);
    }
  }
  return rows;
}

describe("CartesianChartView", () => {
  it("says what happened instead of drawing empty axes", () => {
    const data = buildCartesian({ columns: ["bucket", "amount"], rows: [], chart: spec() });
    render(<CartesianChartView data={data} kind="line" title="Volume" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("describes the plot by the points it actually draws", () => {
    // 25,000 rows, one line: the description has to name the drawn series, not
    // the row count, or it promises resolution the chart does not have.
    const rows: Row[] = Array.from({ length: 25_000 }, (_, index) => [`t${index}`, 100]);
    const data = buildCartesian({ columns: ["bucket", "amount"], rows, chart: spec() });

    render(<CartesianChartView data={data} kind="line" title="Volume" />);

    const plot = screen.getByRole("img");
    expect(plot).toHaveAccessibleName(
      `Volume: line chart, ${data.data.length} points across 1 series`,
    );
    expect(data.data.length).toBeLessThanOrEqual(MAX_PLOT_POINTS);
  });

  it("shows the folded tail in the legend rather than a wall of identical greens", () => {
    /*
     * Forty terminals is thirty-six lines drawn in the fifth palette colour and
     * forty marks at every x position. The fold happens in shaping; this is the
     * proof it reaches the reader as a named bucket rather than a silent drop.
     */
    const data = buildCartesian({
      columns: ["bucket", "terminal", "amount"],
      rows: seriesRows(40),
      chart: spec({ series_field: "terminal" }),
    });

    render(<CartesianChartView data={data} kind="bar" title="Volume" />);

    const entries = screen.getAllByRole("button");
    expect(entries).toHaveLength(MAX_PLOT_SERIES);
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("marks the folded bucket as flagged when a folded series was", () => {
    const data = buildCartesian({
      columns: ["bucket", "terminal", "amount"],
      rows: seriesRows(40),
      chart: spec({ series_field: "terminal" }),
      // Row 0 is TERM-0, the quietest series, so it lands in the fold.
      flags: {
        flagged_count: 1,
        rows: [{ index: 0, rule_ids: ["r1"] }],
        rules: [{ id: "r1", name: "Large transfer", severity: "high", matched: 1 }],
        warnings: [],
        dismissed_count: 0,
      },
    });

    render(<CartesianChartView data={data} kind="bar" title="Volume" />);

    // Colour is never the only encoding: the legend entry says so in words.
    expect(screen.getByText("anomalous")).toBeInTheDocument();
  });
});
