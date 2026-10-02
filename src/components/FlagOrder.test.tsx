import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChartGrid } from "./ChartGrid";
import { SETTLE_MS, useReportFlags } from "./FlagOrder";
import { POINTER_RELEASE_MS, holdFlagOrder, resetFlagOrderHold } from "./flagOrderHold";
import type { FlagSeverity } from "@/contracts/api";

/**
 * jsdom has no layout, so the glide itself is checked in a real browser
 * (`scripts/check-reorder.mjs`). What is held here is the part that decides WHEN
 * and IN WHAT ORDER cards move: sorted by flag state, stable, held while the
 * reader is using the board, and tidy when a card goes away.
 */

afterEach(() => {
  resetFlagOrderHold();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Card({
  id,
  count,
  severity = "high",
}: {
  id: string;
  count: number;
  severity?: FlagSeverity | null;
}) {
  useReportFlags(id, count, count > 0 ? severity : null);
  return <article data-id={id}>{id}</article>;
}

const ids = (container: HTMLElement) =>
  [...container.querySelectorAll("article")].map((node) => node.getAttribute("data-id"));

const tick = () => act(async () => void (await Promise.resolve()));

function board(counts: Record<string, number>, severities: Record<string, FlagSeverity> = {}) {
  return (
    <ChartGrid>
      {Object.entries(counts).map(([id, count]) => (
        <Card key={id} id={id} count={count} severity={severities[id] ?? "high"} />
      ))}
    </ChartGrid>
  );
}

describe("flagged cards rise", () => {
  it("keeps the page's order while nothing is flagged", async () => {
    const { container } = render(board({ a: 0, b: 0, c: 0 }));
    await tick();
    expect(ids(container)).toEqual(["a", "b", "c"]);
  });

  it("puts a flagged card first", async () => {
    const { container } = render(board({ a: 0, b: 3, c: 0 }));
    await tick();
    expect(ids(container)).toEqual(["b", "a", "c"]);
  });

  it("moves a card to the top when a later poll flags it", async () => {
    const { container, rerender } = render(board({ a: 0, b: 0, c: 0 }));
    await tick();
    rerender(board({ a: 0, b: 0, c: 2 }));
    await tick();
    expect(ids(container)).toEqual(["c", "a", "b"]);
  });

  it("puts the card flagged most recently ahead of one flagged earlier", async () => {
    const { container, rerender } = render(board({ a: 0, b: 0, c: 0 }));
    await tick();
    rerender(board({ a: 5, b: 0, c: 0 }));
    await tick();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    rerender(board({ a: 5, b: 1, c: 0 }));
    await tick();
    expect(ids(container)).toEqual(["b", "a", "c"]);
  });

  it("sends a card back to its place when its flags clear", async () => {
    const { container, rerender } = render(board({ a: 0, b: 0, c: 2 }));
    await tick();
    expect(ids(container)).toEqual(["c", "a", "b"]);
    rerender(board({ a: 0, b: 0, c: 0 }));
    await tick();
    expect(ids(container)).toEqual(["a", "b", "c"]);
  });

  it("does not reshuffle when a poll repeats the same flags", async () => {
    const { container, rerender } = render(board({ a: 1, b: 1, c: 0 }));
    await tick();
    const first = ids(container);
    for (let i = 0; i < 3; i++) {
      rerender(board({ a: 1, b: 1, c: 0 }));
      await tick();
    }
    expect(ids(container)).toEqual(first);
  });

  it("keeps a card's place while its count only falls (rows dismissed)", async () => {
    const { container, rerender } = render(board({ a: 0, b: 0, c: 0 }));
    await tick();
    rerender(board({ a: 4, b: 0, c: 0 }));
    await tick();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    rerender(board({ a: 4, b: 2, c: 0 }));
    await tick();
    expect(ids(container)).toEqual(["b", "a", "c"]);
    rerender(board({ a: 1, b: 2, c: 0 }));
    await tick();
    expect(ids(container)).toEqual(["b", "a", "c"]);
  });
});

describe("the board is held while the reader is using it", () => {
  it("applies nothing while a hold is taken, then applies it on release", async () => {
    const { container, rerender } = render(board({ a: 0, b: 0, c: 0 }));
    await tick();
    const release = holdFlagOrder();
    rerender(board({ a: 0, b: 0, c: 2 }));
    await tick();
    expect(ids(container)).toEqual(["a", "b", "c"]);

    await act(async () => release());
    await tick();
    expect(ids(container)).toEqual(["c", "a", "b"]);
  });

  it("stays held until the last of two holds ends", async () => {
    const { container, rerender } = render(board({ a: 0, b: 0 }));
    await tick();
    const first = holdFlagOrder();
    const second = holdFlagOrder();
    rerender(board({ a: 0, b: 1 }));
    await tick();
    await act(async () => first());
    expect(ids(container)).toEqual(["a", "b"]);
    await act(async () => second());
    await tick();
    expect(ids(container)).toEqual(["b", "a"]);
  });

  it("is held while a pointer is pressed, and applied just after the click", async () => {
    const { container, rerender } = render(board({ a: 0, b: 0 }));
    await tick();
    await act(async () => {
      document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    rerender(board({ a: 0, b: 1 }));
    await tick();
    expect(ids(container)).toEqual(["a", "b"]);

    await act(async () => {
      document.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    await tick();
    // `pointerup` comes before `click`: still held, so the click lands on the
    // card the reader aimed at. Checked again partway through the delay, because
    // a release that merely waited one tick would pass the line above.
    expect(ids(container)).toEqual(["a", "b"]);
    await act(async () => new Promise((resolve) => setTimeout(resolve, POINTER_RELEASE_MS / 2)));
    expect(ids(container)).toEqual(["a", "b"]);

    await act(async () => new Promise((resolve) => setTimeout(resolve, POINTER_RELEASE_MS + 40)));
    expect(ids(container)).toEqual(["b", "a"]);
  });

  it("a second press cancels the release counting down from the first", async () => {
    const { container, rerender } = render(board({ a: 0, b: 0 }));
    await tick();
    await act(async () => {
      document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      document.dispatchEvent(new Event("pointerup", { bubbles: true }));
      document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    rerender(board({ a: 0, b: 1 }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, POINTER_RELEASE_MS + 40)));
    expect(ids(container)).toEqual(["a", "b"]);
  });

  it("applies only the latest state when several polls land during a hold", async () => {
    const { container, rerender } = render(board({ a: 0, b: 0, c: 0 }));
    await tick();
    const release = holdFlagOrder();
    rerender(board({ a: 1, b: 0, c: 0 }));
    await tick();
    rerender(board({ a: 0, b: 0, c: 3 }));
    await tick();
    await act(async () => release());
    await tick();
    expect(ids(container)).toEqual(["c", "a", "b"]);
  });
});

describe("tidy", () => {
  it("forgets a card that leaves, so it cannot hold a place", async () => {
    const { container, rerender } = render(board({ a: 0, b: 2, c: 0 }));
    await tick();
    expect(ids(container)).toEqual(["b", "a", "c"]);
    rerender(board({ a: 0, c: 0 }));
    await tick();
    expect(ids(container)).toEqual(["a", "c"]);
  });

  it("renders children that never report, in the page's order", async () => {
    const { container } = render(
      <ChartGrid>
        <div key="skeleton-0" data-id="s0" />
        <Card key="x" id="x" count={1} />
        <div key="skeleton-1" data-id="s1" />
      </ChartGrid>,
    );
    await tick();
    const order = [...container.querySelectorAll("[data-id]")].map((n) => n.getAttribute("data-id"));
    expect(order).toEqual(["x", "s0", "s1"]);
  });

  it("works for a card used outside any grid", () => {
    expect(() => render(<Card id="solo" count={3} />)).not.toThrow();
  });
});

describe("a card that first appears flagged", () => {
  it("leads once the grid has settled, ahead of cards flagged earlier", async () => {
    const real = Date.now();
    const { container, rerender } = render(board({ a: 5 }));
    await tick();
    vi.spyOn(Date, "now").mockReturnValue(real + SETTLE_MS + 500);
    // A new card joins the board already flagged, with less to report than `a`.
    rerender(board({ a: 5, n: 1 }));
    await tick();
    expect(ids(container)).toEqual(["n", "a"]);
  });

  it("does not lead during the page's first moments", async () => {
    const { container } = render(board({ a: 5, n: 1 }));
    await tick();
    // Both arrived at once at load: ordered by count, not by who reported last.
    expect(ids(container)).toEqual(["a", "n"]);
  });
});

describe("keys", () => {
  it("keeps every card when two arrays reuse the same id", async () => {
    const { container } = render(
      <ChartGrid>
        {[<Card key="x" id="x" count={0} />]}
        {[<Card key="x" id="x" count={0} />]}
      </ChartGrid>,
    );
    await tick();
    expect(ids(container)).toEqual(["x", "x"]);
  });

  it("matches an id that contains a dollar sign", async () => {
    const { container } = render(board({ a: 0, "b$1": 2, c: 0 }));
    await tick();
    expect(ids(container)).toEqual(["b$1", "a", "c"]);
  });

  it("renders a Fragment child without moving the wrong card", async () => {
    const { container } = render(
      <ChartGrid>
        <Card key="a" id="a" count={0} />
        <>
          <article key="f1" data-id="f1" />
          <article key="f2" data-id="f2" />
        </>
        <Card key="c" id="c" count={3} />
      </ChartGrid>,
    );
    await tick();
    expect(ids(container).sort()).toEqual(["a", "c", "f1", "f2"]);
  });
});
