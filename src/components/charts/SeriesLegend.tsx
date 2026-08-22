"use client";

/**
 * Legend for multi-series charts.
 *
 * Built by hand rather than using Recharts' own so that each entry is a real
 * button: reachable by keyboard, focusable with the app's focus ring, and
 * carrying the hover-to-highlight behaviour on focus as well as on hover. A
 * mouse-only highlight would be an interaction the keyboard cannot reach.
 */
export interface SeriesLegendProps {
  series: { key: string; color: string }[];
  /** Currently highlighted series key, or null when nothing is hovered. */
  active: string | null;
  onActiveChange: (key: string | null) => void;
}

export function SeriesLegend({ series, active, onActiveChange }: SeriesLegendProps) {
  if (series.length < 2) return null;

  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2">
      {series.map((entry) => {
        const dimmed = active !== null && active !== entry.key;
        return (
          <li key={entry.key}>
            <button
              type="button"
              className="flex items-center gap-1.5 text-[11px] transition-opacity"
              style={{ opacity: dimmed ? 0.35 : 1 }}
              onMouseEnter={() => onActiveChange(entry.key)}
              onMouseLeave={() => onActiveChange(null)}
              onFocus={() => onActiveChange(entry.key)}
              onBlur={() => onActiveChange(null)}
              aria-pressed={active === entry.key}
            >
              <span
                aria-hidden="true"
                className="h-[3px] w-3 shrink-0"
                style={{ background: entry.color }}
              />
              <span className="tnum text-muted">{entry.key}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
