"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { PreviewResponse } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { buildTable } from "@/services/charts/shape";
import { formatDuration, formatInteger } from "@/services/format";
import { TableView } from "@/components/charts/TableView";
import { queryErrorMessage } from "@/components/lists/items";
import { Button } from "@/components/ui";

/**
 * What the query returned, in the places a person needs to see it.
 *
 * The preview used to be a plain panel below the SQL, so it scrolled away as soon as
 * the rules or the charts grew, and its only prompt was a small button in a distant
 * header. Here the same result is shown in two forms: the full card under the SQL,
 * and a dock pinned to the bottom of the screen whenever that card is out of view,
 * so the result and the way to refresh it are never more than a glance away.
 */

/**
 * The shortcut as this machine writes it. Read through `useSyncExternalStore` so the
 * server's guess ("Ctrl+Enter") and the browser's answer ("⌘↵" on a Mac) do not
 * disagree during hydration.
 */
export function useShortcutLabel(): string {
  return useSyncExternalStore(
    () => () => {},
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↵" : "Ctrl+Enter"),
    () => "Ctrl+Enter",
  );
}

export interface ResultsState {
  preview: PreviewResponse | null;
  error: ApiError | null;
  previewing: boolean;
  /** The SQL has changed since the preview that is shown. */
  stale: boolean;
  hasSql: boolean;
}

function useTable(preview: PreviewResponse | null) {
  return useMemo(() => {
    if (!preview) return null;
    return buildTable({
      columns: preview.columns,
      rows: preview.rows,
      chart: {
        id: "preview",
        name: "Preview",
        type: "table",
        x_field: null,
        y_field: null,
        series_field: null,
        warnings: [],
      },
      // The preview evaluates the unsaved rules; without them the rows a rule just
      // caught would not be marked, which is the feedback a rule author is after.
      flags: preview.flags,
    });
  }, [preview]);
}

/** "12 rows · 4 columns · 38 ms", and the cap when the preview is only part of it. */
export function ResultsSummary({ preview }: { preview: PreviewResponse }) {
  return (
    <span className="tnum text-[12.5px] text-muted">
      {formatInteger(preview.row_count)} {preview.row_count === 1 ? "row" : "rows"} ·{" "}
      {preview.columns.length} {preview.columns.length === 1 ? "column" : "columns"} ·{" "}
      {formatDuration(preview.duration_ms)}
      {preview.truncated ? " · preview capped, the saved row limit still applies" : ""}
    </span>
  );
}

export function StaleBanner({ onRun, running }: { onRun: () => void; running: boolean }) {
  const shortcut = useShortcutLabel();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-change/30 bg-change/8 px-5 py-2 text-[12.5px] text-change"
    >
      <span className="min-w-0 flex-1">
        <span className="font-medium">Out of date.</span> The SQL has changed since this ran, so the
        columns below may not match it.
      </span>
      <Button type="button" onClick={onRun} disabled={running} className="shrink-0">
        {running ? "Running…" : `Re-run preview (${shortcut})`}
      </Button>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="skeleton-sweep space-y-2 p-5" aria-label="Running the preview" role="status">
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="h-2.5 rounded bg-line" style={{ width: `${92 - index * 9}%` }} />
      ))}
    </div>
  );
}

function ErrorBlock({ error }: { error: ApiError }) {
  return (
    <div role="alert" className="p-5">
      <p className="text-[13px] font-medium text-change">The preview did not run.</p>
      <p className="mt-1 text-[13px] text-secondary">{queryErrorMessage(error)}</p>
      {error.errorCode ? (
        <p className="tnum mt-1.5 text-[11.5px] tracking-wide text-muted uppercase">{error.errorCode}</p>
      ) : null}
    </div>
  );
}

/** The card body under the SQL: every state a result can be in. */
export function ResultsBody({
  state,
  onRun,
}: {
  state: ResultsState;
  onRun: () => void;
}) {
  const table = useTable(state.preview);
  const shortcut = useShortcutLabel();
  if (state.error) return <ErrorBlock error={state.error} />;
  if (state.previewing && !table) return <Skeleton />;
  if (!table || !state.preview) {
    return (
      <div className="flex flex-col items-start gap-3 px-5 py-6 sm:flex-row sm:items-center">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"
        >
          <svg width={18} height={18} viewBox="0 0 18 18" fill="none">
            <path d="M5 3.5v11l9-5.5-9-5.5Z" fill="currentColor" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-ink">Nothing to show yet</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted">
            {state.hasSql
              ? `Run a preview to see the columns and rows this SQL returns. Charts and rules are built from them.`
              : `Write the SQL above, then run a preview. Charts and rules are built from the columns it returns.`}
          </p>
        </div>
        <Button type="button" tone="primary" onClick={onRun} disabled={!state.hasSql || state.previewing}>
          Run preview <span className="tnum ml-1.5 opacity-70">{shortcut}</span>
        </Button>
      </div>
    );
  }
  return (
    <div>
      {state.stale ? <StaleBanner onRun={onRun} running={state.previewing} /> : null}
      <div className={`flex max-h-[26rem] flex-col overflow-hidden ${state.stale ? "opacity-70" : ""}`}>
        <TableView data={table} title="Preview" />
      </div>
    </div>
  );
}

