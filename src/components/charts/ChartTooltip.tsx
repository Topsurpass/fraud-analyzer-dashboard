"use client";

import type { ReactNode } from "react";
import { formatMetric } from "@/services/format";

/**
 * Tooltip for every cartesian chart.
 *
 * This is where the monospace treatment matters most: the analyst is reading
 * exact figures off a moving chart, and proportional digits make two readings
 * taken a second apart hard to compare.
 */

export interface TooltipEntry {
  name: string;
  value: number;
  color: string;
  alert: boolean;
}

export interface ChartTooltipProps {
  label: ReactNode;
  entries: TooltipEntry[];
  /** Rendered under the entries, e.g. a share-of-total line for pie slices. */
  footer?: ReactNode;
}

export function ChartTooltip({ label, entries, footer }: ChartTooltipProps) {
  if (entries.length === 0) return null;

  return (
    <div className="min-w-[9rem] border border-line-strong bg-raised px-2.5 py-2">
      <div className="tnum mb-1.5 text-[11px] text-muted">{label}</div>
      <ul className="space-y-1">
        {entries.map((entry) => (
          <li key={entry.name} className="flex items-baseline gap-2">
            <span
              aria-hidden="true"
              className="mt-[3px] h-[3px] w-2.5 shrink-0 self-start"
              style={{ background: entry.alert ? "var(--signal-alert)" : entry.color }}
            />
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{entry.name}</span>
            <span
              className="tnum text-[12px]"
              style={{ color: entry.alert ? "var(--signal-alert)" : "var(--text-primary)" }}
            >
              {formatMetric(entry.value, { compact: false })}
            </span>
          </li>
        ))}
      </ul>
      {/* Colour is never the only signal: an alerted reading says so in words. */}
      {entries.some((entry) => entry.alert) ? (
        <div className="mt-1.5 border-t border-line pt-1.5 text-[10px] tracking-wide text-alert uppercase">
          Anomalous
        </div>
      ) : null}
      {footer ? <div className="mt-1.5 border-t border-line pt-1.5">{footer}</div> : null}
    </div>
  );
}
