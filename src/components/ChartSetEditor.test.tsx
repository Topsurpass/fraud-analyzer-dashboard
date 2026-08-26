import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QueryChartInput } from "@/contracts/api";
import { ChartSetEditor, hasThreshold } from "./ChartSetEditor";

const chart = (over: Partial<QueryChartInput> = {}): QueryChartInput => ({
  name: "Per terminal",
  chart_type: "compare_grid",
  x_field: "bucket",
  y_field: "amount",
  series_field: "terminal",
  ...over,
});

function editor(charts: QueryChartInput[]) {
  const onChange = vi.fn();
  render(
    <ChartSetEditor
      charts={charts}
      onChange={onChange}
      columns={["bucket", "terminal", "amount"]}
    />,
  );
  return onChange;
}

describe("hasThreshold", () => {
  it("covers the charts that hold a before to compare a now against", () => {
    for (const type of ["compare", "movers", "compare_grid"] as const) {
      expect(hasThreshold(type)).toBe(true);
    }
  });

  it("leaves out the charts with no time dimension at all", () => {
    // Offering a threshold on a pie would be a control that silently does
    // nothing, which is worse than not offering it.
    for (const type of ["pie", "table", "number", "line", "bar", "heatmap"] as const) {
      expect(hasThreshold(type)).toBe(false);
    }
  });
});

describe("ChartSetEditor: the surge threshold", () => {
  it("offers the threshold on a period chart", () => {
    editor([chart()]);

    expect(screen.getByLabelText("Flag a change past (%)")).toBeInTheDocument();
  });

  it("does not offer it on a chart that could not use it", () => {
    editor([chart({ chart_type: "table", x_field: "", y_field: "", series_field: "" })]);

    expect(screen.queryByLabelText("Flag a change past (%)")).not.toBeInTheDocument();
  });

  it("shows the app default as a placeholder rather than a value", () => {
    // A pre-filled 50 would look like a saved choice, and the chart would then
    // stop following the default if it ever moved.
    editor([chart({ surge_threshold_pct: null })]);

    const input = screen.getByLabelText("Flag a change past (%)");
    expect(input).toHaveValue(null);
    expect(input).toHaveAttribute("placeholder", "50");
  });

  it("passes a typed threshold up as a number", () => {
    const onChange = editor([chart()]);

    fireEvent.change(screen.getByLabelText("Flag a change past (%)"), {
      target: { value: "120" },
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ surge_threshold_pct: 120 }),
    ]);
  });

  it("reads an emptied field as following the default, not as zero", () => {
    // Zero would flag every movement including none at all, so an empty field
    // must never arrive as one.
    const onChange = editor([chart({ surge_threshold_pct: 120 })]);

    fireEvent.change(screen.getByLabelText("Flag a change past (%)"), {
      target: { value: "" },
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ surge_threshold_pct: null }),
    ]);
  });

  it("explains that the number is a magnitude covering both directions", () => {
    editor([chart({ surge_threshold_pct: 120 })]);

    expect(screen.getByText(/120 flags a rise and a fall of that size/)).toBeInTheDocument();
  });

  it("clears a stale threshold when the type can no longer use one", () => {
    // Otherwise it is invisible configuration that reappears the moment the
    // type is switched back.
    const onChange = editor([chart({ surge_threshold_pct: 120 })]);

    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "table" } });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ chart_type: "table", surge_threshold_pct: null }),
    ]);
  });
});
