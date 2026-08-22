"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SavedQueryRead } from "@/contracts/api";
import { ApiError, getQuery } from "@/services/api-client";
import { findDashboard, useDashboards } from "@/services/dashboards";
import { useResource } from "@/lib/useResource";
import { PageBody } from "@/components/PageBody";
import { ChartCard } from "@/components/ChartCard";
import { ChartGrid, PENDING_CELL_CLASS, chartCellClass } from "@/components/ChartGrid";
import { Button, EmptyState, ErrorState, Input, LinkButton } from "@/components/ui";
import { useExpandedCards } from "@/lib/useExpandedCards";

/**
 * A curated board: saved queries from any connection, side by side.
 *
 * Query ids are resolved individually because the engine lists queries per
 * connection and a board may span several. A query that has been deleted
 * resolves to nothing and is pruned from the board rather than rendering a card
 * that can only ever error.
 */
/**
 * Resolve a board's query ids. A 404 means the query was deleted on the engine
 * and the card should go; any other failure is a real error and must not
 * silently strip cards off the board.
 */
async function resolveQueries(
  key: string,
  signal: AbortSignal,
): Promise<{ found: SavedQueryRead[]; missing: string[] }> {
  const ids = key ? key.split(",") : [];
  const settled = await Promise.all(
    ids.map((queryId) =>
      getQuery(queryId, { signal }).then(
        (query) => ({ queryId, query: query as SavedQueryRead | null }),
        (cause: unknown) => {
          if (cause instanceof ApiError && cause.status === 404) {
            return { queryId, query: null };
          }
          throw cause;
        },
      ),
    ),
  );

  return {
    found: settled
      .map((entry) => entry.query)
      .filter((query): query is SavedQueryRead => query !== null),
    missing: settled.filter((entry) => entry.query === null).map((entry) => entry.queryId),
  };
}

export default function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { dashboards, hydrated, rename, remove, removeQueryFrom, prune } = useDashboards();
  const dashboard = findDashboard({ version: 1, dashboards }, id);

  // Keyed off a primitive so the loader below stays referentially stable: an
  // array literal rebuilt each render would re-fetch the whole board every time
  // anything on this page changed.
  const key = dashboard ? dashboard.queryIds.join(",") : "";
  const queryIds = useMemo(() => (key ? key.split(",") : []), [key]);

  const load = useCallback((signal: AbortSignal) => resolveQueries(key, signal), [key]);
  const queries = useResource(load);
  const expandedCards = useExpandedCards();

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const missing = queries.data?.missing ?? [];

  // Reconciling the board writes to storage and notifies every subscriber, so
  // it belongs in an effect - doing it during render would update other
  // components mid-render.
  const found = queries.data?.found;
  useEffect(() => {
    if (!found || missing.length === 0) return;
    prune(found.map((query) => query.id));
  }, [found, missing.length, prune]);

  if (hydrated && !dashboard) {
    return (
      <PageBody crumbs={[{ label: "Dashboards" }, { label: "Not found" }]}>
        <EmptyState
          title="This dashboard does not exist"
          body="Dashboards are stored per browser. If this link came from another machine, its dashboards did not travel with it."
          action={<LinkButton href="/dashboards/new" tone="primary">Create one</LinkButton>}
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
                onSubmit={(event) => {
                  event.preventDefault();
                  rename(dashboard.id, draftName);
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
                      onClick={() => {
                        remove(dashboard.id);
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
      {missing.length > 0 ? (
        <p className="mb-2 border border-change/40 bg-change/5 px-3 py-2 text-[11px] text-change">
          {missing.length} {missing.length === 1 ? "query was" : "queries were"} deleted on the
          engine and {missing.length === 1 ? "has" : "have"} been removed from this board.
        </p>
      ) : null}

      {queries.error ? (
        <ErrorState
          title="Could not load this dashboard's queries"
          message={queries.error.displayMessage}
          onRetry={queries.reload}
        />
      ) : queryIds.length === 0 ? (
        <EmptyState
          title="This dashboard is empty"
          body="Open a connection and use the + on any card to add it here."
          action={<LinkButton href="/" tone="primary">Browse connections</LinkButton>}
        />
      ) : queries.initial ? (
        <ChartGrid>
          {queryIds.map((queryId) => (
            <div
              key={queryId}
              className={`skeleton-sweep border border-line bg-surface ${PENDING_CELL_CLASS}`}
            />
          ))}
        </ChartGrid>
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
              onDeleted={queries.reload}
              actions={
                <button
                  type="button"
                  onClick={() => dashboard && removeQueryFrom(dashboard.id, query.id)}
                  className="px-1 text-[13px] leading-none text-muted transition-colors hover:text-live"
                  aria-label={`Remove ${query.name} from this dashboard`}
                  title="Remove from this dashboard"
                >
                  <span aria-hidden="true">−</span>
                </button>
              }
            />
          ))}
        </ChartGrid>
      )}
    </PageBody>
  );
}
