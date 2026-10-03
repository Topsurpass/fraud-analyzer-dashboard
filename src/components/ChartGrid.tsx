"use client";

import type { ChartType } from "@/contracts/api";
import { FlagOrderProvider, useOrderedGrid } from "./FlagOrder";

/**
 * The card grid.
 *
 * Aligned rows rather than a masonry flow, so cards line up across columns and
 * the grid reads as an instrument panel rather than a feed. External gaps stay
 * tight; the padding lives inside each card.
 *
 * Three columns up to a 1920px screen rather than four. At four, a card on a
 * 1600px screen is about 325px wide, which is not enough for a plot plus its
 * legend - the axis labels start colliding and the legend wraps to three lines.
 * Fewer, wider cards read better than more, narrower ones.
 *
 * Past that the page has room for more of them, so columns are added at the
 * widths where a card stays about 430px or wider (4 from 2100px, 5 from 2900px,
 * 6 from 3600px, measured with the sidebar open). They are written in
 * `globals.css` (`.chart-grid`) and not as utilities here: Tailwind orders its
 * `min-[...]` variants before `xl:`, so `xl:grid-cols-3` won every tie. Capping
 * the page instead left empty bands on both sides, doubling when the sidebar
 * collapsed.
 */
export function ChartGrid({ children }: { children: React.ReactNode }) {
  return (
    <FlagOrderProvider>
      <OrderedGrid>{children}</OrderedGrid>
    </FlagOrderProvider>
  );
}

/**
 * The grid itself. Cards that report flagged rows are sorted to the front (see
 * `FlagOrder.tsx`); a card that has not reported, or is not flagged, keeps the
 * place the page gave it.
 */
function OrderedGrid({ children }: { children: React.ReactNode }) {
  const { containerRef, children: ordered } = useOrderedGrid(children);
  return (
    <div
      ref={containerRef}
      // `minmax(0,1fr)` rather than the default `1fr`: an auto-sized track lets
      // a wide child push the whole grid past the viewport on a phone.
      className="chart-grid grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 xl:grid-cols-3"
      /*
       * A fixed row height, not `minmax(row, 1fr)`. The 1fr version was an
       * attempt to fill a short page and it does the opposite of what it looks
       * like on paper: every row takes an equal share of the container, so
       * three cards on a tall screen each become 900px of mostly empty card.
       * Cards keep their size and a short page stays short.
       */
      style={{ gridAutoRows: `${ROW_HEIGHT_REM}rem` }}
    >
      {ordered}
    </div>
  );
}

const ROW_HEIGHT_REM = 7;

/**
 * Rows a chart type occupies by default. A number readout needs less height
 * than a plot but not half as much: the card header plus its footer strip (title,
 * description, status line) is about 120px, so two rows is the floor at
 * which the figure itself still fits without clipping.
 */
export function chartRowSpan(type: ChartType): number {
  if (type === "table") return 4;
  return type === "number" ? 2 : 3;
}

/**
 * Grid footprint for a card. `expanded` gives it more room without leaving the
 * page; the default is unchanged.
 *
 * These are hand-written classes in `globals.css`, not Tailwind utilities,
 * because the choice is made from data at runtime.
 */
export function chartCellClass(type: ChartType, expanded = false): string {
  if (expanded) return "card-cell-expanded";
  // A table is wide by nature and needs rows to be worth scanning: a toolbar
  // and three data rows in a one-column card is a preview, not a table.
  if (type === "table") return "card-cell-table";
  return type === "number" ? "card-cell-number" : "card-cell";
}

/** Footprint for a placeholder whose chart type is not known yet. */
export const PENDING_CELL_CLASS = "card-cell-pending";
