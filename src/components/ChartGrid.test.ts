import { describe, expect, it } from "vitest";
import { CHART_TYPES } from "@/contracts/api";
import { chartCellClass, chartRowSpan } from "./ChartGrid";

describe("chartRowSpan", () => {
  it("gives a number readout less height than a plot, but not half", () => {
    expect(chartRowSpan("number")).toBe(2);
    for (const type of ["line", "bar", "pie", "table"] as const) {
      expect(chartRowSpan(type)).toBe(3);
    }
  });
});

describe("chartCellClass", () => {
  it("uses the dense default footprint when not expanded", () => {
    expect(chartCellClass("number")).toBe("card-cell-number");
    expect(chartCellClass("line")).toBe("card-cell");
    expect(chartCellClass("table")).toBe("card-cell");
  });

  it("uses the same larger footprint for every type when expanded", () => {
    for (const type of CHART_TYPES) {
      expect(chartCellClass(type, true)).toBe("card-cell-expanded");
    }
  });

  it("returns a fixed class name, never one assembled at runtime", () => {
    // A dynamic `row-span-${n}` would not survive Tailwind's source scanning
    // and would silently collapse every card to a single row.
    for (const type of CHART_TYPES) {
      for (const expanded of [true, false]) {
        expect(chartCellClass(type, expanded)).toMatch(/^card-cell(-number|-expanded)?$/);
      }
    }
  });
});
