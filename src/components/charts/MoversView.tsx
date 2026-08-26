"use client";

import type { MoversData } from "@/services/charts/shape";
import { formatAxisValue } from "@/services/format";
import { ChartEmpty } from "./ChartEmpty";
import { ChangeBadge } from "./ChangeBadge";
import { ALERT_COLOR, OTHER_COLOR, seriesColor } from "./theme";

/**
 * Two windows totalled per category, one row each, ranked by how far they moved.
 *
 * Drawn as a dumbbell: a hollow mark for the previous window, a filled mark for
 * the current one, joined by a segment. The segment's *length is the change* -
 * which is the whole point, because it makes "moved a lot" a physical property
 * of the row rather than something the reader computes from two numbers. Rows
 * are pre-sorted by that length, so the chart is scanned from the top and the
 * scan can stop as soon as the segments get short.
 *
 * Two paired bars would encode the same numbers and read worse: the eye has to
 * measure two lengths and subtract them, which is exactly the arithmetic this
 * chart exists to remove.
 *
 * Direction is never carried by colour alone. An arrow and a signed number do
 * that work, so the row still reads under any colour vision - and it leaves the
 * alert colour free to mean only "a rule matched", which is what it means
 * everywhere else in the app.
 */

const CURRENT_COLOR = seriesColor(0);
const PREVIOUS_COLOR = OTHER_COLOR;

export interface MoversViewProps {
  data: MoversData;
  /** Chart name, used for the accessible description of the list. */
  title: string;
}

function windowLabel(span: [string, string] | null): string {
  if (!span) return "";
  return span[0] === span[1] ? span[0] : `${span[0]}–${span[1]}`;
}

export function MoversView({ data, title }: MoversViewProps) {
  if (data.rows.length === 0) {
    return <ChartEmpty label={data.warnings[0] ?? "No rows in range"} />;
  }

  // A zero scale would divide by zero below; every mark sits at the origin.
  const scale = data.scaleMax > 0 ? data.scaleMax : 1;
  const position = (value: number) => `${Math.max(0, Math.min(1, value / scale)) * 100}%`;

  const totalDelta = data.currentTotal - data.previousTotal;
  const rising = data.rows.filter((row) => row.delta > 0).length;
  const falling = data.rows.filter((row) => row.delta < 0).length;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="tnum text-lg leading-none text-strong">
          {formatAxisValue(data.currentTotal)}
        </span>
        <span>
          vs <span className="tnum">{formatAxisValue(data.previousTotal)}</span> previous
        </span>
        <span className="tnum">
          {totalDelta >= 0 ? "+" : "−"}
          {formatAxisValue(Math.abs(totalDelta))}
        </span>
        <span>{`${rising} up · ${falling} down`}</span>
      </div>

      {/*
       * Which buckets each window covers. Without this the reader knows one
       * window is "previous" but not previous to what, and two windows of
       * unstated length are two numbers they cannot act on.
       */}
      <div className="mb-1.5 flex items-center gap-3 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full border"
            style={{ borderColor: PREVIOUS_COLOR }}
          />
          {windowLabel(data.previousSpan) || "previous"}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: CURRENT_COLOR }}
          />
          {windowLabel(data.currentSpan) || "current"}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table
          className="w-full border-separate border-spacing-0"
          aria-label={`${title}: ${data.rows.length} categories, ${rising} up and ${falling} down against the previous window`}
        >
          <thead className="sr-only">
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Previous</th>
              <th scope="col">Current</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const lo = Math.min(row.previous, row.current);
              const hi = Math.max(row.previous, row.current);
              return (
                <tr key={row.category} className="align-middle">
                  <th
                    scope="row"
                    className="max-w-[8rem] truncate py-[3px] pr-2 text-right text-[11px] font-normal text-muted"
                    title={row.category}
                  >
                    {row.alert && (
                      <span
                        aria-hidden="true"
                        className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                        style={{ backgroundColor: ALERT_COLOR }}
                      />
                    )}
                    {row.category}
                    {row.alert && <span className="sr-only"> (flagged)</span>}
                  </th>

                  <td className="w-full py-[3px]">
                    <div className="relative h-3">
                      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line/50" />
                      {/* The segment between the two marks: its length is the change. */}
                      <div
                        className="absolute top-1/2 h-[2px] -translate-y-1/2"
                        style={{
                          left: position(lo),
                          width: `calc(${position(hi)} - ${position(lo)})`,
                          backgroundColor: CURRENT_COLOR,
                          opacity: 0.45,
                        }}
                      />
                      <span
                        aria-hidden="true"
                        className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-raised"
                        style={{ left: position(row.previous), borderColor: PREVIOUS_COLOR }}
                      />
                      <span
                        aria-hidden="true"
                        className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                        style={{
                          left: position(row.current),
                          backgroundColor: CURRENT_COLOR,
                        }}
                      />
                    </div>
                  </td>

                  <td className="tnum whitespace-nowrap py-[3px] pl-2 text-right text-[11px] text-strong">
                    {formatAxisValue(row.current)}
                  </td>
                  <td className="whitespace-nowrap py-[3px] pl-2 text-right">
                    <span className="sr-only">from {formatAxisValue(row.previous)}, </span>
                    {/*
                     * One badge component across every chart, so "this moved
                     * enough to look at" cannot come to mean different things
                     * on different cards.
                     */}
                    <ChangeBadge verdict={row.verdict} subject={row.category} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
