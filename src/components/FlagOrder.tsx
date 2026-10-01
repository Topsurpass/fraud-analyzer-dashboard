"use client";

import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import type { FlagSeverity } from "@/contracts/api";
import {
  UNFLAGGED,
  newlyFlagged,
  nextFlagState,
  orderKeys,
  sameFlagState,
  shiftsBetween,
  type Box,
  type FlagState,
} from "./flagRanking";
import { isFlagOrderHeld, subscribeFlagOrderHold } from "./flagOrderHold";

/**
 * Cards that get flagged rise to the top of their grid, smoothly.
 *
 * Each card reports how many rows its last poll flagged (`useReportFlags`). The
 * provider keeps the latest state of every card and, when nothing is holding the
 * board, copies it into `applied`; the grid sorts its children by `applied` and
 * animates whatever moved (FLIP: lay out in the new order, then animate each card
 * from where it was to where it is).
 *
 * The DOM order is the visual order, deliberately. Moving cards with CSS `order`
 * would be simpler, but it leaves keyboard focus order and screen-reader order
 * different from what is on screen.
 */

/** How long cards take to glide into place. */
export const MOVE_MS = 380;
/** The curve: quick off the mark, a soft landing. */
export const MOVE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
/**
 * The first moments after a grid mounts, when every card's first poll lands one
 * after another and the order settles from nothing. Moving cards in that window
 * would be a shuffle at every page load, so it applies the order without motion.
 */
export const SETTLE_MS = 2000;

interface FlagOrderContextValue {
  applied: ReadonlyMap<string, FlagState>;
  report: (id: string, count: number, severity: FlagSeverity | null) => void;
  forget: (id: string) => void;
}

const FlagOrderContext = createContext<FlagOrderContextValue | null>(null);

/** Called by a card with what its latest poll found. A no-op outside a grid. */
export function useReportFlags(
  id: string | null | undefined,
  count: number,
  severity: FlagSeverity | null,
): void {
  const context = useContext(FlagOrderContext);
  const report = context?.report;
  const forget = context?.forget;

  useEffect(() => {
    if (!id || !report) return;
    report(id, count, severity);
  }, [id, count, severity, report]);

  useEffect(() => {
    if (!id || !forget) return;
    return () => forget(id);
  }, [id, forget]);
}

export function FlagOrderProvider({ children }: { children: ReactNode }) {
  const latest = useRef(new Map<string, FlagState>());
  const [applied, setApplied] = useState<ReadonlyMap<string, FlagState>>(() => new Map());
  const dirty = useRef(false);
  const scheduled = useRef(false);

  const flush = useCallback(() => {
    scheduled.current = false;
    if (!dirty.current || isFlagOrderHeld()) return;
    dirty.current = false;
    setApplied(new Map(latest.current));
  }, []);

  // Several cards report in the same tick when a board's polls land together;
  // one microtask folds them into a single reorder.
  const markDirty = useCallback(() => {
    dirty.current = true;
    if (scheduled.current) return;
    scheduled.current = true;
    queueMicrotask(flush);
  }, [flush]);

  // The moment the last hold ends, apply what was waiting.
  useEffect(() => subscribeFlagOrderHold(flush), [flush]);

  const report = useCallback(
    (id: string, count: number, severity: FlagSeverity | null) => {
      const previous = latest.current.get(id);
      const next = nextFlagState(previous, count, severity, Date.now());
      if (previous !== undefined && sameFlagState(previous, next)) return;
      latest.current.set(id, next);
      markDirty();
    },
    [markDirty],
  );

  const forget = useCallback(
    (id: string) => {
      if (latest.current.delete(id)) markDirty();
    },
    [markDirty],
  );

  const value = useMemo(() => ({ applied, report, forget }), [applied, report, forget]);
  return <FlagOrderContext.Provider value={value}>{children}</FlagOrderContext.Provider>;
}

/** React prefixes keys it normalises (`.$abc`); this gives the one the page wrote. */
function keyOf(element: ReactElement, index: number): string {
  const raw = element.key === null ? `.${index}` : String(element.key);
  const dollar = raw.lastIndexOf("$");
  return dollar === -1 ? raw : raw.slice(dollar + 1);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The grid's children, sorted, inside a container that animates the move.
 * `render` receives the container props and the ordered children.
 */
export function useOrderedGrid(children: ReactNode) {
  const context = useContext(FlagOrderContext);
  const applied = context?.applied;
  const containerRef = useRef<HTMLDivElement>(null);

  const ordered = useMemo(() => {
    const elements = Children.toArray(children).filter(isValidElement) as ReactElement[];
    const keys = elements.map(keyOf);
    if (!applied || applied.size === 0) return { elements, keys };
    const byKey = new Map(elements.map((element, index) => [keys[index], element]));
    const order = orderKeys(keys, applied);
    return { elements: order.map((key) => byKey.get(key)!), keys: order };
  }, [children, applied]);

  const mountedAt = useRef(0);
  const boxes = useRef<Map<string, Box>>(new Map());
  const signature = useRef("");
  const lastApplied = useRef<ReadonlyMap<string, FlagState>>(new Map());

  const measure = useCallback((keys: string[]) => {
    const container = containerRef.current;
    const next = new Map<string, Box>();
    if (!container) return next;
    keys.forEach((key, index) => {
      const child = container.children[index] as HTMLElement | undefined;
      // offsetLeft/Top ignore transforms, so a card still mid-glide from the
      // last reorder is measured at where it really is in the layout.
      if (child) next.set(key, { left: child.offsetLeft, top: child.offsetTop });
    });
    return next;
  }, []);

  useLayoutEffect(() => {
    if (mountedAt.current === 0) mountedAt.current = Date.now();
    const container = containerRef.current;
    const nextBoxes = measure(ordered.keys);
    const nextSignature = ordered.keys.join("\u0000");
    const reordered = signature.current !== "" && nextSignature !== signature.current;
    const settled = Date.now() - mountedAt.current > SETTLE_MS;

    if (reordered && settled && container && !prefersReducedMotion()) {
      const risen = new Set(newlyFlagged(lastApplied.current, applied ?? new Map()));
      for (const shift of shiftsBetween(boxes.current, nextBoxes)) {
        const index = ordered.keys.indexOf(shift.key);
        const element = container.children[index] as HTMLElement | undefined;
        if (!element || typeof element.animate !== "function") continue;
        // The card that just arrived travels over its neighbours, not under them.
        const lift = risen.has(shift.key) ? { zIndex: 2 } : {};
        element.animate(
          [
            { transform: `translate(${shift.dx}px, ${shift.dy}px)`, ...lift },
            { transform: "translate(0, 0)", ...lift },
          ],
          { duration: MOVE_MS, easing: MOVE_EASING },
        );
        if (risen.has(shift.key)) {
          // A ring that fades: which card just arrived, without a second colour.
          element.animate(
            [
              { boxShadow: "0 0 0 3px var(--signal-change)" },
              { boxShadow: "0 0 0 0 transparent" },
            ],
            { duration: 1400, easing: "ease-out" },
          );
        }
      }
    }

    boxes.current = nextBoxes;
    signature.current = nextSignature;
    lastApplied.current = applied ?? new Map();
  });

  // A window resize or a card growing moves everything without reordering
  // anything; remember the new positions so the next reorder starts from them.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      boxes.current = measure(ordered.keys);
    });
    observer.observe(container);
    for (const child of Array.from(container.children)) observer.observe(child);
    return () => observer.disconnect();
  });

  return { containerRef, children: ordered.elements };
}

export { UNFLAGGED };
