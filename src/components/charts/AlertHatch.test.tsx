import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAlertHatch } from "./AlertHatch";
import { SERIES_COLORS } from "./theme";

/**
 * The rule these tests exist to hold: a flagged mark keeps the colour that says
 * which category it is.
 *
 * The chart used to repaint an anomalous wedge in `--signal-alert`. With three
 * of five countries flagged that left three identically red wedges and a legend
 * with three identical swatches, so the alert colour destroyed the one reading
 * a composition chart is for. Anything that reintroduces a recolour should fail
 * here rather than in a screenshot nobody looks at.
 */

function Probe({ colors, flagged }: { colors: string[]; flagged: boolean[] }) {
  const hatch = useAlertHatch(colors);
  return (
    <svg data-testid="probe">
      {hatch.defs}
      {colors.map((color, index) => (
        <rect key={index} data-testid={`mark-${index}`} fill={hatch.fill(color, flagged[index])} />
      ))}
    </svg>
  );
}

const ALERT = "#e5484d";

describe("useAlertHatch", () => {
  it("leaves an unflagged mark on its own colour", () => {
    const { getByTestId } = render(<Probe colors={[SERIES_COLORS[0]]} flagged={[false]} />);
    expect(getByTestId("mark-0")).toHaveAttribute("fill", SERIES_COLORS[0]);
  });

  it("gives a flagged mark a pattern rather than the alert colour", () => {
    const { getByTestId } = render(<Probe colors={[SERIES_COLORS[0]]} flagged={[true]} />);
    const fill = getByTestId("mark-0").getAttribute("fill") ?? "";
    expect(fill).toMatch(/^url\(#hatch-/);
    // The point: the flagged mark is never painted alert-on-alert.
    expect(fill).not.toContain(ALERT);
  });

  it("keeps two flagged marks of different categories distinguishable", () => {
    const colors = [SERIES_COLORS[0], SERIES_COLORS[1], SERIES_COLORS[2]];
    const { getByTestId } = render(<Probe colors={colors} flagged={[true, true, true]} />);

    const fills = [0, 1, 2].map((index) => getByTestId(`mark-${index}`).getAttribute("fill"));
    expect(new Set(fills).size).toBe(3);
  });

  it("paints each pattern with its own category colour underneath", () => {
    const colors = [SERIES_COLORS[0], SERIES_COLORS[1]];
    const { getByTestId } = render(<Probe colors={colors} flagged={[true, true]} />);

    const patterns = Array.from(getByTestId("probe").querySelectorAll("pattern"));
    expect(patterns).toHaveLength(2);

    // Each pattern's ground is the series colour; only the stripe is the alert.
    const grounds = patterns.map((pattern) => pattern.querySelector("rect")?.getAttribute("fill"));
    expect(grounds).toEqual(colors);
  });

  it("does not emit a pattern for a colour nothing flagged", () => {
    // The defs are built from the colours in play, but an unflagged mark must
    // still resolve to a plain fill rather than a pattern reference.
    const { getByTestId } = render(
      <Probe colors={[SERIES_COLORS[0], SERIES_COLORS[1]]} flagged={[true, false]} />,
    );
    expect(getByTestId("mark-1")).toHaveAttribute("fill", SERIES_COLORS[1]);
  });

  it("scopes ids so two charts on one page cannot share a pattern", () => {
    const { getAllByTestId } = render(
      <>
        <Probe colors={[SERIES_COLORS[0]]} flagged={[true]} />
        <Probe colors={[SERIES_COLORS[0]]} flagged={[true]} />
      </>,
    );
    const [first, second] = getAllByTestId("mark-0").map((node) => node.getAttribute("fill"));
    expect(first).not.toBe(second);
  });
});
