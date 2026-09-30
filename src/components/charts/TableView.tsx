"use client";

import { useMemo, useRef, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type FilterFn,
  type SortingFn,
  type SortingState,
} from "@tanstack/react-table";
import type { Cell } from "@/contracts/api";
import type { TableData } from "@/services/charts/shape";
import { formatCell, humanizeColumn } from "@/services/format";
import { useVirtualRows } from "@/lib/useVirtualRows";

/** Fixed row height, in pixels. The virtualiser needs one number it can trust,
 *  and every cell in this table is a single line by design. */
const ROW_HEIGHT = 44;

/** Below this, windowing costs more than it saves. */
const VIRTUALISE_ABOVE = 80;

/** A toolbar on a five-row table is noise; search earns its place past this. */
const TOOLBAR_FROM_ROWS = 8;

/**
 * The raw result view - the one an analyst opens a case from, so it shows the
 * data verbatim: no compaction, no rounding, NULL spelled out.
 *
 * Built on TanStack Table for sorting and filtering; rendering stays ours so
 * the windowing (10,000 rows is 10,000 `<tr>` otherwise) and every
 * accessibility contract below are unchanged. Sorting, search and the
 * flagged-only filter all run over the rows the table already holds, in the
 * browser - nothing here re-queries.
 *
 * Rows a flag rule matched get a left rule and a marker dot; the dot is what
 * carries the meaning without colour. The row background is deliberately only
 * a faint wash: at 50 flagged rows a strong tint turned the whole card into a
 * red block and made the values inside it harder to read.
 *
 * A flag only ever comes from a rule the analyst wrote, so marks are shown
 * even when a rule matches every row - hiding them would read as the rule
 * having failed to save.
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

/** One result row with what the view needs to know about it. */
interface RecordRow {
  cells: Cell[];
  /** Position in the engine's result: what the flag arrays are indexed by. */
  index: number;
  flagged: boolean;
  /** "Flagged by X" when the rule is known, for hover and screen readers. */
  why: string | undefined;
}

