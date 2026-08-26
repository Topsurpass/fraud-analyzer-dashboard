"use client";

import { useMemo } from "react";
import type { ChartType, SavedQueryRead } from "@/contracts/api";
import {
  buildCartesian,
  buildCompare,
  buildHeatmap,
  buildCompareGrid,
  buildMovers,
  buildNumber,
  buildPie,
  buildTable,
} from "@/services/charts/shape";
import Link from "next/link";
import { useQueryPolling } from "@/services/polling/useQueryPolling";
import { useFlagged } from "@/services/flagged/FlaggedContext";
import { FlaggedBadge } from "./FlaggedBadge";
import { formatDuration, formatHash, formatInteger, formatRelative } from "@/services/format";
import { useNow } from "@/lib/useNow";
import { CardMenu } from "./CardMenu";
import { PulseLine } from "./PulseLine";
import { CartesianChartView } from "./charts/CartesianChartView";
import { ChartSkeleton } from "./charts/ChartSkeleton";
import { NumberCardView } from "./charts/NumberCardView";
import { PieChartView } from "./charts/PieChartView";
import { CompareChartView } from "./charts/CompareChartView";
import { HeatmapView } from "./charts/HeatmapView";
import { MoversView } from "./charts/MoversView";
import { CompareGridView } from "./charts/CompareGridView";
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
  /** Rendered in the header, e.g. "add to dashboard". */
  actions?: React.ReactNode;
  /** Extra items inside the card's action menu. */
  menuExtra?: React.ReactNode;
  /** Stop polling, e.g. while a modal is open over the grid. */
  enabled?: boolean;
  /** True when the card is currently occupying its larger grid footprint. */
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** The saved query changed on the engine and the list should be refetched. */
  onChanged?: () => void;
  /** The saved query was deleted on the engine. */
  onDeleted?: () => void;
  /**
   * Which of the query's charts to draw. Omitted means the first, which is
   * what a query page showing one chart wants; a dashboard placing a specific
   * chart passes its id.
   */
  chartId?: string | null;
  /** Shown instead of the query name when a chart has its own. */
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function ChartCard({
  query,
  actions,
  menuExtra,
  enabled = true,
  expanded = false,
  onToggleExpand,
  onChanged,
  onDeleted,
  chartId,
  title,
  className,
  style,
}: ChartCardProps) {
  const flagged = useFlagged();
  const flaggedCount = flagged.countForQuery(query.id);
  const flaggedSeverity = flagged.severityForQuery(query.id);
  const poll = useQueryPolling(query.id, {
    enabled,
    fallbackIntervalMs: query.poll_interval_ms ?? undefined,
  });
  const now = useNow();

  const snapshot = poll.snapshot;
  const spec = snapshot
    ? (chartId
        ? snapshot.charts.find((candidate) => candidate.id === chartId)
        : snapshot.charts[0])
    : undefined;
  // Before the first payload lands there is no spec to read, and a table is
  // the honest skeleton: it is what a query renders as until configured.
  const chartType = spec?.type ?? "table";
  const cardTitle = title ?? spec?.name ?? query.name;

  const view = useMemo(() => {
    if (!snapshot) return null;
    // One payload carries every chart on the query, so picking one here is
    // what lets several cards share a single execution and a single poll.
    if (!spec) return null;

    const result = {
      columns: snapshot.columns,
      rows: snapshot.rows,
      chart: spec,
    };

    switch (spec.type) {
      case "number":
        return { kind: "number" as const, data: buildNumber(result) };
      case "pie":
        return { kind: "pie" as const, data: buildPie(result) };
      case "table":
        return { kind: "table" as const, data: buildTable(result) };
      case "bar":
        return { kind: "bar" as const, data: buildCartesian(result) };
      case "compare":
        return { kind: "compare" as const, data: buildCompare(result) };
      case "compare_grid":
        return { kind: "compare_grid" as const, data: buildCompareGrid(result) };
      case "movers":
        return { kind: "movers" as const, data: buildMovers(result) };
      case "heatmap":
        return { kind: "heatmap" as const, data: buildHeatmap(result) };
      case "line":
      default:
        return { kind: "line" as const, data: buildCartesian(result) };
    }
  }, [snapshot, spec]);

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
      aria-label={cardTitle}
      style={style}
      /* defer-paint lets the browser skip layout and paint for cards that are
         off screen. A board of twenty charts otherwise pays for all twenty on
         every render even though four are visible - the single cheapest thing
         that makes a long dashboard feel immediate. */
      className={`defer-paint group flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius)] border border-line bg-surface shadow-sm transition-all duration-[var(--tween-fast)] hover:border-line-strong hover:shadow ${className ?? ""}`}
    >
      <header className="shrink-0">
        {/*
         * One hairline at the top of the card, coloured by the poll's own
         * state. It is the pulse line's reading at a glance: from across the
         * room a grid of cards shows which ones just moved without any of their
         * text being legible. Live and change only - the alert colour stays
         * inside chart data.
         */}
        <div
          aria-hidden="true"
          className="h-px w-full transition-colors duration-300"
          style={{
            background:
              poll.phase === "error"
                ? "var(--border)"
                : justChanged
                  ? "var(--signal-change)"
                  : "var(--signal-live-dim)",
          }}
        />

        <div className="flex items-start gap-2 px-3 pt-2 pb-1">
          <div className="min-w-0 flex-1">
            {/* The chart's own name, not the query's. Four charts of one query
                all headed "Transaction Summary" are four cards nobody can tell
                apart, which is most of the value of naming them. */}
            <h3 className="t-card truncate" title={cardTitle}>
              {cardTitle}
            </h3>
            {/* The query underneath, so a card still says where its data came
                from once the heading stops saying so. */}
            {cardTitle !== query.name ? (
              <p className="t-sub mt-0.5 truncate" title={query.name}>
                {query.name}
              </p>
            ) : query.description ? (
              <p className="t-sub mt-0.5 truncate">{query.description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Findings waiting on this query. Links into the review queue,
                  because seeing the count is only useful if the next step is
                  one click away. */}
            {flaggedCount > 0 ? (
              <Link
                href={`/connections/${query.connection_id}/flagged`}
                aria-label={`Review ${flaggedCount} flagged rows from ${query.name}`}
               >
                <FlaggedBadge count={flaggedCount} severity={flaggedSeverity} />
              </Link>
            ) : null}
            {/* Colour plus a word: the change state is never colour alone. */}
            {justChanged ? (
              <span className="tnum text-[9px] tracking-widest text-change uppercase">
                changed
              </span>
            ) : null}
            {actions}
            {onToggleExpand ? (
              <ExpandButton expanded={expanded} onClick={onToggleExpand} name={cardTitle} />
            ) : null}
            <CardMenu
              query={query}
              chartId={chartId}
              currentChartType={chartType}
              onMutated={() => {
                // Re-poll immediately so a new chart type is drawn now rather
                // than at the end of this card's interval.
                poll.refresh();
                onChanged?.();
              }}
              onDeleted={onDeleted}
              extra={menuExtra}
            />
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
          chartType={chartType}
        />
      </header>

      <div className="min-h-0 flex-1">
        {poll.phase === "error" && !snapshot ? (
          <CardError message={poll.error?.displayMessage ?? "Poll failed"} onRetry={poll.refresh} />
        ) : !view ? (
          <ChartSkeleton type={chartType} />
        ) : view.kind === "number" ? (
          <NumberCardView data={view.data} title={cardTitle} />
        ) : view.kind === "compare" ? (
          <CompareChartView data={view.data} title={cardTitle} />
        ) : view.kind === "compare_grid" ? (
          <CompareGridView data={view.data} title={cardTitle} chartId={spec?.id} />
        ) : view.kind === "movers" ? (
          <MoversView data={view.data} title={cardTitle} />
        ) : view.kind === "heatmap" ? (
          <HeatmapView data={view.data} title={cardTitle} />
        ) : view.kind === "pie" ? (
          <PieChartView data={view.data} title={cardTitle} />
        ) : view.kind === "table" ? (
          <TableView data={view.data} title={cardTitle} />
        ) : (
          <CartesianChartView data={view.data} kind={view.kind} title={cardTitle} />
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
  chartType: ChartType;
}) {
  const snapshot = poll.snapshot;

  return (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden border-b border-line px-3 pt-0.5 pb-1.5 text-[10px] text-muted">
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

/**
 * Grow a card to its larger footprint and back.
 *
 * A dense grid is right for scanning and wrong for reading a 50-row table or a
 * crowded multi-series line, so any card can take more room without the analyst
 * leaving the page. The default size is unchanged; this is opt-in per card.
 */
function ExpandButton({
  expanded,
  onClick,
  name,
}: {
  expanded: boolean;
  onClick: () => void;
  name: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={expanded}
      aria-label={expanded ? `Shrink ${name}` : `Expand ${name}`}
      title={expanded ? "Shrink" : "Expand"}
      className="shrink-0 px-1 text-muted transition-colors hover:text-live"
    >
      <svg width={11} height={11} viewBox="0 0 12 12" aria-hidden="true">
        {expanded ? (
          <>
            <path d="M5 1v4H1" fill="none" stroke="currentColor" strokeWidth={1.25} />
            <path d="M7 11V7h4" fill="none" stroke="currentColor" strokeWidth={1.25} />
          </>
        ) : (
          <>
            <path d="M1 5V1h4" fill="none" stroke="currentColor" strokeWidth={1.25} />
            <path d="M11 7v4H7" fill="none" stroke="currentColor" strokeWidth={1.25} />
          </>
        )}
      </svg>
    </button>
  );
}
