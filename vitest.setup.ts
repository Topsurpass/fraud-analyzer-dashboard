import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/*
 * Testing Library's `waitFor` defaults to a 1s budget. The assertions here
 * resolve in milliseconds, but this suite shares a machine with a dev server
 * and a database, and under that load 1s is reachable - which shows up as a
 * flaky failure rather than an honest one. The budget is raised so that a
 * timeout means something is actually wrong, and kept well under vitest's own
 * per-test timeout so the inner limit is never the one that fires.
 */
configure({ asyncUtilTimeout: 4_000 });

afterEach(() => {
  cleanup();
});

// jsdom ships neither of these and Recharts + the pulse line need both.
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
