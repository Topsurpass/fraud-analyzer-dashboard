"use client";

import { AlertGlyph } from "./AlertHatch";

/**
 * Legend for multi-series charts.
 *
 * Built by hand rather than using Recharts' own so that each entry is a real
 * button: reachable by keyboard, focusable with the app's focus ring, and
 * carrying the hover-to-highlight behaviour on focus as well as on hover. A
 * mouse-only highlight would be an interaction the keyboard cannot reach.
 *
 * A flagged series keeps its own swatch colour and gains a separate alert
 * glyph. Recolouring the swatch would make two flagged series look identical,
 * which is exactly what the legend exists to prevent.
 *
 * `id` is separate from `label` because a label is data and data repeats. Two
 * pie categories with the same value, or a category genuinely called "Other"
 * beside the folded bucket, both produce two entries reading the same thing -
 * and React keyed by that collapses them into one, silently dropping a slice
 * from the legend.
 */
export interface SeriesLegendProps {
  series: { id: string; label: string; color: string; alert?: boolean; detail?: string }[];
  /** Currently highlighted series id, or null when nothing is hovered. */
  active: string | null;
  onActiveChange: (id: string | null) => void;
}

export function SeriesLegend({ series, active, onActiveChange }: SeriesLegendProps) {
  if (series.length < 2) return null;

  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 pb-3">
      {series.map((entry) => {
        const dimmed = active !== null && active !== entry.id;
        return (
          <li key={entry.id}>
            <button
              type="button"
              className="flex items-center gap-2 text-[13px] transition-opacity"
              style={{ opacity: dimmed ? 0.35 : 1 }}
              onMouseEnter={() => onActiveChange(entry.id)}
              onMouseLeave={() => onActiveChange(null)}
              onFocus={() => onActiveChange(entry.id)}
              onBlur={() => onActiveChange(null)}
              aria-pressed={active === entry.id}
            >
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: entry.color }}
              />
              <span className="text-secondary">{entry.label}</span>
              {entry.detail ? (
                <span className="tnum font-medium text-ink">{entry.detail}</span>
              ) : null}
              {entry.alert ? <AlertGlyph /> : null}
              {entry.alert ? <span className="sr-only">anomalous</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
