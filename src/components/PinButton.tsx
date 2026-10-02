"use client";

import { usePins } from "@/services/pins/pinStore";

/**
 * Pins a card to the top of its board.
 *
 * A pinned card stays where it was put: at the top, in the order it was pinned,
 * and it does not move when a poll flags it or another card. The flag marks on it
 * keep working; only its place is fixed. Shown filled in the accent colour while
 * pinned, which is the one state a reader should be able to see across a board
 * without reading anything.
 *
 * Absent when nobody is signed in (pins are kept per person) and a no-op then.
 */
export function PinButton({ id, name }: { id: string; name: string }) {
  const pins = usePins();
  const pinned = pins.isPinned(id);

  return (
    <button
      type="button"
      onClick={() => pins.toggle(id)}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${name}` : `Pin ${name} to the top`}
      title={pinned ? "Unpin" : "Pin to the top"}
      className={`grid size-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-raised ${
        pinned ? "text-accent" : "text-muted hover:text-ink"
      }`}
    >
      <svg width={13} height={13} viewBox="0 0 16 16" aria-hidden="true">
        {/* A map pin: head, and the needle that goes into the board. */}
        <path
          d="M10.5 1.5 14.5 5.5l-1.6.6-2.3 2.3.3 3.1-1.1 1.1-2.4-2.4L3.6 12.4 3.2 12 5.3 9.4 2.9 7l1.1-1.1 3.1.3 2.3-2.3.6-1.6Z"
          fill={pinned ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
