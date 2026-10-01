/**
 * Where a popover panel goes, as plain arithmetic.
 *
 * A panel is drawn outside the card that opened it (see `Popover`), so nothing
 * but this keeps it on screen: it opens on whichever side of the trigger has
 * more room when the preferred side is too short, it is capped to the room that
 * side has (the panel then scrolls inside itself), and it is pulled back inside
 * the viewport horizontally. Pure on purpose: layout cannot be tested in jsdom,
 * the numbers can.
 */

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Placement {
  top: number;
  left: number;
  /** The tallest the panel may be here; taller content scrolls inside it. */
  maxHeight: number;
  side: "below" | "above";
}

export const PANEL_GAP = 6;
export const VIEWPORT_MARGIN = 8;

export function placePanel({
  trigger,
  panel,
  viewport,
  gap = PANEL_GAP,
  margin = VIEWPORT_MARGIN,
}: {
  trigger: Box;
  /** The panel's natural size, before any cap. */
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  gap?: number;
  margin?: number;
}): Placement {
  const below = Math.max(0, viewport.height - trigger.bottom - gap - margin);
  const above = Math.max(0, trigger.top - gap - margin);

  // Below is the habit, so it wins whenever the panel fits or above is no
  // roomier. Only a panel that does not fit below AND has more room above flips.
  const side: Placement["side"] = panel.height <= below || below >= above ? "below" : "above";
  const room = side === "below" ? below : above;
  const height = Math.min(panel.height, room);

  const top = side === "below" ? trigger.bottom + gap : trigger.top - gap - height;

  // Right edges line up, the way a menu hangs from a button in a header. Then
  // clamp: a trigger near the left edge must not push the panel off it, and a
  // panel wider than the viewport pins to the left margin.
  const rightAligned = trigger.right - panel.width;
  const left = Math.max(margin, Math.min(rightAligned, viewport.width - panel.width - margin));

  return { top, left, maxHeight: room, side };
}
