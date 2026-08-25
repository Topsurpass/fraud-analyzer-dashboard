import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChartSpec } from "@/contracts/api";
import { buildCartesian, buildPie } from "@/services/charts/shape";
import { CartesianChartView } from "./CartesianChartView";
import { PieChartView } from "./PieChartView";
import { ChartEmpty } from "./ChartEmpty";

const spec = (overrides: Partial<ChartSpec> = {}): ChartSpec => ({
  id: "c",
  name: "Chart",
  type: "line",
  x_field: "bucket",
  y_field: "n",
  series_field: null,
  warnings: [],
  ...overrides,
});

describe("ChartEmpty", () => {
  it("distinguishes 'matched nothing' from 'broken'", () => {
    render(<ChartEmpty />);
    expect(screen.getByText("No rows in range")).toBeInTheDocument();
    expect(screen.getByText("The query ran and matched nothing.")).toBeInTheDocument();
  });
});

describe("empty result sets", () => {
  it("a line chart with no rows says so instead of drawing bare axes", () => {
    render(
      <CartesianChartView
        data={buildCartesian({ columns: ["bucket", "n"], rows: [], chart: spec() })}
        kind="line"
        title="Authorisations by channel"
      />,
    );
    expect(screen.getByText("No rows in range")).toBeInTheDocument();
  });

  it("a bar chart with no rows says so too", () => {
    render(
      <CartesianChartView
        data={buildCartesian({
          columns: ["country", "declines"],
          rows: [],
          chart: spec({ type: "bar", x_field: "country", y_field: "declines" }),
        })}
        kind="bar"
        title="Declines"
      />,
    );
    expect(screen.getByText("No rows in range")).toBeInTheDocument();
  });

  it("a pie with no slices does not render an empty ring", () => {
    render(
      <PieChartView
        data={buildPie({
          columns: ["reason", "count"],
          rows: [],
          chart: spec({ type: "pie", x_field: "reason", y_field: "count" }),
        })}
        title="Decline reasons"
      />,
    );
    expect(screen.getByText("No rows in range")).toBeInTheDocument();
    expect(screen.queryByText("total")).not.toBeInTheDocument();
  });

  it("a pie whose values are all zero is empty, not a zero-radius donut", () => {
    render(
      <PieChartView
        data={buildPie({
          columns: ["reason", "count"],
          rows: [["a", 0], ["b", 0]],
          chart: spec({ type: "pie", x_field: "reason", y_field: "count" }),
        })}
        title="Decline reasons"
      />,
    );
    expect(screen.getByText("No rows in range")).toBeInTheDocument();
  });
});

describe("very short series", () => {
  it("draws visible points when a series is too short to form a line", () => {
    // One bucket per channel is a real shape: a five-minute-bucket query
    // renders exactly this in its first minutes. Without dots the card would
    // show an empty plot over real data.
    const { container } = render(
      <CartesianChartView
        data={buildCartesian({
          columns: ["bucket", "channel", "approvals"],
          rows: [
            ["22:43", "api", 2],
            ["22:43", "web", 1],
          ],
          chart: spec({ x_field: "bucket", y_field: "approvals", series_field: "channel" }),
        })}
        kind="line"
        title="Authorisations by channel"
      />,
    );
    expect(screen.queryByText("No rows in range")).not.toBeInTheDocument();
    // jsdom gives Recharts no layout, so assert on the series rather than the
    // rendered geometry; scripts/smoke.mjs covers the drawn output.
    expect(container.querySelector("[aria-label*='2 series']")).not.toBeNull();
  });
});
