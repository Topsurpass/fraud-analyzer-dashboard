/**
 * Bench-lane DOM setup.
 *
 * Separate from `vitest.setup.ts` on purpose: the gate lane's teardown imports
 * the poll coalescer, and the bench measures shaping and rendering with no
 * polling in the graph at all.
 *
 * The one non-obvious stub is `getBoundingClientRect`. Recharts sizes itself
 * from the container's measured box, and jsdom reports every box as zero, so
 * without this every recharts view renders an empty SVG and the render numbers
 * would be a measurement of nothing.
 */

import { vi } from "vitest";

export const BENCH_PLOT_WIDTH = 900;
export const BENCH_PLOT_HEIGHT = 300;

if (!globalThis.matchMedia) {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof globalThis.matchMedia;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

Element.prototype.getBoundingClientRect = function benchRect(): DOMRect {
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: BENCH_PLOT_WIDTH,
    bottom: BENCH_PLOT_HEIGHT,
    width: BENCH_PLOT_WIDTH,
    height: BENCH_PLOT_HEIGHT,
  };
  return { ...rect, toJSON: () => rect } as DOMRect;
};
