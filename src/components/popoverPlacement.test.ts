import { describe, expect, it } from "vitest";
import { placePanel, PANEL_GAP, VIEWPORT_MARGIN } from "./popoverPlacement";

const viewport = { width: 1000, height: 800 };
const box = (top: number, left: number, size = 28) => ({
  top,
  left,
  bottom: top + size,
  right: left + size,
});

describe("placePanel", () => {
  it("hangs below the trigger, right edges aligned, when it fits", () => {
    const trigger = box(100, 700);
    const p = placePanel({ trigger, panel: { width: 224, height: 200 }, viewport });
    expect(p.side).toBe("below");
    expect(p.top).toBe(trigger.bottom + PANEL_GAP);
    expect(p.left).toBe(trigger.right - 224);
  });

  it("opens above when below is too short and above is roomier", () => {
    const trigger = box(700, 700);
    const p = placePanel({ trigger, panel: { width: 224, height: 300 }, viewport });
    expect(p.side).toBe("above");
    // Bottom edge of the panel sits a gap above the trigger.
    expect(p.top + 300).toBe(trigger.top - PANEL_GAP);
  });

  it("stays below when it does not fit but above is no roomier", () => {
    const trigger = box(60, 700);
    const p = placePanel({ trigger, panel: { width: 224, height: 900 }, viewport });
    expect(p.side).toBe("below");
  });

  it("caps a panel taller than the room and never lets it leave the viewport", () => {
    // The real case: a 574px menu opened from a card near the bottom.
    for (const top of [20, 150, 400, 650, 770]) {
      const trigger = box(top, 700);
      const p = placePanel({ trigger, panel: { width: 224, height: 574 }, viewport });
      const height = Math.min(574, p.maxHeight);
      expect(p.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
      expect(p.top + height).toBeLessThanOrEqual(viewport.height - VIEWPORT_MARGIN);
    }
  });

  it("keeps a trigger at the left edge from pushing the panel off screen", () => {
    const p = placePanel({ trigger: box(100, 4), panel: { width: 224, height: 100 }, viewport });
    expect(p.left).toBe(VIEWPORT_MARGIN);
  });

  it("keeps a trigger at the right edge inside the viewport", () => {
    const p = placePanel({ trigger: box(100, 990), panel: { width: 224, height: 100 }, viewport });
    expect(p.left + 224).toBeLessThanOrEqual(viewport.width - VIEWPORT_MARGIN);
  });

  it("pins a panel wider than the viewport to the left margin", () => {
    const p = placePanel({
      trigger: box(100, 200),
      panel: { width: 2000, height: 100 },
      viewport,
    });
    expect(p.left).toBe(VIEWPORT_MARGIN);
  });

  it("never reports a negative room", () => {
    const p = placePanel({
      trigger: box(795, 100),
      panel: { width: 100, height: 100 },
      viewport: { width: 1000, height: 800 },
    });
    expect(p.maxHeight).toBeGreaterThanOrEqual(0);
  });
});
