import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildCompare } from "@/services/charts/shape";
import type { ChartSpec } from "@/contracts/api";
import { CompareChartView } from "./CompareChartView";

const spec: ChartSpec = {
  id: "c",
  name: "Volume",
  type: "compare",
  x_field: "bucket",
  y_field: "amount",
  series_field: null,
  warnings: [],
};

/** Buckets oldest first, the way a query orders them. */
function build(values: (number | null)[]) {
  return buildCompare({
    columns: ["bucket", "amount"],
    rows: values.map((value, index) => [`t${index}`, value]),
    chart: spec,
  });
}

describe("CompareChartView", () => {
  it("leads with the two totals and the change between them", () => {
    // Previous window 30, current window 70: the answer before the picture.
    render(<CompareChartView data={build([10, 20, 30, 40])} title="Volume" />);

    expect(screen.getByText("70")).toBeInTheDocument();
    expect(screen.getByText(/30/)).toBeInTheDocument();
    expect(screen.getByText("up 133%")).toBeInTheDocument();
  });

  it("says a fall is a fall, not an unsigned change", () => {
    render(<CompareChartView data={build([40, 60, 10, 15])} title="Volume" />);

    expect(screen.getByText("down 75%")).toBeInTheDocument();
  });

  it("calls a rise from zero what it is instead of inventing a percentage", () => {
    // 0 -> 40 is not "up 100%". A ratio against zero has no meaning and
    // printing one would be a number an analyst could act on wrongly.
    render(<CompareChartView data={build([0, 0, 20, 20])} title="Volume" />);

    expect(screen.getByText("up from zero")).toBeInTheDocument();
  });

  it("reads a rounding-error difference as flat rather than up 0%", () => {
    render(<CompareChartView data={build([1000, 1000, 1000, 1000.1])} title="Volume" />);

    expect(screen.getByText("flat")).toBeInTheDocument();
  });

  it("names the bucket carrying the widest gap, with its sign", () => {
    // t3 is +40 against its counterpart, which is the story in this data.
    render(<CompareChartView data={build([10, 20, 12, 60])} title="Volume" />);

    expect(screen.getByText(/widest gap at/)).toBeInTheDocument();
    expect(screen.getByText("t3")).toBeInTheDocument();
    expect(screen.getByText("+40")).toBeInTheDocument();
  });

  it("describes the comparison in the accessible name of the plot", () => {
    render(<CompareChartView data={build([10, 20, 30, 40])} title="Volume" />);

    expect(
      screen.getByRole("img", { name: /Volume: current window up 133% against the previous/ }),
    ).toBeInTheDocument();
  });

  it("explains why it drew nothing when there is too little history", () => {
    // Three rows cannot make two equal windows, and an empty plot with no
    // reason is indistinguishable from a broken card.
    render(<CompareChartView data={build([10, 20, 30])} title="Volume" />);

    expect(screen.getByText(/at least four rows/)).toBeInTheDocument();
  });

  it("keeps the previous bucket's own label available for the tooltip", () => {
    // Both windows share one axis, so a point labelled t2 carries a value
    // measured at t0. The data has to remember that even though the plot cannot
    // show it until hovered.
    const data = build([10, 20, 30, 40]);

    expect(data.points[0].previousBucket).toBe("t0");
    expect(data.points[0].bucket).toBe("t2");
  });

  it("offers both windows in the legend so either can be isolated", () => {
    render(<CompareChartView data={build([10, 20, 30, 40])} title="Volume" />);

    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Previous")).toBeInTheDocument();
  });
});