/** Numbers as numbers, everything else as natural-order text. */
function compareCells(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

const sortCells: SortingFn<RecordRow> = (rowA, rowB, columnId) =>
  compareCells(rowA.getValue(columnId), rowB.getValue(columnId));

/** Search matches any visible cell, case-insensitively, on what is displayed. */
const matchesSearch: FilterFn<RecordRow> = (row, _columnId, filterValue: string) => {
  const needle = filterValue.trim().toLowerCase();
  if (needle === "") return true;
  return row.original.cells.some((cell) => formatCell(cell).toLowerCase().includes(needle));
};

/**
 * Words that mean an outcome, shown as a badge rather than bare text. A fixed
 * vocabulary, matched whole-word on the whole cell: the app cannot know what a
 * schema's strings mean, so it only dresses the ones everyone agrees on.
 */
const STATUS_TONE: Record<string, "good" | "wait" | "neutral"> = {
  approved: "good",
  success: "good",
  succeeded: "good",
  completed: "good",
  paid: "good",
  cleared: "good",
  active: "good",
  pending: "wait",
  review: "wait",
  "in review": "wait",
  processing: "wait",
  held: "wait",
  declined: "neutral",
  blocked: "neutral",
  rejected: "neutral",
  failed: "neutral",
  refunded: "neutral",
  disputed: "neutral",
  reversed: "neutral",
  inactive: "neutral",
};

const TONE_CLASS = {
  good: "bg-live/12 text-live",
  wait: "bg-change/12 text-change",
  neutral: "bg-raised text-secondary",
} as const;

function statusTone(cell: Cell): keyof typeof TONE_CLASS | null {
  if (typeof cell !== "string") return null;
  return STATUS_TONE[cell.trim().toLowerCase()] ?? null;
}

const columnHelper = createColumnHelper<RecordRow>();

export interface TableViewProps {
  data: TableData;
  title: string;
}

export function TableView({ data, title }: TableViewProps) {
  // Every hook runs before the empty-columns return below. React identifies
  // hooks by call order, so returning early above them would change that order
  // the first time a query came back with no columns.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  // filter().length walks every row on every render; a poll re-renders this
  // several times a second and the answer only changes when the data does.
  const alertCount = useMemo(
    () => data.alerts.reduce((total, flagged) => (flagged ? total + 1 : total), 0),
    [data.alerts],
  );

  // Walks every row's rule list with an `includes` per name, and the answer
  // only moves when the flags do - not on every poll-driven re-render.
  const rules = useMemo(() => ruleSummary(data), [data]);

  const records = useMemo<RecordRow[]>(
    () =>
      data.rows.map((cells, index) => {
        const flagged = data.alerts[index] === true;
        // Naming the rule is the point of writing one: "Flagged row" tells an
        // analyst nothing they cannot already see from the mark.
        const caught = data.alertRuleNames?.[index] ?? [];
        return {
          cells,
          index,
          flagged,
          why: flagged
            ? caught.length > 0
              ? `Flagged by ${caught.join(", ")}`
              : "Flagged row"
            : undefined,
        };
      }),
    [data.rows, data.alerts, data.alertRuleNames],
  );

  const columns = useMemo(
    () =>
      data.columns.map((name, columnIndex) =>
        columnHelper.accessor(
          // null becomes undefined so `sortUndefined: "last"` keeps NULLs at the
          // bottom in both directions, which is where an analyst wants them.
          (row) => row.cells[columnIndex] ?? undefined,
          {
            id: String(columnIndex),
            header: name,
            sortingFn: sortCells,
            sortUndefined: "last",
            // TanStack starts numeric columns descending. Ascending first is
            // what a column header click means everywhere else.
            sortDescFirst: false,
          },
        ),
      ),
    [data.columns],
  );

  // Flagged-only narrows the data the table is given. It is a plain predicate
  // over a record, so it does not need to live in column-filter state, where a
  // sort header could be left holding a stale filter.
  const shown = useMemo(
    () => (flaggedOnly ? records.filter((record) => record.flagged) : records),
    [records, flaggedOnly],
  );

  const table = useReactTable({
    data: shown,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    globalFilterFn: matchesSearch,
    // Every column is searchable: the default skips columns whose first value
    // is not a string or number, which would drop booleans and NULL-led ones.
    getColumnCanGlobalFilter: () => true,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: true,
  });

  const visibleRows = table.getRowModel().rows;

  const virtualise = visibleRows.length > VIRTUALISE_ABOVE;
  const rowWindow = useVirtualRows(
    scrollRef,
    virtualise ? visibleRows.length : 0,
    ROW_HEIGHT,
  );
  const first = virtualise ? rowWindow.start : 0;
  const last = virtualise ? rowWindow.end : visibleRows.length;

  if (data.columns.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-[13px] text-muted">
        The query returned no columns.
      </p>
    );
  }

  const showToolbar = data.rows.length >= TOOLBAR_FROM_ROWS || alertCount > 0;
  const narrowed = search.trim() !== "" || flaggedOnly;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showToolbar ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-3">
          <label className="relative block min-w-[9rem] flex-1 sm:max-w-[16rem]">
            <span className="sr-only">Search {title}</span>
            <svg
              width={14}
              height={14}
              viewBox="0 0 16 16"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            >
              <circle cx={7} cy={7} r={4.6} />
              <path d="m10.6 10.6 3 3" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search rows"
              className="w-full rounded-[var(--radius-sm)] border border-line bg-sunken py-1.5 pr-3 pl-8 text-[13px] text-ink transition-[border-color,box-shadow] placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-dim)] focus:outline-none"
            />
          </label>

          {alertCount > 0 ? (
            <button
              type="button"
              onClick={() => setFlaggedOnly((value) => !value)}
              aria-pressed={flaggedOnly}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                flaggedOnly
                  ? "border-alert/40 bg-alert/10 text-alert"
                  : "border-line bg-sunken text-secondary hover:border-line-strong hover:text-ink"
              }`}
            >
              Flagged only
            </button>
          ) : null}

          <p className="tnum ml-auto text-[12.5px] text-muted" aria-live="polite">
            {narrowed
              ? `${visibleRows.length} of ${data.rows.length} rows`
              : `${data.rows.length} rows`}
          </p>
        </div>
      ) : null}

      {/* `tabIndex` because this scrolls: a region a mouse can scroll and a
          keyboard cannot is unreachable content, not a styling detail. */}
      <div
        ref={scrollRef}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto border-t border-line"
      >
        <table className="data-dense w-full border-separate border-spacing-0">
          <caption className="sr-only">
            {title}
            {alertCount > 0 ? `, ${alertCount} flagged rows` : ""}
          </caption>
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              {/* Marker gutter, kept in the header so columns stay aligned. */}
              <th
                scope="col"
                className="w-8 border-b border-line bg-sunken py-2.5 pr-0 pl-4 text-left"
              >
                {alertCount > 0 ? (
                  <span aria-hidden="true" className="text-[12px] font-semibold text-alert">
                    !
                  </span>
                ) : null}
                <span className="sr-only">Flagged</span>
              </th>
              {table.getFlatHeaders().map((header, index) => {
                const numeric = data.numericColumns[index];
                const direction = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      direction === "asc"
                        ? "ascending"
                        : direction === "desc"
                          ? "descending"
                          : "none"
                    }
                    className={`border-b border-line bg-sunken px-2.5 py-2.5 whitespace-nowrap ${
                      numeric ? "text-right" : "text-left"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      title={`Sort by ${String(header.column.columnDef.header)}`}
                      className={`group/sort inline-flex items-center gap-1 rounded-md text-[12.5px] font-semibold transition-colors ${direction ? "text-ink" : "text-muted hover:text-ink"}`}
                    >
                      <span title={String(header.column.columnDef.header)}>
                        {humanizeColumn(String(header.column.columnDef.header))}
                      </span>
                      <SortGlyph direction={direction} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* Spacers stand in for the rows above and below the window, so the
                scrollbar describes the whole result rather than the slice that
                happens to be rendered. */}
            {virtualise && rowWindow.padTop > 0 ? (
              <tr aria-hidden="true" style={{ height: rowWindow.padTop }} />
            ) : null}
            {visibleRows.slice(first, last).map((row) => {
              const { cells, flagged, why } = row.original;
              return (
                <tr
                  key={row.id}
                  style={{ height: ROW_HEIGHT }}
                  className={`group/row transition-colors hover:bg-raised/70 ${
                    flagged ? "bg-alert/[0.045]" : ""
                  }`}
                >
                  <td
                    title={why}
                    className={`border-b border-line/70 py-2 pr-0 pl-4 align-middle ${
                      flagged ? "border-l-[3px] border-l-alert pl-[13px]" : ""
                    }`}
                  >
                    {flagged ? (
                      <>
                        {/* A dot with real dimensions. The original marker was
                            a `block h-full` span, and a span in a table cell
                            has no height to fill, so it painted nothing. */}
                        <span
                          className="inline-block h-2 w-2 rounded-full bg-alert align-middle shadow-[0_0_0_3px_var(--signal-alert-dim)]"
                          aria-hidden="true"
                        />
                        {/* Colour alone is not a signal. */}
                        <span className="sr-only">{why}</span>
                      </>
                    ) : null}
                  </td>
                  {cells.map((cell, cellIndex) => {
                    const tone = statusTone(cell);
                    return (
                      <td
                        key={cellIndex}
                        title={cellIndex === 0 ? why : undefined}
                        className={`tnum border-b border-line/70 px-2.5 py-2 whitespace-nowrap ${
                          data.numericColumns[cellIndex] ? "text-right" : "text-left"
                        } ${cell === null ? "text-muted italic" : "text-ink"} ${
                          cellIndex === 0 && !data.numericColumns[0] ? "font-medium" : ""
                        }`}
                      >
                        {tone ? (
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[12px] font-medium ${TONE_CLASS[tone]}`}
                          >
                            {formatCell(cell)}
                          </span>
                        ) : (
                          formatCell(cell)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {virtualise && rowWindow.padBottom > 0 ? (
              <tr aria-hidden="true" style={{ height: rowWindow.padBottom }} />
            ) : null}
          </tbody>
        </table>

        {data.rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-muted">No rows returned.</p>
        ) : visibleRows.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-muted">
            No rows match{search.trim() ? ` "${search.trim()}"` : " this filter"}.
          </p>
        ) : null}
      </div>

      {alertCount > 0 ? (
        <p className="shrink-0 border-t border-line px-5 py-2.5 text-[12px] text-muted">
          <span className="font-semibold text-alert">{alertCount}</span> flagged{" "}
          {alertCount === 1 ? "row" : "rows"}
          {` by ${rules}`}
        </p>
      ) : null}
    </div>
  );
}

/** Up/down chevrons: both faint when unsorted, the active one solid. */
function SortGlyph({ direction }: { direction: false | "asc" | "desc" }) {
  return (
    <svg
      width={10}
      height={12}
      viewBox="0 0 10 12"
      aria-hidden="true"
      className={`shrink-0 transition-opacity ${direction ? "opacity-100" : "opacity-35 group-hover/sort:opacity-80"}`}
    >
      <path
        d="M2 4.6 5 1.8l3 2.8"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={direction === "desc" ? 0.3 : 1}
      />
      <path
        d="M2 7.4 5 10.2l3-2.8"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={direction === "asc" ? 0.3 : 1}
      />
    </svg>
  );
}
