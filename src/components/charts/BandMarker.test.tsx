import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BandMarker } from "./CartesianChartView";

/**
 * Recharts hands a label its position before the axis is measured, and when an
 * x value cannot be placed, as NaN. Drawing a circle from that logs an SVG
 * attribute error per mark, so the marker must draw nothing instead.
 */
const draw = (viewBox?: { x: number; y: number; width: number }) =>
  render(
    <svg>
      <BandMarker viewBox={viewBox} />
    </svg>,
  ).container.querySelector("svg")!;

describe("BandMarker", () => {
  it("draws nothing without a position", () => {
    expect(draw(undefined).querySelector("circle")).toBeNull();
  });

  it.each([
    ["x", { x: Number.NaN, y: 10, width: 20 }],
    ["y", { x: 10, y: Number.NaN, width: 20 }],
    ["width", { x: 10, y: 10, width: Number.NaN }],
    ["an infinite width", { x: 10, y: 10, width: Number.POSITIVE_INFINITY }],
  ])("draws nothing when %s is not a number", (_name, box) => {
    expect(draw(box).querySelector("circle")).toBeNull();
  });

  it("draws a disc with every attribute finite for a real position", () => {
    const circle = draw({ x: 10, y: 10, width: 20 }).querySelector("circle")!;
    for (const attr of ["cx", "cy", "r"]) {
      expect(Number.isFinite(Number(circle.getAttribute(attr)))).toBe(true);
    }
  });

  it("keeps neighbouring markers from overlapping by shrinking to the column", () => {
    const narrow = draw({ x: 0, y: 0, width: 6 }).querySelector("circle")!;
    const wide = draw({ x: 0, y: 0, width: 40 }).querySelector("circle")!;
    expect(Number(narrow.getAttribute("r"))).toBeLessThan(Number(wide.getAttribute("r")));
    // A marker this small is a plain disc: the "!" would be unreadable.
    expect(draw({ x: 0, y: 0, width: 6 }).querySelector("text")).toBeNull();
    expect(draw({ x: 0, y: 0, width: 40 }).querySelector("text")).not.toBeNull();
  });
});
