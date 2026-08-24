"use client";

import type { TableData } from "@/services/charts/shape";
import { formatCell } from "@/services/format";

/**
 * The raw result view - the one an analyst opens a case from, so it shows the
 * data verbatim: no compaction, no rounding, NULL spelled out.
 *
 * Rows the anomaly pass flagged get a left rule and a marker glyph; the glyph is
 * what carries the meaning without colour.
 *
 * Two things this deliberately does not do. It does not tint the row's
 * background - at 50 flagged rows that turned the whole card into a red block
 * and made the values inside it harder to read, which is the opposite of what
 * marking them was for. And when *every* row is flagged it marks none of them:
 * a flag that is true for the whole result set separates nothing inside that
 * result, so the honest place to say it is once, in the footer.
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
  if (data.columns.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[12px] text-muted">
        The query returned no columns.
      </p>
    );
  }

  const alertCount = data.alerts.filter(Boolean).length;
  // A flag every row shares carries no information *within* this result.
  const discriminating = alertCount > 0 && alertCount < data.rows.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <caption className="sr-only">
            {title}
            {alertCount > 0
              ? discriminating
                ? `, ${alertCount} flagged rows`
                : ", every row flagged"
              : ""}
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
              const flagged = discriminating && data.alerts[rowIndex] === true;
              // Naming the rule is the point of writing one: "Flagged row"
              // tells an analyst nothing they cannot already see from the mark.
              const caught = data.alertRuleNames?.[rowIndex] ?? [];
              const why = flagged
                ? caught.length > 0
                  ? `Flagged by ${caught.join(", ")}`
                  : "Flagged row"
                : undefined;
              return (
                <tr key={rowIndex} className={flagged ? "text-ink" : undefined}>
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
          </tbody>
        </table>

        {data.rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-muted">No rows returned.</p>
        ) : null}
      </div>

      {alertCount > 0 ? (
        <p className="border-t border-line px-3 py-1.5 text-[10px] text-muted">
          {discriminating ? (
            <>
              <span className="text-alert">{alertCount}</span> flagged{" "}
              {alertCount === 1 ? "row" : "rows"}
            </>
          ) : (
            // Every row: worth knowing, not worth marking 50 times.
            <>
              <span className="text-alert">every</span> row flagged
            </>
          )}
          {data.alertReason === "flag-rule"
            ? ` by ${ruleSummary(data)}`
            : data.alertSource
              ? ` by ${data.alertSource}`
              : ""}
        </p>
      ) : null}
    </div>
  );
}
