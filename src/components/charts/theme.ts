/**
 * Shared chart styling.
 *
 * The series palette deliberately excludes amber and red. The design brief
 * reserves --signal-change for "this data just moved" and --signal-alert for
 * flagged or anomalous points, and a series that happened to be drawn in either
 * colour would destroy that meaning. So the categorical ramp is cool and
 * neutral hues only.
 *
 * The order below is not cosmetic - it was chosen by running the palette
 * validator against the card surface (#1A1F29) and keeping an ordering that
 * passes every gate:
 *
 *   lightness band      all 5 inside L 0.48-0.67
 *   chroma floor        all 5 >= 0.1
 *   CVD separation      worst adjacent dE 13.0 (deutan)
 *   normal-vision floor worst adjacent dE 19.7
 *   contrast vs surface all 5 >= 3:1
 *
 * Re-run the validator before changing or extending this list.
 */
export const SERIES_COLORS = [
  "#3987e5", // blue
  "#199e70", // aqua
  "#9085e9", // violet
  "#d55181", // magenta
  "#008300", // green
] as const;

/**
 * Past this many series the palette stops being distinguishable, so the tail is
 * folded into one "Other" bucket rather than cycling hues back to the start.
 */
export const MAX_SERIES = SERIES_COLORS.length;
export const OTHER_COLOR = "#6b7488"; // slate, clearly outside the ramp

export const OTHER_LABEL = "Other";

/** Colour for series `index`, never cycled past the end of the ramp. */
export function seriesColor(index: number): string {
  return SERIES_COLORS[Math.min(index, SERIES_COLORS.length - 1)];
}

export const AXIS_TICK = {
  fill: "var(--text-muted)",
  fontSize: 11,
  fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
} as const;

export const GRID_STROKE = "var(--border)";
export const CURSOR_STROKE = "var(--signal-live)";
export const ALERT_COLOR = "var(--signal-alert)";

/** Short enough that the panel still feels fast, per the brief. */
export const DATA_TWEEN_MS = 360;

export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const;
