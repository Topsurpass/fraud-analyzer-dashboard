"use client";

import { useMemo } from "react";
import type { SavedQueryRead } from "@/contracts/api";
import { buildCartesian, buildNumber, buildPie, buildTable } from "@/services/charts/shape";
import { useQueryPolling } from "@/services/polling/useQueryPolling";
import { formatDuration, formatHash, formatInteger, formatRelative } from "@/services/format";
import { useNow } from "@/lib/useNow";
import { PulseLine } from "./PulseLine";
import { CartesianChartView } from "./charts/CartesianChartView";
import { ChartSkeleton } from "./charts/ChartSkeleton";
import { NumberCardView } from "./charts/NumberCardView";
import { PieChartView } from "./charts/PieChartView";
import { TableView } from "./charts/TableView";

/**
 * One live reading on the grid.
 *
 * The card owns its own poll loop, so a failing query degrades alone instead of
 * taking the dashboard with it, and the pulse line in its header is wired
 * straight to that loop's real state.
 */

export interface ChartCardProps {
  query: SavedQueryRead;
  /** Rendered in the header, e.g. "remove from dashboard". */
  actions?: React.ReactNode;
  /** Stop polling, e.g. while a modal is open over the grid. */
  enabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function ChartCard({ query, actions, enabled = true, className, style }: ChartCardProps) {
  const poll = useQueryPolling(query.id, {
    enabled,
    fallbackIntervalMs: query.poll_interval_ms ?? undefined,
  });
  const now = useNow();

  const snapshot = poll.snapshot;

  const view = useMemo(() => {
    if (!snapshot) return null;
    const result = {
      columns: snapshot.columns,
      rows: snapshot.rows,
      chart: snapshot.chart,
    };

    switch (snapshot.chart.type) {
      case "number":
        return { kind: "number" as const, data: buildNumber(result) };
      case "pie":
        return { kind: "pie" as const, data: buildPie(result) };
      case "table":
        return { kind: "table" as const, data: buildTable(result) };
      case "bar":
        return { kind: "bar" as const, data: buildCartesian(result) };
      case "line":
      default:
        return { kind: "line" as const, data: buildCartesian(result) };
    }
  }, [snapshot]);

  const warnings = view
    ? "warnings" in view.data
      ? view.data.warnings
      : []
    : [];

  // The last poll is the one that brought new data.
  const justChanged =
    poll.lastPolledAt !== null && poll.lastChangedAt === poll.lastPolledAt;

  return (
    <article
      aria-label={query.name}
      style={style}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden border border-line bg-surface ${className ?? ""}`}
    >
      <header className="shrink-0">
        <div className="flex items-start gap-2 px-3 pt-2.5 pb-1.5">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[13px] leading-tight font-medium">{query.name}</h3>
            {query.description ? (
              <p className="mt-0.5 truncate text-[11px] text-muted">{query.description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Colour plus a word: the change state is never colour alone. */}
            {justChanged ? (
              <span className="tnum text-[9px] tracking-widest text-change uppercase">
                changed
              </span>
            ) : null}
            {actions}
          </div>
        </div>

        <PulseLine
          className="block w-full"
          phase={poll.phase}
          changeSeq={poll.changeSeq}
          pollSeq={poll.pollSeq}
          lastPolledAt={poll.lastPolledAt}
          lastChangedAt={poll.lastChangedAt}
        />

        <StatusLine
          poll={poll}
          now={now}
          chartType={query.chart_type}
        />
      </header>

      <div className="min-h-0 flex-1">
        {poll.phase === "error" && !snapshot ? (
          <CardError message={poll.error?.displayMessage ?? "Poll failed"} onRetry={poll.refresh} />
        ) : !view ? (
          <ChartSkeleton type={query.chart_type} />
        ) : view.kind === "number" ? (
          <NumberCardView data={view.data} title={query.name} />
        ) : view.kind === "pie" ? (
          <PieChartView data={view.data} title={query.name} />
        ) : view.kind === "table" ? (
          <TableView data={view.data} title={query.name} />
        ) : (
          <CartesianChartView data={view.data} kind={view.kind} title={query.name} />
        )}
      </div>

      {/* A stale card must say so even while it still shows its last good data. */}
      {poll.phase === "error" && snapshot ? (
        <CardErrorBanner
          message={poll.error?.displayMessage ?? "Poll failed"}
          attempts={poll.consecutiveErrors}
          onRetry={poll.refresh}
        />
      ) : null}

      {warnings.length > 0 ? (
        <ul className="border-t border-line px-3 py-1.5 text-[10px] text-change">
          {warnings.slice(0, 2).map((warning) => (
            <li key={warning} className="truncate" title={warning}>
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function StatusLine({
  poll,
  now,
  chartType,
}: {
  poll: ReturnType<typeof useQueryPolling>;
  now: number;
  chartType: SavedQueryRead["chart_type"];
}) {
  const snapshot = poll.snapshot;

  return (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden border-b border-line px-3 pb-1.5 text-[10px] text-muted">
      <span className="tnum shrink-0">
        {snapshot ? `${formatInteger(snapshot.row_count)} rows` : "-- rows"}
      </span>
      <span aria-hidden="true" className="text-line-strong">
        |
      </span>
      <span className="tnum shrink-0">{formatDuration(snapshot?.duration_ms ?? null)}</span>
      <span aria-hidden="true" className="text-line-strong">
        |
      </span>
      <span className="tnum truncate" title={poll.dataHash ?? undefined}>
        {formatHash(poll.dataHash)}
      </span>
      <span className="tnum ml-auto shrink-0 whitespace-nowrap">
        {poll.phase === "paused"
          ? "paused"
          : formatRelative(
              poll.lastPolledAt ? new Date(poll.lastPolledAt).toISOString() : null,
              now,
            )}
      </span>
      <span className="sr-only">{chartType} chart</span>
    </div>
  );
}

function CardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center">
      <p className="text-[12px] text-ink">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="border border-line-strong px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-live hover:text-live"
      >
        Retry
      </button>
    </div>
  );
}

function CardErrorBanner({
  message,
  attempts,
  onRetry,
}: {
  message: string;
  attempts: number;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-line bg-sunken px-3 py-1.5">
      <span className="text-[10px] text-muted">
        Stale · {message}
        {attempts > 1 ? (
          <span className="tnum"> ({attempts} attempts)</span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="ml-auto text-[10px] text-live underline-offset-2 hover:underline"
      >
        Retry
      </button>
    </div>
  );
}
