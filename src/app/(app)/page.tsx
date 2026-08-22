"use client";

import Link from "next/link";
import { useConnections } from "@/services/connections/ConnectionsContext";
import { PageBody } from "@/components/PageBody";
import { StatusDot } from "@/components/StatusDot";
import { EmptyState, ErrorState, LinkButton } from "@/components/ui";
import { formatDateTime, formatRelative } from "@/services/format";
import { useNow } from "@/lib/useNow";

/**
 * Overview: every connection the engine knows about, with the one thing that
 * decides whether its dashboards will work - whether it last answered.
 */
export default function OverviewPage() {
  const { connections, initial, error, reload } = useConnections();
  const now = useNow(5000);

  return (
    <PageBody
      crumbs={[{ label: "Connections" }]}
      actions={
        <LinkButton href="/connections/new" tone="primary">
          New connection
        </LinkButton>
      }
    >
      {error ? (
        <ErrorState
          title="Could not load connections"
          message={error.displayMessage}
          onRetry={reload}
        />
      ) : initial ? (
        <ul className="skeleton-sweep grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <li key={index} className="h-24 border border-line bg-surface" />
          ))}
        </ul>
      ) : connections.length === 0 ? (
        <EmptyState
          title="No connections yet"
          body="A connection points the engine at a database. Saved queries and dashboards hang off it."
          action={
            <LinkButton href="/connections/new" tone="primary">
              Add the first connection
            </LinkButton>
          }
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {connections.map((connection) => (
            <li key={connection.id}>
              <Link
                href={`/connections/${connection.id}`}
                className="block border border-line bg-surface p-3 transition-colors hover:border-line-strong"
              >
                <div className="flex items-center gap-2">
                  <StatusDot status={connection.status} />
                  <span className="truncate text-[13px]">{connection.name}</span>
                  <span className="tnum ml-auto shrink-0 text-[10px] tracking-wide text-muted uppercase">
                    {connection.db_type}
                  </span>
                </div>

                <p className="tnum mt-2 truncate text-[11px] text-muted">
                  {connection.db_type === "sqlite"
                    ? (connection.sqlite_path ?? "--")
                    : `${connection.host ?? "--"}:${connection.port ?? "--"}/${connection.database ?? "--"}`}
                </p>

                <p
                  className="tnum mt-1 text-[10px] text-muted"
                  title={formatDateTime(connection.last_tested_at)}
                >
                  tested {formatRelative(connection.last_tested_at, now)}
                </p>

                {connection.status === "failed" && connection.last_test_error ? (
                  <p className="mt-1.5 line-clamp-2 text-[10px] text-change">
                    {connection.last_test_error}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageBody>
  );
}
