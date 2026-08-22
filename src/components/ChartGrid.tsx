import type { CSSProperties } from "react";
import type { ChartType } from "@/contracts/api";

/**
 * The card grid.
 *
 * Fixed-height rows rather than a masonry flow, so cards line up across columns
 * and the grid reads as an instrument panel rather than a feed. External gaps
 * stay tight; the padding lives inside each card.
 */
export function ChartGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      // `minmax(0,1fr)` rather than the default `1fr`: an auto-sized track lets
      // a wide child push the whole grid past the viewport on a phone.
      className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
      style={{ gridAutoRows: `${ROW_HEIGHT_REM}rem` }}
    >
      {children}
    </div>
  );
}

const ROW_HEIGHT_REM = 6.5;

/**
 * Rows a chart type occupies. A number readout needs less height than a plot
 * but not half as much: the card header alone (title, description, pulse line
 * and status strip) is about 100px, so two rows is the floor at which the
 * figure itself still fits without clipping.
 */
export function chartRowSpan(type: ChartType): number {
  return type === "number" ? 2 : 3;
}

/**
 * Applied as an inline style rather than a `row-span-*` utility on purpose.
 * The span is derived from data, and a class name assembled at runtime is not
 * guaranteed to survive Tailwind's source scanning - a missing `row-span-3`
 * silently collapses every chart card to a single row.
 */
export function chartCellStyle(type: ChartType): CSSProperties {
  return { gridRow: `span ${chartRowSpan(type)}` };
}
