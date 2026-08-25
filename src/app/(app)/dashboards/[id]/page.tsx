"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SavedQueryRead } from "@/contracts/api";
import { ApiError, getDashboard, getQuery } from "@/services/api-client";
import { findDashboard, useDashboards } from "@/services/dashboards";
import { useResource } from "@/lib/useResource";
import { useExpandedCards } from "@/lib/useExpandedCards";
import { PageBody } from "@/components/PageBody";
import { ChartCard } from "@/components/ChartCard";
import { MenuButton } from "@/components/CardMenu";
import { ChartGrid, PENDING_CELL_CLASS, chartCellClass } from "@/components/ChartGrid";
import { Button, EmptyState, ErrorState, Input, LinkButton } from "@/components/ui";

/**
 * A curated board: saved queries from any connection, side by side.
 *
 * Query ids are resolved individually because the engine lists queries per
 * connection and a board may span several. The board itself is server-owned, so
 * its membership is already reconciled - a query deleted anywhere is gone from
 * every board by the time this list is fetched.
 */
/**
 * Fetch the queries behind a board's charts, once each.
 *
 * Deduplicated on purpose: a board showing one result as a trend line and as
 * the rows behind it holds two charts of one query, and fetching that query
 * twice would reintroduce the per-card cost the query/chart split removed.
 */
async function resolveQueries(
  key: string,
  signal: AbortSignal,
): Promise<{ found: SavedQueryRead[]; stale: boolean }> {
  const ids = key ? [...new Set(key.split(","))] : [];
  const settled = await Promise.all(
    ids.map((queryId) =>
      getQuery(queryId, { signal }).then(
        (query) => query as SavedQueryRead | null,
        (cause: unknown) => {
          // Narrow race only: the query was deleted between this board being
          // fetched and its cards being resolved. The engine has already taken
          // it off the board, so the fix is to refetch, not to patch locally.
          if (cause instanceof ApiError && cause.status === 404) return null;
          throw cause;
        },
      ),
    ),
  );

  return {
    found: settled.filter((query): query is SavedQueryRead => query !== null),
    stale: settled.some((query) => query === null),
  };
}

