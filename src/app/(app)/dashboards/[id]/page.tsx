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
async function resolveQueries(
  key: string,
  signal: AbortSignal,
): Promise<{ found: SavedQueryRead[]; stale: boolean }> {
  const ids = key ? key.split(",") : [];
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
    removeQueryFrom,
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
  const key = dashboard ? dashboard.query_ids.join(",") : "";
  const queryIds = useMemo(() => (key ? key.split(",") : []), [key]);

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
          {(queryIds.length > 0 ? queryIds : ["a", "b", "c"]).map((queryId) => (
            <div
              key={queryId}
              className={`skeleton-sweep border border-line bg-surface ${PENDING_CELL_CLASS}`}
            />
          ))}
        </ChartGrid>
      ) : queryIds.length === 0 ? (
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
          {(queries.data?.found ?? []).map((query) => (
            <ChartCard
              key={query.id}
              query={query}
              className={chartCellClass(query.chart_type, expandedCards.isExpanded(query.id))}
              expanded={expandedCards.isExpanded(query.id)}
              onToggleExpand={() => expandedCards.toggle(query.id)}
              onChanged={queries.reload}
              onDeleted={() => {
                board.reload();
                reloadDashboards();
                queries.reload();
              }}
              menuExtra={
                dashboard ? (
                  <button
                    type="button"
                    onClick={async () => {
                      await removeQueryFrom(dashboard.id, query.id);
                      board.reload();
                    }}
                    className="block w-full px-2.5 py-1 text-left text-[12px] text-muted transition-colors hover:bg-surface hover:text-ink"
                  >
                    Remove from this board
                  </button>
                ) : null
              }
            />
          ))}
        </ChartGrid>
      )}
    </PageBody>
  );
}
