"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

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
  /** The panel. Positioned by `panelClassName`; the wrapper is `relative`. */
  children: React.ReactNode;
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
      if (ref.current?.contains(event.target as Node)) return;
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
      <summary aria-label={label} title={title} className={triggerClassName}>
        {trigger}
      </summary>

      {/* Rendered only while open, so nothing inside is focusable when it is
          not, and a stale confirm step cannot be tabbed into. */}
      {open ? (
        <CloseContext.Provider value={close}>
          <div className={panelClassName}>{children}</div>
        </CloseContext.Provider>
      ) : null}
    </details>
  );
}
