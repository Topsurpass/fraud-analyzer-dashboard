import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusDot } from "./StatusDot";

describe("StatusDot", () => {
  it("names each state for assistive technology", () => {
    const { rerender } = render(<StatusDot status="ok" />);
    expect(screen.getByRole("img", { name: "Connected" })).toBeInTheDocument();

    rerender(<StatusDot status="untested" />);
    expect(screen.getByRole("img", { name: "Not yet tested" })).toBeInTheDocument();

    rerender(<StatusDot status="failed" />);
    expect(screen.getByRole("img", { name: "Connection failed" })).toBeInTheDocument();
  });

  it("fills the dot only when the connection actually answered", () => {
    const { container, rerender } = render(<StatusDot status="ok" />);
    expect(container.querySelector("circle")).toHaveAttribute("fill", "var(--signal-live)");

    rerender(<StatusDot status="untested" />);
    expect(container.querySelector("circle")).toHaveAttribute("fill", "none");
  });

  it("separates failed from untested by shape, not colour", () => {
    const { container, rerender } = render(<StatusDot status="untested" />);
    expect(container.querySelector("line")).toBeNull();

    rerender(<StatusDot status="failed" />);
    // The strike-through is what a colour-blind analyst reads.
    expect(container.querySelector("line")).not.toBeNull();
  });

  it("never uses the alert colour, which is reserved for chart data", () => {
    const { container } = render(<StatusDot status="failed" />);
    expect(container.innerHTML).not.toContain("signal-alert");
  });
});
