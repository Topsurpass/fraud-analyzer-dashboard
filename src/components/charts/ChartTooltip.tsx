"use client";

import type { ReactNode } from "react";
import type { FlagSeverity } from "@/contracts/api";
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
  /** Which rules flagged this reading. Named in the tooltip so the chart explains itself. */
  flag?: { rules: string[]; severity: FlagSeverity | null };
}

export interface ChartTooltipProps {
  label: ReactNode;
  entries: TooltipEntry[];
  /** Rendered under the entries, e.g. a share-of-total line for pie slices. */
  footer?: ReactNode;
}

export function ChartTooltip({ label, entries, footer }: ChartTooltipProps) {
  if (entries.length === 0) return null;
  const summary = flagSummary(entries);

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
      {/* Colour is never the only signal: a flagged reading says so in words,
          and names the rule that caught it. */}
      {entries.some((entry) => entry.alert) ? (
        <div className="mt-2 space-y-1 border-t border-line pt-2">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-alert">
            <FlagGlyph />
            Flagged
            {/* The worst severity across the rules, once. Severity belongs to
                the mark, not to each rule, so a per-rule badge would label a
                mild rule with its neighbour's severity. */}
            {summary.severity ? (
              <span className="ml-auto rounded-md bg-alert/10 px-1.5 py-px text-[11px] capitalize">
                {summary.severity}
              </span>
            ) : null}
          </div>
          {summary.rules.map((rule) => (
            <div key={rule} className="truncate text-[12px] text-secondary">
              {rule}
            </div>
          ))}
        </div>
      ) : null}
      {footer ?<div className="mt-2 border-t border-line pt-2">{footer}</div> : null}
    </div>
  );
}

/** Distinct rule names across the entries and the worst severity among them. */
function flagSummary(entries: TooltipEntry[]): { rules: string[]; severity: FlagSeverity | null } {
  const rank = { low: 1, medium: 2, high: 3 } as const;
  const rules = new Set<string>();
  let severity: FlagSeverity | null = null;
  for (const entry of entries) {
    if (!entry.flag) continue;
    for (const rule of entry.flag.rules) rules.add(rule);
    const next = entry.flag.severity;
    if (next !== null && (severity === null || rank[next] > rank[severity])) severity = next;
  }
  return { rules: [...rules], severity };
}

function FlagGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M3 11V1.5M3 2h6.2l-1.4 2.4L9.2 6.8H3"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
