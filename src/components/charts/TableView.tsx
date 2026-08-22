"use client";

import type { TableData } from "@/services/charts/shape";
import { formatCell } from "@/services/format";

/**
 * The raw result view - the one an analyst opens a case from, so it shows the
 * data verbatim: no compaction, no rounding, NULL spelled out.
 *
 * Rows the anomaly pass flagged get the alert colour, a left rule and a marker
 * glyph. The glyph is what carries the meaning without colour.
 */
export interface TableViewProps {
  data: TableData;
  title: string;
}

export function TableView({ data, title }: TableViewProps) {
  if (data.columns.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[12px] text-muted">
        The query returned no columns.
      </p>
    );
  }

  const alertCount = data.alerts.filter(Boolean).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <caption className="sr-only">
            {title}
            {alertCount > 0 ? `, ${alertCount} flagged rows` : ""}
          </caption>
          <thead className="sticky top-0 z-10 bg-sunken">
            <tr>
              {/* Marker gutter, kept in the header so columns stay aligned. */}
              <th scope="col" className="w-5 border-b border-line p-0">
                <span className="sr-only">Flagged</span>
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
            {data.rows.map((row, rowIndex) => {
              const flagged = data.alerts[rowIndex] === true;
              return (
                <tr
                  key={rowIndex}
                  className={flagged ? "bg-[var(--signal-alert-dim)]" : undefined}
                >
                  <td className="p-0 align-middle">
                    {flagged ? (
                      <span
                        className="block h-full w-[3px] bg-alert"
                        // The row is already announced as flagged by the cell title.
                        aria-hidden="true"
                      />
                    ) : null}
                  </td>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      title={flagged && cellIndex === 0 ? "Flagged row" : undefined}
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
          {data.alertSource ? ` by ${data.alertSource}` : ""}
        </p>
      ) : null}
    </div>
  );
}
