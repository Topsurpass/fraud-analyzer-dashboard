"use client";

import { useMemo, useRef } from "react";
import type { TableData } from "@/services/charts/shape";
import { formatCell } from "@/services/format";
import { useVirtualRows } from "@/lib/useVirtualRows";

/** Fixed row height, in pixels. The virtualiser needs one number it can trust,
 *  and every cell in this table is a single line by design. */
const ROW_HEIGHT = 30;

/** Below this, windowing costs more than it saves. */
const VIRTUALISE_ABOVE = 80;

/**
 * The raw result view - the one an analyst opens a case from, so it shows the
 * data verbatim: no compaction, no rounding, NULL spelled out.
 *
 * Rows a flag rule matched get a left rule and a marker dot; the dot is what
 * carries the meaning without colour.
 *
 * One thing this deliberately does not do: tint the row background. At 50
 * flagged rows that turned the whole card into a red block and made the values
 * inside it harder to read, which is the opposite of what marking them was for.
 *
 * It used to suppress every mark when *all* rows were flagged, on the grounds
 * that a flag true for the whole result separates nothing within it. That was
 * right while flags could be guessed from a column name. Now a flag only ever
 * comes from a rule the analyst wrote, and hiding every mark on a rule that
 * matches everything reads as the rule having failed to save.
 */
/** Distinct rule names that caught anything, in first-seen order. */
function ruleSummary(data: TableData): string {
  const seen: string[] = [];
  for (const names of data.alertRuleNames ?? []) {
    for (const name of names) if (!seen.includes(name)) seen.push(name);
  }
  if (seen.length === 0) return "your rules";
  if (seen.length <= 2) return seen.join(" and ");
  return `${seen.slice(0, 2).join(", ")} and ${seen.length - 2} more`;
}

export interface TableViewProps {
  data: TableData;
  title: string;
}

export function TableView({ data, title }: TableViewProps) {
  // Every hook runs before the empty-columns return below. React identifies
  // hooks by call order, so returning early above them would change that order
  // the first time a query came back with no columns.
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // filter().length walks every row on every render; a poll re-renders this
  // several times a second and the answer only changes when the data does.
  const alertCount = useMemo(
    () => data.alerts.reduce((total, flagged) => (flagged ? total + 1 : total), 0),
    [data.alerts],
  );

  const virtualise = data.rows.length > VIRTUALISE_ABOVE;
  const rowWindow = useVirtualRows(
    scrollRef,
    virtualise ? data.rows.length : 0,
    ROW_HEIGHT,
  );
  const first = virtualise ? rowWindow.start : 0;
  const last = virtualise ? rowWindow.end : data.rows.length;

  if (data.columns.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[12.5px] text-muted">
        The query returned no columns.
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* `tabIndex` because this scrolls: a region a mouse can scroll and a
          keyboard cannot is unreachable content, not a styling detail. */}
      <div ref={scrollRef} tabIndex={0} className="min-h-0 flex-1 overflow-auto">
        <table className="data-dense w-full border-collapse">
          <caption className="sr-only">
            {title}
            {alertCount > 0 ? `, ${alertCount} flagged rows` : ""}
          </caption>
          <thead className="sticky top-0 z-10 bg-sunken">
            <tr>
              {/* Marker gutter, kept in the header so columns stay aligned. */}
              <th
                scope="col"
                className="w-8 border-b border-line px-1.5 py-1.5 text-left text-[10px] font-medium tracking-wide text-muted uppercase"
              >
                {alertCount > 0 ? "!" : <span className="sr-only">Flagged</span>}
              </th>
              {data.columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={`border-b border-line px-2.5 py-1.5 text-[10px] font-medium tracking-wide whitespace-nowrap text-muted uppercase ${
                    data.numericColumns[index] ? "text-right" : "text-left"
                  }`}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Spacers stand in for the rows above and below the window, so the
                scrollbar describes the whole result rather than the slice that
                happens to be rendered. */}
            {virtualise && rowWindow.padTop > 0 ? (
              <tr aria-hidden="true" style={{ height: rowWindow.padTop }} />
            ) : null}
            {data.rows.slice(first, last).map((row, offset) => {
              const rowIndex = first + offset;
              const flagged = data.alerts[rowIndex] === true;
              // Naming the rule is the point of writing one: "Flagged row"
              // tells an analyst nothing they cannot already see from the mark.
              const caught = data.alertRuleNames?.[rowIndex] ?? [];
              const why = flagged
                ? caught.length > 0
                  ? `Flagged by ${caught.join(", ")}`
                  : "Flagged row"
                : undefined;
              return (
                <tr
                  key={rowIndex}
                  style={{ height: ROW_HEIGHT }}
                  className={`transition-colors hover:bg-raised/60 ${
                    flagged ? "bg-alert/[0.04] text-ink" : ""
                  }`}
                >
                  <td
                    title={why}
                    className={`border-b border-line/60 px-1.5 py-1.5 align-middle ${
                      flagged ? "border-l-2 border-l-alert" : ""
                    }`}
                  >
                    {flagged ? (
                      <>
                        {/* A dot with real dimensions. The previous marker was
                            a `block h-full` span, and a span in a table cell
                            has no height to fill, so it painted nothing. */}
                        <span
                          className="inline-block h-2 w-2 rounded-full bg-alert align-middle"
                          aria-hidden="true"
                        />
                        {/* Colour alone is not a signal. */}
                        <span className="sr-only">{why}</span>
                      </>
                    ) : null}
                  </td>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      title={cellIndex === 0 ? why : undefined}
                      className={`tnum border-b border-line/60 px-2.5 py-1.5 whitespace-nowrap ${
                        data.numericColumns[cellIndex] ? "text-right" : "text-left"
                      } ${cell === null ? "text-muted italic" : ""} ${
                        flagged ? "text-ink" : ""
                      }`}
                    >
                      {formatCell(cell)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {virtualise && rowWindow.padBottom > 0 ? (
              <tr aria-hidden="true" style={{ height: rowWindow.padBottom }} />
            ) : null}
          </tbody>
        </table>

        {data.rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-muted">No rows returned.</p>
        ) : null}
      </div>

      {alertCount > 0 ? (
        <p className="border-t border-line px-3 py-1.5 text-[10px] text-muted">
          <span className="text-alert">{alertCount}</span> flagged{" "}
          {alertCount === 1 ? "row" : "rows"}
          {` by ${ruleSummary(data)}`}
        </p>
      ) : null}
    </div>
  );
}
