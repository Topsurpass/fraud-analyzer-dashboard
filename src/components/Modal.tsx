"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * A modal dialog on the platform's own `<dialog>` element.
 *
 * `showModal()` does the parts that are easy to get wrong by hand: focus is
 * held inside, the page behind goes inert (no tabbing or clicking through),
 * Escape is wired, and focus returns to whatever opened it. What is added here
 * is the rest of the contract people expect - a labelled header, a close
 * button, a backdrop click that closes (but not a text selection that merely
 * ends on the backdrop), a scroll lock on the page, and a way to refuse to
 * close while a save is in flight.
 *
 * The body is mounted only while open, so every opening starts from a fresh
 * form rather than whatever was half-typed last time.
 *
 * Put `data-autofocus` on the control that should take focus first; without
 * one the browser picks the first focusable element, which is the close button.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  dismissible = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /**
   * False while something cannot be interrupted (a save in flight): Escape, the
   * backdrop and the close button all do nothing, so the dialog cannot vanish
   * under a request whose result the person is waiting to read.
   */
  dismissible?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // The page behind must not scroll under the dialog.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // Escape. Always handled here so the native close never fires on its
        // own: `open` is the single source of truth for whether it is shown.
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onMouseDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Both ends of the click on the backdrop: a drag that starts in a field
        // and ends outside the box is a text selection, not a dismissal.
        if (event.target === event.currentTarget && pressedOnBackdrop.current && dismissible) {
          onClose();
        }
        pressedOnBackdrop.current = false;
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(44rem,calc(100vw-2rem))] overflow-y-auto rounded-[var(--radius-lg)] border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-[rgb(9_11_20/0.55)] backdrop:backdrop-blur-[3px]"
    >
      {open ? (
        <div className="rise">
          <header className="flex items-start gap-3 border-b border-line px-6 py-4">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[17px] font-semibold tracking-tight">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-[13px] leading-relaxed text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={!dismissible}
              aria-label="Close"
              className="-mr-2 grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
            >
              <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
              </svg>
            </button>
          </header>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
