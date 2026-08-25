"use client";

import { useState } from "react";
import type { HeatCell, HeatmapData } from "@/services/charts/shape";
import { formatAxisValue } from "@/services/format";
import { ChartEmpty } from "./ChartEmpty";
import { ALERT_COLOR, seriesColor } from "./theme";

/**
 * A category against a time bucket, coloured by intensity.
 *
 * Rendered as a CSS grid rather than an SVG chart on purpose. A heatmap is a
 * table of coloured rectangles; recharts would give nothing here except a
 * canvas to fight, while a grid gets real focus order, real hover targets and
 * text that a screen reader can reach. Forty rows by ninety-six columns is
 * under four thousand cells, which the browser lays out without complaint - and
 * the shape function caps both axes precisely so that stays true.
 *
 * Colour carries one variable, so it is one hue at varying strength, not a
 * rainbow ramp. A multi-hue scale reads as categories rather than magnitude and
 * is the standard way this chart lies. Alerts are the exception: a flagged cell
 * is outlined in the alert colour rather than tinted with it, so "this is big"
 * and "this broke a rule" stay separable - a cell can be either, both, or
 * neither, and blending them into one colour makes those four states two.
 */

const BASE_COLOR = seriesColor(0);

/** Faintest a present value may be drawn: below this it reads as an empty cell. */
const MIN_ALPHA = 0.08;

export interface HeatmapViewProps {
  data: HeatmapData;
  /** Chart name, used for the accessible description of the grid. */
  title: string;
}

/**
 * Perceptual, not linear. Transaction volumes are heavily skewed - one busy
 * terminal flattens every other row to the same near-white on a linear ramp -
 * and a square root pulls the low end apart where the detail actually is.
 */
function alpha(intensity: number): number {
  return MIN_ALPHA + Math.sqrt(Math.max(0, Math.min(1, intensity))) * (1 - MIN_ALPHA);
}

export function HeatmapView({ data, title }: HeatmapViewProps) {
  const [hover, setHover] = useState<{ row: string; cell: HeatCell } | null>(null);

  if (data.rows.length === 0) {
    return <ChartEmpty label={data.warnings[0] ?? "No rows in range"} />;
  }

  const readout = hover
    ? `${hover.row} · ${hover.cell.bucket} · ${
        hover.cell.value === null ? "no rows" : formatAxisValue(hover.cell.value)
      }${hover.cell.alert ? " · flagged" : ""}`
    : null;

  return (
    <div className="flex h-full flex-col">
      {/*
       * A fixed-height readout line. Putting the hovered value in a floating
       * tooltip means the pointer covers neighbouring cells - the exact
       * comparison the chart exists to make - so the value is pinned here
       * instead, and the row keeps its height whether or not anything is
       * hovered so the grid below never jumps.
       */}
      <div className="tnum mb-1.5 h-4 text-[11px] leading-4 text-muted">
        {readout ?? (
          <span>
            {data.rows.length} categories · {data.buckets.length} buckets ·{" "}
            {formatAxisValue(data.min)}–{formatAxisValue(data.max)}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table
          className="w-full border-separate border-spacing-0"
          aria-label={`${title}: ${data.rows.length} categories across ${data.buckets.length} buckets`}
        >
          <thead>
            <tr>
              <th className="sr-only">Category</th>
              {data.buckets.map((bucket) => (
                <th key={bucket} className="sr-only">
                  {bucket}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.category}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-[9rem] truncate bg-raised pr-2 text-right text-[11px] font-normal text-muted"
                  title={row.category}
                >
                  {row.category}
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.bucket} className="p-[1px]">
                    <div
                      // A div inside the cell, not the cell itself: a td with a
                      // height and a border collapses differently across
                      // browsers, and this keeps every swatch the same size.
                      className="h-4 w-full min-w-[8px]"
                      style={{
                        backgroundColor:
                          cell.value === null
                            ? "transparent"
                            : `color-mix(in srgb, ${BASE_COLOR} ${alpha(cell.intensity) * 100}%, transparent)`,
                        outline: cell.alert ? `1.5px solid ${ALERT_COLOR}` : undefined,
                        outlineOffset: "-1.5px",
                      }}
                      onMouseEnter={() => setHover({ row: row.category, cell })}
                      onMouseLeave={() => setHover(null)}
                      title={`${row.category} · ${cell.bucket} · ${
                        cell.value === null ? "no rows" : formatAxisValue(cell.value)
                      }`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
        <span className="tnum">{formatAxisValue(data.min)}</span>
        <span
          aria-hidden="true"
          className="h-2 flex-1"
          style={{
            background: `linear-gradient(to right, color-mix(in srgb, ${BASE_COLOR} ${
              MIN_ALPHA * 100
            }%, transparent), ${BASE_COLOR})`,
          }}
        />
        <span className="tnum">{formatAxisValue(data.max)}</span>
        {data.hasAlerts && (
          <span className="ml-1 flex items-center gap-1">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5"
              style={{ outline: `1.5px solid ${ALERT_COLOR}`, outlineOffset: "-1.5px" }}
            />
            flagged
          </span>
        )}
      </div>
    </div>
  );
}