export default function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const {
    dashboards,
    reload: reloadDashboards,
    rename,
    remove,
    removeChartFrom,
    moveQueryTo,
  } = useDashboards();

  // Fetched by id rather than read out of the rail's list, so a link to a board
  // created on another machine resolves on first paint instead of 404-ing until
  // the list happens to catch up. The list entry is the placeholder while that
  // request is in flight.
  const loadBoard = useCallback((signal: AbortSignal) => getDashboard(id, { signal }), [id]);
  const board = useResource(loadBoard);
  const dashboard = board.data ?? findDashboard(dashboards, id);
  const dashboardsLoading = board.initial && !dashboard;
  const notFound = board.error?.status === 404;

  // Keyed off a primitive so the loader below stays referentially stable: an
  // array literal rebuilt each render would re-fetch the whole board every time
  // anything on this page changed.
  const chartIds = useMemo(
    () => (dashboard ? dashboard.chart_ids : []),
    [dashboard],
  );
  // The board resolves its own charts, so the queries to fetch come from them
  // rather than from another round trip.
  const placed = useMemo(() => dashboard?.charts ?? [], [dashboard]);
  const key = useMemo(
    () => [...new Set(placed.map((chart) => chart.query_id))].join(","),
    [placed],
  );

  const load = useCallback((signal: AbortSignal) => resolveQueries(key, signal), [key]);
  const queries = useResource(load);
  const expandedCards = useExpandedCards();

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // A card that vanished mid-resolve means this board is behind the engine.
  const stale = queries.data?.stale === true;
  const reloadBoard = board.reload;
  useEffect(() => {
    if (!stale) return;
    reloadBoard();
    reloadDashboards();
  }, [stale, reloadBoard, reloadDashboards]);

  // Only a 404 means the board is gone. Any other failure is the engine being
  // unreachable, which is a retry, not a headstone.
  if (notFound) {
    return (
      <PageBody crumbs={[{ label: "Dashboards" }, { label: "Not found" }]}>
        <EmptyState
          title="This dashboard does not exist"
          body="It may have been deleted from another machine."
          action={
            <LinkButton href="/dashboards/new" tone="primary">
              Create one
            </LinkButton>
          }
        />
      </PageBody>
    );
  }

  return (
    <PageBody
      crumbs={[{ label: "Dashboards" }, { label: dashboard?.name ?? "…" }]}
      actions={
        dashboard ? (
          <div className="flex items-center gap-2">
            {renaming ? (
              <form
                className="flex items-center gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await rename(dashboard.id, draftName);
                  board.reload();
                  setRenaming(false);
                }}
              >
                <Input
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  className="h-7 w-40 py-0"
                  aria-label="Dashboard name"
                  autoFocus
                />
                <Button type="submit" tone="primary">
                  Save
                </Button>
                <Button type="button" onClick={() => setRenaming(false)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <Button
                  onClick={() => {
                    setDraftName(dashboard.name);
                    setRenaming(true);
                  }}
                >
                  Rename
                </Button>
                {confirmingDelete ? (
                  <>
                    <Button
                      tone="danger"
                      onClick={async () => {
                        await remove(dashboard.id);
                        router.push("/");
                      }}
                    >
                      Delete board
                    </Button>
                    <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
                  </>
                ) : (
                  <Button tone="danger" onClick={() => setConfirmingDelete(true)}>
                    Delete
                  </Button>
                )}
              </>
            )}
          </div>
        ) : null
      }
    >
      {board.error && !dashboard ? (
        <ErrorState
          title="Could not load this dashboard"
          message={board.error.displayMessage}
          onRetry={board.reload}
        />
      ) : queries.error ? (
        <ErrorState
          title="Could not load this dashboard's queries"
          message={queries.error.displayMessage}
          onRetry={queries.reload}
        />
      ) : dashboardsLoading || queries.initial ? (
        <ChartGrid>
          {(chartIds.length > 0 ? chartIds : ["a", "b", "c"]).map((chartId) => (
            <div
              key={chartId}
              className={`skeleton-sweep border border-line bg-surface ${PENDING_CELL_CLASS}`}
            />
          ))}
        </ChartGrid>
      ) : chartIds.length === 0 ? (
        <EmptyState
          title="This dashboard is empty"
          body="Open a connection and use the + on any card to add it here."
          action={
            <LinkButton href="/" tone="primary">
              Browse connections
            </LinkButton>
          }
        />
      ) : (
        <ChartGrid>
          {placed.map((chart) => {
            const query = (queries.data?.found ?? []).find(
              (candidate) => candidate.id === chart.query_id,
            );
            if (!query) return null;
            return (
              <ChartCard
                key={chart.id}
                query={query}
                chartId={chart.id}
                title={chart.name}
                className={chartCellClass(
                  chart.chart_type,
                  expandedCards.isExpanded(chart.id),
                )}
                expanded={expandedCards.isExpanded(chart.id)}
                onToggleExpand={() => expandedCards.toggle(chart.id)}
                onChanged={queries.reload}
                onDeleted={() => {
                  board.reload();
                  reloadDashboards();
                  queries.reload();
                }}
                menuExtra={
                  dashboard ? (
                    <BoardCardActions
                      position={chartIds.indexOf(chart.id)}
                      count={chartIds.length}
                      onMove={async (toIndex) => {
                        await moveQueryTo(dashboard.id, chart.id, toIndex);
                        board.reload();
                      }}
                      onRemove={async () => {
                        await removeChartFrom(dashboard.id, chart.id);
                        board.reload();
                      }}
                    />
                  ) : null
                }
              />
            );
          })}
        </ChartGrid>
      )}
    </PageBody>
  );
}

/**
 * Where this card sits on the board, and how to leave it.
 *
 * A board is an ordered set - the engine stores a position per card - so the
 * order has to be changeable or every card is stuck where it was added. Two
 * steps rather than drag-and-drop: this is keyboard- and screen-reader-operable
 * with no pointer gestures to reproduce, and "earlier/later" stays true in the
 * single-column mobile layout where "left/right" would not.
 */
function BoardCardActions({
  position,
  count,
  onMove,
  onRemove,
}: {
  position: number;
  count: number;
  onMove: (toIndex: number) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Both actions write to the engine, so both can fail. A menu item that
  // quietly did nothing would read as the app being broken.
  const attempt = async (fallback: string, action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.displayMessage : fallback);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/*
       * `keepOpen`, because these are async and this panel is where their
       * failure is reported - and because nudging a card two places along
       * should not cost two trips through the menu. The card moves under the
       * open menu, which is the confirmation that it worked.
       */}
      <MenuButton
        onClick={() => attempt("Could not reorder the board", () => onMove(position - 1))}
        disabled={busy || position <= 0}
        keepOpen
      >
        Move earlier
      </MenuButton>
      <MenuButton
        onClick={() => attempt("Could not reorder the board", () => onMove(position + 1))}
        disabled={busy || position >= count - 1}
        keepOpen
      >
        Move later
      </MenuButton>
      <MenuButton
        onClick={() => attempt("Could not take it off this board", onRemove)}
        disabled={busy}
        keepOpen
      >
        Remove from this board
      </MenuButton>
      {error ? (
        <p className="px-2.5 pt-1.5 text-[10px] leading-snug text-change">{error}</p>
      ) : null}
    </>
  );
}
