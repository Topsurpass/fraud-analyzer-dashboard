import type { ChartType } from "@/contracts/api";

/**
 * The card grid.
 *
 * Aligned rows rather than a masonry flow, so cards line up across columns and
 * the grid reads as an instrument panel rather than a feed. External gaps stay
 * tight; the padding lives inside each card.
 *
 * Three columns at the top end rather than four. At four, a card on a 1600px
 * screen is about 325px wide, which is not enough for a plot plus its legend -
 * the axis labels start colliding and the legend wraps to three lines. Fewer,
 * wider cards read better than more, narrower ones.
 */
export function ChartGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      // `minmax(0,1fr)` rather than the default `1fr`: an auto-sized track lets
      // a wide child push the whole grid past the viewport on a phone.
      className="chart-grid grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 xl:grid-cols-3"
      /*
       * A fixed row height, not `minmax(row, 1fr)`. The 1fr version was an
       * attempt to fill a short page and it does the opposite of what it looks
       * like on paper: every row takes an equal share of the container, so
       * three cards on a tall screen each become 900px of mostly empty card.
       * Cards keep their size and a short page stays short.
       */
      style={{ gridAutoRows: `${ROW_HEIGHT_REM}rem` }}
    >
      {children}
    </div>
  );
}

const ROW_HEIGHT_REM = 6.5;

/**
 * Rows a chart type occupies by default. A number readout needs less height
 * than a plot but not half as much: the card header alone (title, description,
 * pulse line and status strip) is about 100px, so two rows is the floor at
 * which the figure itself still fits without clipping.
 */
export function chartRowSpan(type: ChartType): number {
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
  return type === "number" ? "card-cell-number" : "card-cell";
}

/** Footprint for a placeholder whose chart type is not known yet. */
export const PENDING_CELL_CLASS = "card-cell-pending";
