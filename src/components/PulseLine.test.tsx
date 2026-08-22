import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PulseLine } from "./PulseLine";

/**
 * The pulse line animates from a shared requestAnimationFrame ticker, so these
 * tests drive rAF by hand rather than waiting on wall-clock time.
 */
let frameCallbacks: FrameRequestCallback[] = [];
let now = 0;

function runFrames(count: number) {
  for (let index = 0; index < count; index += 1) {
    const pending = frameCallbacks;
    frameCallbacks = [];
    now += 40; // slower than the ticker's 33ms floor, so every frame emits
    act(() => {
      for (const callback of pending) callback(now);
    });
  }
}

beforeEach(() => {
  frameCallbacks = [];
  now = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe("PulseLine", () => {
  beforeEach(() => setReducedMotion(false));

  it("is hidden from screen readers, since the card states status in words", () => {
    const { container } = render(<PulseLine phase="live" changeSeq={0} pollSeq={0} />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("draws a flat resting trace in the live colour while idle", () => {
    const { container } = render(<PulseLine phase="live" changeSeq={0} pollSeq={1} />);
    runFrames(4);
    const strokes = [...container.querySelectorAll("polyline")].map((node) =>
      node.getAttribute("stroke"),
    );
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes).toContain("var(--signal-live)");
  });

  it("deflects in the change colour when the engine reports new data", () => {
    const { container, rerender } = render(
      <PulseLine phase="live" changeSeq={0} pollSeq={1} />,
    );
    runFrames(2);
    expect(container.innerHTML).not.toContain("var(--signal-change)");

    // A changed poll bumps both counters in the same commit.
    rerender(<PulseLine phase="live" changeSeq={1} pollSeq={2} />);
    runFrames(4);
    expect(container.innerHTML).toContain("var(--signal-change)");
  });

  it("does not deflect for a poll that changed nothing", () => {
    const { container, rerender } = render(
      <PulseLine phase="live" changeSeq={0} pollSeq={1} />,
    );
    runFrames(2);
    rerender(<PulseLine phase="live" changeSeq={0} pollSeq={2} />);
    runFrames(4);
    expect(container.innerHTML).not.toContain("var(--signal-change)");
  });

  it("goes dashed and dim when polling is failing", () => {
    const { container } = render(<PulseLine phase="error" changeSeq={0} pollSeq={3} />);
    const line = [...container.querySelectorAll("line")].find((node) =>
      node.getAttribute("stroke-dasharray"),
    );
    expect(line).toBeDefined();
    expect(line).toHaveAttribute("stroke", "var(--text-muted)");
  });

  it("stops animating while paused", () => {
    render(<PulseLine phase="paused" changeSeq={0} pollSeq={1} />);
    // Nothing subscribed to the ticker, so no frame was ever requested.
    expect(frameCallbacks).toHaveLength(0);
  });

  describe("with reduced motion", () => {
    beforeEach(() => setReducedMotion(true));

    it("runs no animation at all", () => {
      render(<PulseLine phase="live" changeSeq={1} pollSeq={1} lastPolledAt={10} lastChangedAt={10} />);
      expect(frameCallbacks).toHaveLength(0);
    });

    it("still shows the change as a static deflection, so the information survives", () => {
      const { container } = render(
        <PulseLine
          phase="live"
          changeSeq={1}
          pollSeq={1}
          lastPolledAt={1000}
          lastChangedAt={1000}
        />,
      );
      expect(container.querySelector("polyline")).toHaveAttribute(
        "stroke",
        "var(--signal-change)",
      );
    });

    it("returns to flat once a later poll brings nothing new", () => {
      const { container } = render(
        <PulseLine
          phase="live"
          changeSeq={1}
          pollSeq={2}
          lastPolledAt={2000}
          lastChangedAt={1000}
        />,
      );
      expect(container.querySelector("polyline")).toBeNull();
      expect(container.querySelector("line[stroke='var(--signal-live)']")).not.toBeNull();
    });
  });
});
