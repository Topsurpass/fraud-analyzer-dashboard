/**
 * Shared chart styling.
 *
 * The series palette deliberately excludes amber and red. The design brief
 * reserves --signal-change for "this data just moved" and --signal-alert for
 * flagged or anomalous points, and a series that happened to be drawn in either
 * colour would destroy that meaning. So the categorical ramp is cool and
 * neutral hues only.
 *
 * Mid-tone hues that hold 3:1 against both the white and the dark card
 * surface, so one ramp serves both themes and a chart does not shift colour
 * when the theme flips. Indigo leads because it is the brand accent; the rest
 * are spaced around the wheel for separation.
 */
export const SERIES_COLORS = [
  "#6366f1", // indigo
  "#0891b2", // cyan
  "#a855f7", // violet
  "#db2777", // magenta
  "#059669", // emerald
] as const;

/**
 * Past this many series the palette stops being distinguishable, so the tail is
 * folded into one "Other" bucket rather than cycling hues back to the start.
 */
export const MAX_SERIES = SERIES_COLORS.length;
export const OTHER_COLOR = "#94a3b8"; // slate, clearly outside the ramp

export const OTHER_LABEL = "Other";

/** Colour for series `index`, never cycled past the end of the ramp. */
export function seriesColor(index: number): string {
  return SERIES_COLORS[Math.min(index, SERIES_COLORS.length - 1)];
}

export const AXIS_TICK = {
  fill: "var(--text-muted)",
  fontSize: 11.5,
  fontFamily: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
} as const;

export const GRID_STROKE = "var(--border)";
export const CURSOR_STROKE = "var(--border-strong)";
export const ALERT_COLOR = "var(--signal-alert)";

/** Short enough that the panel still feels fast, per the brief. */
export const DATA_TWEEN_MS = 360;

/**
 * Marks past which the entry tween is dropped.
 *
 * Recharts animates a bar chart per rectangle, so the tween is one interpolated
 * style write per mark per frame: at 900 points across five series that is
 * 4,500 writes a frame for an effect nobody can follow. The information the
 * animation carries - "this data just changed" - is already on the card's pulse
 * line and its change chip, so dropping it above this budget costs the reader
 * nothing.
 */
export const ANIMATION_MARK_BUDGET = 400;

export const CHART_MARGIN = { top: 12, right: 26, bottom: 0, left: 4 } as const;
