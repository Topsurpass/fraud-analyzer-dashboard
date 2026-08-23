"use client";

import { use, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, deleteQuery, getQuery, updateQuery } from "@/services/api-client";
import { useConnections } from "@/services/connections/ConnectionsContext";
import { useDashboards } from "@/services/dashboards";
import { useResource } from "@/lib/useResource";
import { PageBody } from "@/components/PageBody";
import { QueryEditor, type QueryEditorValues } from "@/components/QueryEditor";
import { ExecutionLog } from "@/components/ExecutionLog";
import { Button, ErrorState, Panel } from "@/components/ui";

/** Edit a saved query, watch its execution history, or delete it. */
export default function QueryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { connections } = useConnections();
  const { reload: reloadDashboards } = useDashboards();

  const load = useCallback((signal: AbortSignal) => getQuery(id, { signal }), [id]);
  const query = useResource(load);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const connectionId = query.data?.connection_id ?? null;
  const connectionName =
    connections.find((entry) => entry.id === connectionId)?.name ?? "Connection";

  const submit = async (values: QueryEditorValues) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateQuery(id, values);
      query.reload();
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause
          : new ApiError({ kind: "network", message: "Could not save the query", url: "" }),
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteQuery(id);
      // The engine cascades the delete through dashboard membership, so no
      // board is left pointing at a query that no longer exists.
      reloadDashboards();
      router.push(connectionId ? `/connections/${connectionId}` : "/");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : null);
      setBusy(false);
    }
  };

  if (query.error) {
    return (
      <PageBody crumbs={[{ label: "Connections", href: "/" }, { label: "Query" }]}>
        <ErrorState
          title="Could not load this query"
          message={query.error.displayMessage}
          onRetry={query.reload}
        />
      </PageBody>
    );
  }

  return (
    <PageBody
      crumbs={[
        { label: "Connections", href: "/" },
        ...(connectionId
          ? [{ label: connectionName, href: `/connections/${connectionId}` }]
          : []),
        { label: query.data?.name ?? "Query" },
      ]}
    >
      {query.initial || !query.data || !connectionId ? (
        <div className="skeleton-sweep grid gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="h-96 border border-line bg-surface" />
          <div className="h-64 border border-line bg-surface" />
        </div>
      ) : (
        <QueryEditor
          key={query.data.updated_at}
          connectionId={connectionId}
          initial={query.data}
          submitLabel="Save changes"
          busy={busy}
          error={error}
          onSubmit={submit}
          onCancel={() => router.push(`/connections/${connectionId}`)}
          footer={
            <>
              {saved ? (
                <p className="border border-live/40 bg-live/5 px-3 py-2 text-[12px] text-live">
                  Saved. Cards using this query pick it up on their next poll.
                </p>
              ) : null}

              <ExecutionLog queryId={id} />

              <Panel title="Danger zone">
                <div className="p-3">
                  <p className="text-[12px] text-muted">
                    Deleting removes the query and its execution history, and takes it off
                    every dashboard that showed it.
                  </p>
                  {confirmingDelete ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button tone="danger" onClick={remove} disabled={busy}>
                        Delete permanently
                      </Button>
                      <Button onClick={() => setConfirmingDelete(false)} disabled={busy}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      tone="danger"
                      className="mt-3"
                      onClick={() => setConfirmingDelete(true)}
                      disabled={busy}
                    >
                      Delete query
                    </Button>
                  )}
                </div>
              </Panel>
            </>
          }
        />
      )}
    </PageBody>
  );
}
