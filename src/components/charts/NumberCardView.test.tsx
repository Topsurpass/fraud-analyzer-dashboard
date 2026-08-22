import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NumberData } from "@/services/charts/shape";
import { NumberCardView } from "./NumberCardView";

let frameCallbacks: FrameRequestCallback[] = [];
let now = 0;

function runFrames(count: number, stepMs = 60) {
  for (let index = 0; index < count; index += 1) {
    const pending = frameCallbacks;
    frameCallbacks = [];
    now += stepMs;
    act(() => {
      for (const callback of pending) callback(now);
    });
  }
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

const data = (overrides: Partial<NumberData> = {}): NumberData => ({
  value: 20,
  raw: 20,
  label: "flagged_last_hour",
  warnings: [],
  extraRows: 0,
  ...overrides,
});

beforeEach(() => {
  frameCallbacks = [];
  now = 0;
  setReducedMotion(false);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("performance", { now: () => now });
});

afterEach(() => vi.unstubAllGlobals());

describe("NumberCardView", () => {
  it("shows the first value immediately, with no count-up from zero", () => {
    render(<NumberCardView data={data({ value: 20 })} title="Flagged" />);
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(frameCallbacks).toHaveLength(0);
  });

  it("counts from the old value to the new one", () => {
    const { rerender } = render(<NumberCardView data={data({ value: 20 })} title="Flagged" />);
    rerender(<NumberCardView data={data({ value: 120, raw: 120 })} title="Flagged" />);

    // Part-way through the tween the figure is between the two values.
    runFrames(1, 100);
    const midway = Number(screen.getByText(/^\d+(\.\d+)?$/).textContent);
    expect(midway).toBeGreaterThan(20);
    expect(midway).toBeLessThan(120);

    // And it lands exactly on the target.
    runFrames(6, 200);
    expect(screen.getByText("120")).toBeInTheDocument();
  });

  it("announces only the settled value, never every animation frame", () => {
    render(<NumberCardView data={data({ value: 4200 })} title="Flagged" />);
    const live = document.querySelector("[aria-live='polite']");
    expect(live).toHaveTextContent("Flagged: 4.2K");
    // The animated digits themselves are hidden from the accessibility tree.
    expect(screen.getByText("4.2K")).toHaveAttribute("aria-hidden", "true");
  });

  it("says when the query returned rows a number card cannot show", () => {
    render(<NumberCardView data={data({ extraRows: 3 })} title="Flagged" />);
    expect(screen.getByText("+3 rows hidden")).toBeInTheDocument();
  });

  it("falls back to the raw cell when the result is not numeric", () => {
    render(
      <NumberCardView data={data({ value: null, raw: "degraded" })} title="Status" />,
    );
    expect(screen.getByText("degraded")).toBeInTheDocument();
  });

  it("renders the missing-data glyph when there is no value at all", () => {
    render(<NumberCardView data={data({ value: null, raw: null })} title="Status" />);
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  describe("with reduced motion", () => {
    beforeEach(() => setReducedMotion(true));

    it("snaps to the new value without animating", () => {
      const { rerender } = render(<NumberCardView data={data({ value: 20 })} title="Flagged" />);
      rerender(<NumberCardView data={data({ value: 120, raw: 120 })} title="Flagged" />);

      expect(screen.getByText("120")).toBeInTheDocument();
      expect(frameCallbacks).toHaveLength(0);
    });
  });
});