const PEEK_ROWS = 3;
const PEEK_COLUMNS = 6;

/** The first few rows, always in view in the dock, so the results are never just a count. */
function Peek({ preview, stale }: { preview: PreviewResponse; stale: boolean }) {
  const columns = preview.columns.slice(0, PEEK_COLUMNS);
  const rows = preview.rows.slice(0, PEEK_ROWS);
  if (columns.length === 0) return null;
  return (
    <div className={`hidden overflow-x-auto border-t border-line px-4 pb-2 sm:block sm:px-6 lg:px-8 ${stale ? "opacity-60" : ""}`}>
      <table className="tnum w-full text-left text-[12px]" aria-label="First rows of the preview">
        <thead>
          <tr className="text-muted">
            {columns.map((column) => (
              <th key={column} scope="col" className="max-w-[12rem] truncate py-1 pr-4 font-medium">
                {column}
              </th>
            ))}
            {preview.columns.length > PEEK_COLUMNS ? (
              <th scope="col" className="py-1 font-normal text-muted">+{preview.columns.length - PEEK_COLUMNS} more</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="text-secondary">
              {columns.map((column, position) => (
                <td key={column} className="max-w-[12rem] truncate py-0.5 pr-4">
                  {row[position] === null || row[position] === undefined ? "–" : String(row[position])}
                </td>
              ))}
              {preview.columns.length > PEEK_COLUMNS ? <td /> : null}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-1 text-muted">The query returned no rows.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The bottom dock: a slim bar that opens into a tray. Shown only while the full card
 * is off screen (the editor decides), and always carries the way to run again.
 */
export function ResultsDock({
  state,
  open,
  onToggle,
  onRun,
  onShowCard,
}: {
  state: ResultsState;
  open: boolean;
  onToggle: () => void;
  onRun: () => void;
  onShowCard: () => void;
}) {
  const table = useTable(state.preview);
  const status = state.error
    ? "The preview did not run"
    : state.previewing
      ? "Running the preview…"
      : state.preview
        ? null
        : "No preview yet";
  return (
    <div className="border-b border-line">
      <div className="flex items-center gap-3 px-4 py-2 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="qb-dock-tray"
          className="flex min-w-0 items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-left transition-colors hover:bg-raised"
        >
          <svg
            width={12}
            height={12}
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={`shrink-0 text-muted transition-transform ${open ? "" : "rotate-180"}`}
          >
            <path d="m2.5 4.5 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[13px] font-medium text-ink">Results</span>
          {state.preview ? (
            <span className="shrink-0 text-[12px] font-medium text-accent sm:hidden">{open ? "Hide rows" : "View rows"}</span>
          ) : null}
          {status ? (
            <span className="truncate text-[12.5px] text-muted">{status}</span>
          ) : state.preview ? (
            <>
              <span className="hidden sm:inline">
                <ResultsSummary preview={state.preview} />
              </span>
              <span className="tnum text-[12.5px] text-muted sm:hidden">
                {formatInteger(state.preview.row_count)} {state.preview.row_count === 1 ? "row" : "rows"}
              </span>
            </>
          ) : null}
        </button>
        {state.stale && state.preview ? (
          <span className="shrink-0 rounded-full border border-change/40 bg-change/8 px-2 py-0.5 text-[11.5px] font-medium text-change">
            Out of date
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onShowCard}
            className="hidden text-[12.5px] font-medium text-accent hover:underline sm:inline"
          >
            Show in page
          </button>
          <Button type="button" onClick={onRun} disabled={!state.hasSql || state.previewing}>
            {state.previewing ? "Running…" : `Run preview`}
          </Button>
        </span>
      </div>
      {!open && state.preview && !state.error ? <Peek preview={state.preview} stale={state.stale} /> : null}
      {open ? (
        <div id="qb-dock-tray" className="max-h-[42dvh] overflow-hidden border-t border-line bg-surface">
          {state.error ? (
            <ErrorBlock error={state.error} />
          ) : table && state.preview ? (
            <div className="flex max-h-[42dvh] flex-col overflow-hidden">
              <TableView data={table} title="Preview" />
            </div>
          ) : (
            <Skeleton />
          )}
        </div>
      ) : null}
    </div>
  );
}
