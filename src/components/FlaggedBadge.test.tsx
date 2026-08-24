import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlaggedBadge } from "./FlaggedBadge";

/**
 * "There is something to review here." The badge exists to be scanned past,
 * so most of these are about what it refuses to draw.
 */

describe("FlaggedBadge", () => {
  it("renders nothing at zero", () => {
    // A badge reading 0 is chrome that has to be read before it can be
    // dismissed, on every connection that is fine.
    const { container } = render(<FlaggedBadge count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a negative count", () => {
    const { container } = render(<FlaggedBadge count={-1} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the count", () => {
    render(<FlaggedBadge count={12} severity="high" />);
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("groups thousands, because 1247 findings should not read as 1247", () => {
    render(<FlaggedBadge count={1247} />);
    expect(screen.getByText("1,247")).toBeInTheDocument();
  });

  it("says what the number means to a screen reader", () => {
    // The digit alone is meaningless out of visual context.
    render(<FlaggedBadge count={3} severity="medium" />);
    expect(screen.getByTitle(/3 flagged, highest severity medium/i)).toBeInTheDocument();
  });

  it("carries severity by weight, not by hue alone", () => {
    // The ranking has to survive a reader who cannot separate the colours.
    const { container: high } = render(<FlaggedBadge count={1} severity="high" />);
    const { container: low } = render(<FlaggedBadge count={1} severity="low" />);
    expect(high.firstElementChild?.className).toMatch(/font-semibold/);
    expect(low.firstElementChild?.className).not.toMatch(/font-semibold/);
  });

  it("copes with no severity at all", () => {
    render(<FlaggedBadge count={2} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
