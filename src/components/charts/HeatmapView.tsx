"use client";

import { memo, useCallback, useState } from "react";
import type { HeatCell, HeatRow, HeatmapData } from "@/services/charts/shape";
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

/**
 * Fill for one cell, cached by quantised intensity.
 *
 * A full grid is 40 x 96 cells, so this used to build 3,840 `color-mix`
 * strings on every render. 64 steps is finer than the eye resolves in a tint
 * and collapses those to at most 65 distinct strings, which the browser then
 * gets to parse 65 times instead of 3,840.
 */
const SWATCH_STEPS = 64;
const swatches = new Map<number, string>();

function swatch(intensity: number): string {
  const step = Math.round(Math.max(0, Math.min(1, intensity)) * SWATCH_STEPS);
  let colour = swatches.get(step);
  if (colour === undefined) {
    colour = `color-mix(in srgb, ${BASE_COLOR} ${(alpha(step / SWATCH_STEPS) * 100).toFixed(2)}%, transparent)`;
    swatches.set(step, colour);
  }
  return colour;
}

function cellLabel(cell: HeatCell): string {
  return cell.value === null ? "no rows" : formatAxisValue(cell.value);
}

/**
 * One category's row of swatches.
 *
 * Memoised, and that is the whole point of it being a component. Hover state
 * lives in the parent so the readout line can show it, and without this every
 * pointer move re-rendered all 3,840 cells to change one line of text. The row
 * objects are stable for as long as the shaped data is, so a hover now
 * re-renders the readout and nothing else.
 */
const HeatmapRow = memo(function HeatmapRow({
  row,
  onHover,
}: {
  row: HeatRow;
  onHover: (category: string, cell: HeatCell | null) => void;
}) {
  return (
    <tr>
      <th
        scope="row"
        className="sticky left-0 z-10 max-w-[9rem] truncate bg-surface pr-3 text-right text-[12.5px] font-normal text-muted"
        title={row.category}
      >
        {row.category}
      </th>
      {row.cells.map((cell) => (
        <td key={cell.bucket} className="p-[2px]">
          <div
            // A div inside the cell, not the cell itself: a td with a
            // height and a border collapses differently across
            // browsers, and this keeps every swatch the same size.
            className="h-6 w-full min-w-[8px] rounded-[5px]"
            style={{
              backgroundColor: cell.value === null ? "transparent" : swatch(cell.intensity),
              outline: cell.alert ? `1.5px solid ${ALERT_COLOR}` : undefined,
              outlineOffset: "-1.5px",
            }}
            onMouseEnter={() => onHover(row.category, cell)}
            onMouseLeave={() => onHover(row.category, null)}
            title={`${row.category} · ${cell.bucket} · ${cellLabel(cell)}${
              cell.alert && cell.rules.length > 0 ? ` · flagged by ${cell.rules.join(", ")}` : ""
            }`}
          >
            {/*
             * The value as text, not only as a colour and a `title`.
             * A title attribute is announced inconsistently and never
             * reachable by keyboard, so without this the grid carries
             * no data at all for a screen reader.
             */}
            <span className="sr-only">
              {cellLabel(cell)}
              {cell.alert
                ? `, flagged${cell.rules.length > 0 ? ` by ${cell.rules.join(", ")}` : ""}`
                : ""}
            </span>
          </div>
        </td>
      ))}
    </tr>
  );
});

export function HeatmapView({ data, title }: HeatmapViewProps) {
  const [hover, setHover] = useState<{ row: string; cell: HeatCell } | null>(null);

  // Stable, so the memoised rows above actually bail out on a hover.
  const onHover = useCallback((category: string, cell: HeatCell | null) => {
    setHover(cell === null ? null : { row: category, cell });
  }, []);

  if (data.rows.length === 0) {
    return <ChartEmpty label={data.warnings[0] ?? "No rows in range"} />;
  }

  const readout = hover
    ? `${hover.row} · ${hover.cell.bucket} · ${cellLabel(hover.cell)}${
        hover.cell.alert
          ? ` · flagged${hover.cell.rules.length > 0 ? ` by ${hover.cell.rules.join(", ")}` : ""}`
          : ""
      }`
    : null;

  return (
    <div className="flex h-full flex-col px-5 pb-4">
      {/*
       * A fixed-height readout line. Putting the hovered value in a floating
       * tooltip means the pointer covers neighbouring cells - the exact
       * comparison the chart exists to make - so the value is pinned here
       * instead, and the row keeps its height whether or not anything is
       * hovered so the grid below never jumps.
       */}
      <div className="tnum mb-3 h-5 text-[13px] leading-5 text-muted">
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
              <th scope="col" className="sr-only">
                Category
              </th>
              {data.buckets.map((bucket) => (
                // scope="col" is what associates each swatch with its bucket.
                // Without it a screen reader reads the grid as an unlabelled
                // run of numbers, which is the whole content of the chart.
                <th key={bucket} scope="col" className="sr-only">
                  {bucket}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <HeatmapRow key={row.category} row={row} onHover={onHover} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[12.5px] text-muted">
        <span className="tnum">{formatAxisValue(data.min)}</span>
        <span
          aria-hidden="true"
          className="h-2 flex-1 rounded-full"
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
