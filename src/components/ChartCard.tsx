"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { ChartType, RunResponse, SavedQueryRead } from "@/contracts/api";
import {
  buildBiaxial,
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
import {
  formatDateTime,
  formatDuration,
  formatHash,
  formatInteger,
  formatInterval,
  formatRelative,
  formatUntil,
} from "@/services/format";
import { useNow } from "@/lib/useNow";
import { CardMenu } from "./CardMenu";
import { PublishedBadge, PublishRejectionNote } from "./PublishedBadge";
import { ViewerCardMenu } from "./ViewerCardMenu";
import { BiaxialBarChartView } from "./charts/BiaxialBarChartView";
import { CartesianChartView } from "./charts/CartesianChartView";
import { FlagStrip } from "./charts/FlagStrip";
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
 * taking the dashboard with it, and the live indicator in its header is wired
 * straight to that loop's real state.
 */

export interface ChartCardProps {
  query: SavedQueryRead;
  /**
   * Render somebody else's published chart: poll by chart id through the
   * ownership-ignoring path, and hide every control that edits.
   *
   * A viewer has no rights over this chart at all, so showing them a menu
   * whose every item would be refused is worse than showing no menu.
   */
  published?: boolean;
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

/**
 * What a payload asks the card to draw: the rows' hash plus every chart's type
 * and field mapping. Two payloads with the same key render identically, so the
 * second can be skipped; a different key must be re-shaped.
 */
function drawingKey(response: RunResponse | null): string | null {
  if (!response) return null;
  const charts = response.charts
    .map(
      (chart) =>
        `${chart.id}:${chart.type}:${chart.x_field ?? ""}:${chart.y_field ?? ""}:${chart.series_field ?? ""}:${chart.surge_threshold_pct ?? ""}`,
    )
    .join("|");
  return `${response.data_hash}#${charts}`;
}

export function ChartCard({
  query,
  published = false,
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
  const poll = useQueryPolling(published && chartId ? chartId : query.id, {
    enabled,
    published,
    fallbackIntervalMs: query.poll_interval_ms ?? undefined,
  });
  const now = useNow();

  const snapshot = poll.snapshot;

  /*
   * The last payload whose data actually differed.
   *
   * A forced refresh - the retry button, a chart-type change, anything that
   * calls `poll.refresh()` - comes back as a fresh object carrying the same
   * `data_hash` and therefore the same rows. Keying the shaping below on the
   * object identity re-shaped 25,000 rows on every one of those clicks, for
   * every card on the board; keying it on the hash means the work happens when
   * the data moved and not otherwise.
   *
   * "Differed" means the rows OR how they are drawn. Changing a chart's type
   * re-runs the query and comes back with the same rows, so the same hash, but
   * a different `charts` mapping. Keyed on the hash alone that answer was
   * thrown away and the card kept drawing the old type until a full reload.
   *
   * Adjusting state during render is React's documented way to derive from a
   * changing prop without an extra pass, and it is the pattern the poll loop
   * itself uses to reset when the query id changes.
   */
  const [shaped, setShaped] = useState<RunResponse | null>(snapshot);
  if (drawingKey(snapshot) !== drawingKey(shaped)) setShaped(snapshot);

  /*
   * Hand the shaping to React at transition priority.
   *
   * Shaping is the expensive part of a card and a board carries eight to twelve
   * of them. React yields to the browser between components while it renders a
   * transition, so the board now paints card by card instead of locking the tab
   * for the length of every card's pass back to back. Each card keeps showing
   * its previous data, or its skeleton, until its own turn comes.
   *
   * `act()` flushes transitions, so this stays synchronous under test.
   */
  const source = useDeferredValue(shaped);

  const spec = source
    ? (chartId
        ? source.charts.find((candidate) => candidate.id === chartId)
        : source.charts[0])
    : undefined;
  // Before the first payload lands there is no spec to read, and a table is
  // the honest skeleton: it is what a query renders as until configured.
  const chartType = spec?.type ?? "table";
  const cardTitle = title ?? spec?.name ?? query.name;

  /*
   * The publication state comes from the query's own chart list rather than
   * the run payload. The payload carries the drawing mapping, which is what a
   * card needs to render; whether a chart is shared is a property of the saved
   * chart, and reading it from the authoritative place keeps the badge honest
   * when a poll answer is a moment stale.
   */
  const publishedChart = chartId
    ? query.charts.find((candidate) => candidate.id === chartId)
    : query.charts[0];

  const view = useMemo(() => {
    if (!source) return null;
    // One payload carries every chart on the query, so picking one here is
    // what lets several cards share a single execution and a single poll.
    if (!spec) return null;

    const result = {
      columns: source.columns,
      rows: source.rows,
      chart: spec,
      // The engine's verdict on which rows the query's flag rules caught. Left
      // out, every builder sees "no rules" and no chart can mark, or name, a
      // single flagged point.
      flags: source.flags,
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
      // Same shaping as a bar: a stack is a bar whose series share a column.
      case "stacked_bar":
        return { kind: "stacked_bar" as const, data: buildCartesian(result) };
      case "biaxial_bar":
        return { kind: "biaxial_bar" as const, data: buildBiaxial(result) };
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
  }, [source, spec]);

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
      className={`defer-paint group flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border bg-surface shadow-sm transition-[border-color,box-shadow] duration-[var(--tween-fast)] hover:shadow ${
        justChanged ? "border-change/40" : "border-line hover:border-line-strong"
      } ${className ?? ""}`}
    >
      <header className="shrink-0">
        <div className="flex items-start gap-2 px-5 pt-4 pb-2">
          <div className="min-w-0 flex-1">
            {/* The chart's own name, not the query's. Four charts of one query
                all headed "Transaction Summary" are four cards nobody can tell
                apart, which is most of the value of naming them. */}
            <div className="flex min-w-0 items-center gap-1.5">
              <h3 className="t-card truncate" title={cardTitle}>
                {cardTitle}
              </h3>
              {publishedChart ? <PublishedBadge chart={publishedChart} /> : null}
            </div>
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
          <div className="flex shrink-0 items-center gap-2">
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
            <LivePill phase={poll.phase} justChanged={justChanged} />
            {actions}
            {onToggleExpand ? (
              <ExpandButton expanded={expanded} onClick={onToggleExpand} name={cardTitle} />
            ) : null}
            {published ? (
              chartId ? (
                <ViewerCardMenu chartId={chartId} name={cardTitle} />
              ) : null
            ) : (
              <CardMenu
                query={query}
                chartId={chartId}
                currentChartType={chartType}
                isPublished={publishedChart?.is_public ?? false}
                chart={publishedChart}
                onMutated={() => {
                  // Re-read the result now so a new chart type, or the run
                  // that was just asked for, is drawn at once rather than at
                  // the end of this card's interval. A re-read, not a forced
                  // poll: the engine's cache is already right, and forcing
                  // would run the query on the database a second time for a
                  // change that does not need it.
                  poll.resync();
                  onChanged?.();
                }}
                onDeleted={onDeleted}
                extra={menuExtra}
              />
            )}
          </div>
        </div>
      </header>

      {publishedChart && !published ? <PublishRejectionNote chart={publishedChart} /> : null}

      {/* The rules behind the marks below. A table lists its own in its footer. */}
      {chartType !== "table" ? <FlagStrip flags={source?.flags} /> : null}

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
        ) : view.kind === "biaxial_bar" ? (
          <BiaxialBarChartView data={view.data} title={cardTitle} />
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

      <StatusLine poll={poll} now={now} chartType={chartType} />

      {/* A stale card must say so even while it still shows its last good data. */}
      {poll.phase === "error" && snapshot ? (
        <CardErrorBanner
          message={poll.error?.displayMessage ?? "Poll failed"}
          attempts={poll.consecutiveErrors}
          onRetry={poll.refresh}
        />
      ) : null}

      {warnings.length > 0 ? (
        <ul className="border-t border-line px-5 py-2 text-[12px] text-change">
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

/**
 * The card's pulse, in one glance: a beating dot while polling is healthy, an
 * amber "changed" when the last poll brought new data, grey when paused and a
 * rose dot on failure. The word always comes with the colour.
 */
function LivePill({
  phase,
  justChanged,
}: {
  phase: ReturnType<typeof useQueryPolling>["phase"];
  justChanged: boolean;
}) {
  if (justChanged) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-change/12 px-2 py-0.5 text-[11px] font-medium text-change">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
        changed
      </span>
    );
  }
  if (phase === "error") {
    return (
      <span
        className="size-2 rounded-full bg-alert"
        title="Polling is failing"
        role="img"
        aria-label="Polling is failing"
      />
    );
  }
  if (phase === "paused") return null;
  return (
    <span
      className="relative inline-grid size-2 place-items-center text-live"
      title="Live: polling"
      role="img"
      aria-label="Live"
    >
      <span className="beacon absolute inset-0 rounded-full" aria-hidden="true" />
      <span className="relative size-2 rounded-full bg-current" aria-hidden="true" />
    </span>
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
    <div className="flex min-w-0 items-center gap-2 overflow-hidden border-t border-line px-5 py-2.5 text-[11.5px] text-muted">
      <span className="tnum shrink-0">
        {snapshot
          ? `${formatInteger(snapshot.row_count)} ${snapshot.row_count === 1 ? "row" : "rows"}`
          : "-- rows"}
      </span>
      <span aria-hidden="true" className="text-line-strong">
        ·
      </span>
      <span className="tnum shrink-0">{formatDuration(snapshot?.duration_ms ?? null)}</span>
      <span aria-hidden="true" className="text-line-strong">
        ·
      </span>
      <span className="mono truncate opacity-80" title={poll.dataHash ?? undefined}>
        {formatHash(poll.dataHash)}
      </span>
      <span
        className="tnum ml-auto shrink-0 whitespace-nowrap"
        title={scheduleTitle(poll)}
      >
        {poll.phase === "paused" ? "paused" : scheduleText(poll, now)}
      </span>
      <span className="sr-only">{chartType} chart</span>
    </div>
  );
}

/**
 * When the query last *ran*, and when it runs next.
 *
 * Not "when did I last ask": a poll inside the interval is answered from the
 * engine's cache and runs nothing, so that time moves every visit and says
 * nothing about the data. The execution time only moves when the database was
 * actually queried, and the next run is counted from it, so leaving the page and
 * coming back changes neither. "Next" is left out for short intervals, where a
 * countdown would only tick.
 */
function scheduleText(poll: ReturnType<typeof useQueryPolling>, now: number): string {
  const ran = poll.executedAt;
  if (ran === null) {
    // An engine that does not report it: the last time we heard from it.
    return formatRelative(poll.lastPolledAt ? new Date(poll.lastPolledAt).toISOString() : null, now);
  }
  const text = `ran ${formatRelative(new Date(ran).toISOString(), now)}`;
  if (poll.pollIntervalMs < NEXT_RUN_FROM_MS || poll.nextPollAt === null) return text;
  // Counted from the run, not from our own next poll, which sits a moment past it.
  return `${text} · next ${formatUntil(ran + poll.pollIntervalMs - now)}`;
}

function scheduleTitle(poll: ReturnType<typeof useQueryPolling>): string | undefined {
  if (poll.executedAt === null) return undefined;
  return `Last run ${formatDateTime(new Date(poll.executedAt).toISOString())}. The query runs at most once every ${formatInterval(poll.pollIntervalMs)}, however often this page is opened.`;
}

/** Below this the "next run" countdown only ticks and is left out. */
const NEXT_RUN_FROM_MS = 30_000;

function CardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center">
      <p className="text-[12px] text-ink">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-[var(--radius-sm)] border border-line-strong px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-raised"
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
    <div className="flex items-center gap-2 border-t border-change/25 bg-change/8 px-5 py-2">
      <span className="text-[12px] text-change">
        Stale · {message}
        {attempts > 1 ? (
          <span className="tnum"> ({attempts} attempts)</span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="ml-auto text-[12px] font-medium text-accent underline-offset-2 hover:underline"
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
      className="grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
    >
      <svg width={13} height={13} viewBox="0 0 12 12" aria-hidden="true">
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
