"use client";

import { useState } from "react";
import type { ComparePanel, CompareGridData } from "@/services/charts/shape";
import { panelSegments } from "@/services/charts/shape";
import { formatAxisValue } from "@/services/format";
import { ChartEmpty } from "./ChartEmpty";
import { ALERT_COLOR, OTHER_COLOR, seriesColor } from "./theme";

/**
 * One two-window panel per category, laid out as small multiples.
 *
 * `compare` shows the shape of everything at once, so a terminal that
 * quadrupled while another went dark reads as flat. `movers` shows two totals
 * per terminal, so a terminal moving the same volume at a completely different
 * hour reads as unchanged. This shows the shape *per* terminal - the only one
 * of the three where a change of rhythm is visible at all.
 *
 * Drawn as inline SVG rather than a charting library. Twenty-four recharts
 * instances mount twenty-four responsive containers and twenty-four resize
 * observers to draw two polylines each; at this size a `viewBox` and a
 * `points` string do the same job for a fraction of the work, and the geometry
 * becomes a pure function that the gate lane can actually assert on.
 */

const CURRENT_COLOR = seriesColor(0);
const PREVIOUS_COLOR = OTHER_COLOR;

/** Panel viewBox. Aspect matters, absolute size does not - the CSS scales it. */
const PANEL_W = 100;
const PANEL_H = 26;

export interface CompareGridViewProps {
  data: CompareGridData;
  /** Chart name, used for the accessible description of the grid. */
  title: string;
}

function windowLabel(span: [string, string] | null): string {
  if (!span) return "";
  return span[0] === span[1] ? span[0] : `${span[0]}–${span[1]}`;
}

function changeText(panel: ComparePanel): string {
  if (panel.pctChange === null) {
    return panel.currentTotal === 0 ? "no activity" : "new";
  }
  const pct = Math.abs(panel.pctChange) * 100;
  if (pct < 0.05) return "flat";
  const rounded = pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${panel.pctChange > 0 ? "+" : "−"}${rounded}%`;
}

function Panel({ panel, hint }: { panel: ComparePanel; hint: string }) {
  const previous = panelSegments(
    panel.points.map((point) => point.previous),
    PANEL_W,
    PANEL_H,
    panel.peak,
  );
  const current = panelSegments(
    panel.points.map((point) => point.current),
    PANEL_W,
    PANEL_H,
    panel.peak,
  );

  const step = panel.points.length > 1 ? PANEL_W / (panel.points.length - 1) : 0;
  const flagged = panel.points
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => point.alert && point.current !== null);

  const direction = panel.delta > 0 ? "↑" : panel.delta < 0 ? "↓" : "·";

  return (
    <li className="border border-line/60 px-2 py-1.5">
      <div className="flex items-baseline justify-between gap-1">
        <span className="flex min-w-0 items-center gap-1">
          {panel.alert && (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: ALERT_COLOR }}
            />
          )}
          <span className="truncate text-[11px] text-strong" title={panel.category}>
            {panel.category}
          </span>
        </span>
        {/* Direction as a glyph and a sign, so it never rests on colour. */}
        <span className="tnum shrink-0 text-[10px] text-muted">
          <span aria-hidden="true">{direction} </span>
          {changeText(panel)}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${PANEL_W} ${PANEL_H}`}
        // The box is a fixed aspect the CSS stretches; preserveAspectRatio
        // "none" is what lets it fill a narrow column without letterboxing.
        preserveAspectRatio="none"
        className="mt-1 h-8 w-full"
        role="img"
        aria-label={hint}
      >
        {previous.map((points, index) => (
          <polyline
            key={`p${index}`}
            points={points}
            fill="none"
            stroke={PREVIOUS_COLOR}
            strokeWidth={1}
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {current.map((points, index) => (
          <polyline
            key={`c${index}`}
            points={points}
            fill="none"
            stroke={CURRENT_COLOR}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {flagged.map(({ point, index }) => (
          <circle
            key={`a${index}`}
            cx={panel.points.length > 1 ? index * step : PANEL_W / 2}
            cy={PANEL_H - (Math.max(0, point.current ?? 0) / (panel.peak || 1)) * PANEL_H}
            r={2}
            fill={ALERT_COLOR}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div className="tnum mt-0.5 flex items-baseline justify-between gap-1 text-[10px] text-muted">
        <span>
          <span className="sr-only">previous total </span>
          {formatAxisValue(panel.previousTotal)}
          <span aria-hidden="true"> → </span>
          <span className="sr-only">current total </span>
          <span className="text-strong">{formatAxisValue(panel.currentTotal)}</span>
        </span>
        {/*
         * Each panel is scaled to its own peak, so the peak has to be printed:
         * without it two panels of identical height can be a hundredfold apart
         * and nothing on screen would say so.
         */}
        <span title="Highest single bucket in this panel">
          <span className="sr-only">peak </span>
          {formatAxisValue(panel.peak)}
        </span>
      </div>
    </li>
  );
}

export function CompareGridView({ data, title }: CompareGridViewProps) {
  const [expanded, setExpanded] = useState(false);

  if (data.panels.length === 0) {
    return <ChartEmpty label={data.warnings[0] ?? "No rows in range"} />;
  }

  const previous = windowLabel(data.previousSpan) || "previous";
  const current = windowLabel(data.currentSpan) || "current";
  const rising = data.panels.filter((panel) => panel.delta > 0).length;
  const falling = data.panels.filter((panel) => panel.delta < 0).length;

  // A card shows the movers that matter; the rest are a click away rather than
  // a scroll through twenty quiet panels.
  const VISIBLE = 8;
  const shown = expanded ? data.panels : data.panels.slice(0, VISIBLE);
  const hidden = data.panels.length - shown.length;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-0 w-3 border-t border-dashed"
            style={{ borderColor: PREVIOUS_COLOR }}
          />
          {previous}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-0 w-3 border-t-2"
            style={{ borderColor: CURRENT_COLOR }}
          />
          {current}
        </span>
        <span>{`${rising} up · ${falling} down`}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <ul
          className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))]"
          aria-label={`${title}: ${current} against ${previous}, one panel per category, biggest movers first`}
        >
          {shown.map((panel) => (
            <Panel
              key={panel.category}
              panel={panel}
              hint={`${panel.category}: ${formatAxisValue(panel.previousTotal)} in ${previous}, ${formatAxisValue(panel.currentTotal)} in ${current}, ${changeText(panel)}`}
            />
          ))}
        </ul>

        {(hidden > 0 || expanded) && (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className="mt-1.5 text-[11px] text-muted underline decoration-dotted underline-offset-2 hover:text-strong"
          >
            {expanded ? "Show fewer" : `Show ${hidden} quieter`}
          </button>
        )}
      </div>
    </div>
  );
}
