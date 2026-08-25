"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Render only the rows near the viewport.
 *
 * A 10,000-row result put 10,000 <tr> in the DOM, each with a cell per column.
 * At twelve columns that is 120,000 nodes for the forty a person can see, and
 * the cost lands on the main thread during a poll - the exact moment the app is
 * meant to feel alive.
 *
 * Deliberately not a library. The requirement here is narrow: fixed-height rows
 * in one scroll container, no nesting, no dynamic measurement. That is thirty
 * lines, and a dependency would bring a measurement engine this does not need.
 *
 * `overscan` rows are kept on each side so a fast flick shows data rather than
 * a blank band, and scroll is read through rAF so a trackpad emitting scroll
 * events faster than frames cannot queue a state update per event.
 */
export interface VirtualWindow {
  /** First row index to render. */
  start: number;
  /** One past the last row index to render. */
  end: number;
  /** Spacer height above the rendered rows, in pixels. */
  padTop: number;
  /** Spacer height below them. */
  padBottom: number;
}

export function useVirtualRows(
  scrollRef: React.RefObject<HTMLElement | null>,
  rowCount: number,
  rowHeight: number,
  overscan = 12,
): VirtualWindow {
  const [range, setRange] = useState({ start: 0, end: Math.min(rowCount, 60) });
  const frame = useRef<number | null>(null);

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    const first = Math.floor(element.scrollTop / rowHeight);
    const visible = Math.ceil(element.clientHeight / rowHeight);
    const start = Math.max(0, first - overscan);
    const end = Math.min(rowCount, first + visible + overscan);

    setRange((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
  }, [scrollRef, rowCount, rowHeight, overscan]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const onScroll = () => {
      // One measurement per frame. A trackpad fires scroll faster than the
      // browser paints, and a setState per event is how a virtual list ends up
      // slower than the naive render it replaced.
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        measure();
      });
    };

    measure();
    element.addEventListener("scroll", onScroll, { passive: true });

    // The container can change height without scrolling: an expanded card, a
    // resized window, a panel opening beside it.
    const observer = new ResizeObserver(onScroll);
    observer.observe(element);

    return () => {
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [scrollRef, measure]);

  const start = Math.min(range.start, Math.max(0, rowCount - 1));
  const end = Math.min(range.end, rowCount);

  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (rowCount - end) * rowHeight),
  };
}
