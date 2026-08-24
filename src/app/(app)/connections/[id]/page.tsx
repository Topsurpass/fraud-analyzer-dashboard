"use client";

import { use, useCallback } from "react";
import { useConnections } from "@/services/connections/ConnectionsContext";
import { listQueries } from "@/services/api-client";
import { useResource } from "@/lib/useResource";
import { PageBody } from "@/components/PageBody";
import { ChartCard } from "@/components/ChartCard";
import { ChartGrid, PENDING_CELL_CLASS, chartCellClass } from "@/components/ChartGrid";
import { AddToDashboardMenu } from "@/components/AddToDashboardMenu";
import { useExpandedCards } from "@/lib/useExpandedCards";
import { EmptyState, ErrorState, LinkButton } from "@/components/ui";

/**
 * A connection's live grid: every saved query it owns, each polling on its own
 * cadence. This is the screen the design brief is drawn from.
 */
export default function ConnectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { connections } = useConnections();
  const connection = connections.find((entry) => entry.id === id) ?? null;

  const load = useCallback((signal: AbortSignal) => listQueries(id, { signal }), [id]);
  const queries = useResource(load);
  const expanded = useExpandedCards();

  const name = connection?.name ?? "Connection";

  return (
    <PageBody
      crumbs={[{ label: "Connections", href: "/" }, { label: name }]}
      actions={
        <div className="flex items-center gap-2">
          <LinkButton href={`/connections/${id}/flagged`}>Flagged</LinkButton>
          <LinkButton href={`/connections/${id}/settings`}>Settings</LinkButton>
          <LinkButton href={`/connections/${id}/queries/new`} tone="primary">
            New query
          </LinkButton>
        </div>
      }
    >
      {connection?.status === "failed" ? (
        <p className="mb-2 border border-change/40 bg-change/5 px-3 py-2 text-[11px] text-change">
          This connection last failed its test
          {connection.last_test_error ? `: ${connection.last_test_error.replace(/\.?$/, ".")}` : "."}{" "}
          Cards below will keep failing until it is fixed.
        </p>
      ) : null}

      {queries.error ? (
        <ErrorState
          title="Could not load saved queries"
          message={queries.error.displayMessage}
          onRetry={queries.reload}
        />
      ) : queries.initial ? (
        <ChartGrid>
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className={`skeleton-sweep border border-line bg-surface ${PENDING_CELL_CLASS}`}
            />
          ))}
        </ChartGrid>
      ) : (queries.data ?? []).length === 0 ? (
        <EmptyState
          title="No saved queries on this connection"
          body="A saved query is read-only SQL plus a chart type. The engine runs it, hashes the result, and this grid polls the hash."
          action={
            <LinkButton href={`/connections/${id}/queries/new`} tone="primary">
              Write the first query
            </LinkButton>
          }
        />
      ) : (
        <ChartGrid>
          {(queries.data ?? []).map((query) => (
            <ChartCard
              key={query.id}
              query={query}
              className={chartCellClass(query.chart_type, expanded.isExpanded(query.id))}
              expanded={expanded.isExpanded(query.id)}
              onToggleExpand={() => expanded.toggle(query.id)}
              onChanged={queries.reload}
              onDeleted={queries.reload}
              actions={<AddToDashboardMenu queryId={query.id} />}
            />
          ))}
        </ChartGrid>
      )}
    </PageBody>
  );
}
