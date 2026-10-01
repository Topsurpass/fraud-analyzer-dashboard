"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { placePanel } from "./popoverPlacement";

/**
 * A popover that closes the way every other popover on the web closes.
 *
 * Both menus in this app are built on `<details>`, which buys keyboard
 * operability and a dismiss-free implementation for nothing - but `<details>`
 * on its own has no notion of "outside". Left as-is it stays open after you
 * pick an option and stays open when you click the page behind it, so two of
 * them can be open at once and the panel hangs over the card you were trying to
 * read. That is what this fixes, in one place, for both.
 *
 * Three ways out, which is what a menu owes its user:
 *
 *   - picking an option (see `usePopoverClose`, and `MenuButton`, which calls it
 *     for you unless the item deliberately keeps the menu open)
 *   - pointing anywhere outside the panel
 *   - Escape, which also returns focus to the trigger so the keyboard does not
 *     lose its place
 *
 * ## The panel is drawn outside the card
 *
 * A chart card clips its contents (`overflow-hidden`, plus the paint
 * containment `defer-paint` adds, which also clips anything `position: fixed`
 * inside it). The card menu is 15 items and about 570px tall, so drawn inside
 * its card it was cut off: five items reachable on a number card, nine on the
 * rest, the others simply not there. The panel is therefore portalled to
 * `document.body` and placed with `position: fixed` from the trigger's box (see
 * `placePanel`): it opens on the roomier side, is capped to the room it has and
 * scrolls inside itself past that, and follows the trigger while the page
 * scrolls.
 *
 * Moving the panel in the DOM moves it in the tab order too, so the keyboard is
 * bridged by hand: Tab from the trigger goes into the panel, and Tab past its
 * last item (or Shift+Tab before its first) comes back to the trigger.
 */

const CloseContext = createContext<() => void>(() => {});

/** Close the popover this element is inside. A no-op outside one. */
export function usePopoverClose(): () => void {
  return useContext(CloseContext);
}

export interface PopoverProps {
  /** Accessible name for the trigger. */
  label: string;
  title?: string;
  /** What the trigger renders. Usually a glyph. */
  trigger: React.ReactNode;
  triggerClassName?: string;
  /** The panel's content. */
  children: React.ReactNode;
  /** How the panel looks (width, border, shadow). `Popover` positions it. */
  panelClassName?: string;
  className?: string;
  /** Told whenever the panel opens or closes, e.g. to reset a confirm step. */
  onOpenChange?: (open: boolean) => void;
}

export function Popover({
  label,
  title,
  trigger,
  triggerClassName,
  children,
  panelClassName,
  className,
  onOpenChange,
}: PopoverProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;

    /*
     * Capture phase, so this runs before the click reaches whatever is
     * underneath. `pointerdown` rather than `click`: a menu that is still open
     * while the mouse is held down over the page behind it reads as stuck.
     */
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The panel lives outside the <details>, so both count as "inside".
      if (ref.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
      onOpenChange?.(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      onOpenChange?.(false);
      // Escape must not strand focus on an element that no longer exists.
      ref.current?.querySelector("summary")?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  const focusables = () =>
    Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    );
  const focusTrigger = () => ref.current?.querySelector("summary")?.focus();

  return (
    <details
      ref={ref}
      open={open}
      className={`relative ${className ?? ""}`}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open;
        if (next === open) return;
        setOpen(next);
        onOpenChange?.(next);
      }}
    >
      <summary
        aria-label={label}
        title={title}
        className={triggerClassName}
        onKeyDown={(event) => {
          if (event.key !== "Tab" || event.shiftKey || !open) return;
          const first = focusables()[0];
          if (!first) return;
          event.preventDefault();
          first.focus();
        }}
      >
        {trigger}
      </summary>

      {/* Rendered only while open, so nothing inside is focusable when it is
          not, and a stale confirm step cannot be tabbed into. */}
      {open
        ? createPortal(
            <CloseContext.Provider value={close}>
              <FloatingPanel
                panelRef={panelRef}
                anchor={ref}
                className={panelClassName}
                onKeyDown={(event) => {
                  if (event.key !== "Tab") return;
                  const items = focusables();
                  const active = document.activeElement;
                  const atFirst = active === items[0];
                  const atLast = active === items[items.length - 1];
                  if (event.shiftKey ? atFirst : atLast) {
                    event.preventDefault();
                    focusTrigger();
                    // Leaving the end of a menu closes it, as it does on every
                    // platform; leaving backwards keeps it open under the trigger.
                    if (!event.shiftKey) close();
                  }
                }}
              >
                {children}
              </FloatingPanel>
            </CloseContext.Provider>,
            document.body,
          )
        : null}
    </details>
  );
}

/**
 * The panel itself: fixed to the viewport, placed from the trigger's box.
 *
 * Measured before paint (`useLayoutEffect`) and hidden until then, so it never
 * flashes at the corner. Re-placed on resize and on any scroll, in the capture
 * phase because scrolling does not bubble and the thing that scrolls is the page
 * body, not the window.
 */
function FloatingPanel({
  panelRef,
  anchor,
  className,
  onKeyDown,
  children,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  anchor: React.RefObject<HTMLDetailsElement | null>;
  className?: string;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  children: React.ReactNode;
}) {
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    top: 0,
    left: 0,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    const place = () => {
      const panel = panelRef.current;
      const trigger = anchor.current;
      if (!panel || !trigger) return;
      const box = trigger.getBoundingClientRect();
      // `scrollHeight` is the content's own height whatever cap is applied, plus
      // the border the scroll box does not count.
      const natural = panel.scrollHeight + (panel.offsetHeight - panel.clientHeight);
      const placement = placePanel({
        trigger: box,
        panel: { width: panel.offsetWidth, height: natural },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      setStyle((previous) =>
        previous.top === placement.top &&
        previous.left === placement.left &&
        previous.maxHeight === placement.maxHeight &&
        previous.visibility === undefined
          ? previous
          : {
              position: "fixed",
              top: placement.top,
              left: placement.left,
              maxHeight: placement.maxHeight,
            },
      );
    };

    place();
    // A panel whose content changes (a confirm step, an error line) changes its
    // own height, and the room it needs with it.
    const panel = panelRef.current;
    const observer =
      typeof ResizeObserver === "undefined" || !panel ? null : new ResizeObserver(place);
    if (panel) observer?.observe(panel);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [panelRef, anchor]);

  return (
    <div
      ref={panelRef}
      style={style}
      onKeyDown={onKeyDown}
      className={`z-50 overflow-y-auto overscroll-contain ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
