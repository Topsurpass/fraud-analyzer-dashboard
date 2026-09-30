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
    <div className="min-w-[10.5rem] rounded-[var(--radius)] border border-line bg-surface/95 px-3 py-2.5 shadow-lg backdrop-blur-md">
      <div className="mb-2 text-[12px] font-medium text-muted">{label}</div>
      <ul className="space-y-1.5">
        {entries.map((entry) => (
          <li key={entry.name} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: entry.alert ? "var(--signal-alert)" : entry.color }}
            />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-secondary">
              {entry.name}
            </span>
            <span
              className="tnum text-[13px] font-semibold"
              style={{ color: entry.alert ? "var(--signal-alert)" : "var(--text-primary)" }}
            >
              {formatMetric(entry.value, { compact: false })}
            </span>
          </li>
        ))}
      </ul>
      {/* Colour is never the only signal: an alerted reading says so in words. */}
      {entries.some((entry) => entry.alert) ? (
        <div className="mt-2 border-t border-line pt-2 text-[11px] font-semibold tracking-wide text-alert">
          Anomalous
        </div>
      ) : null}
      {footer ? <div className="mt-2 border-t border-line pt-2">{footer}</div> : null}
    </div>
  );
}
