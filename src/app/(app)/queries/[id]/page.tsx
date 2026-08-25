"use client";

import { use, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  deleteQuery,
  getFlagRules,
  getQuery,
  putFlagRules,
  putQueryCharts,
  getQueryCharts,
  updateQuery,
} from "@/services/api-client";
import { useConnections } from "@/services/connections/ConnectionsContext";
import { invalidateCoalesced } from "@/services/polling/coalesce";
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

  const loadRules = useCallback(
    (signal: AbortSignal) => getFlagRules(id, { signal }),
    [id],
  );
  const rules = useResource(loadRules);

  const loadCharts = useCallback(
    (signal: AbortSignal) => getQueryCharts(id, { signal }),
    [id],
  );
  const charts = useResource(loadCharts);

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
      const { flag_rules: nextRules, charts: nextCharts, ...patch } = values;
      await updateQuery(id, patch);
      // Always sent, including when empty: that is how the last rule is
      // removed, and skipping the call when the list is empty would make
      // deleting a rule silently do nothing.
      await putFlagRules(id, { rules: nextRules });
      // Always sent, like the rules: an empty set is how the last chart is
      // removed, and skipping the call when it is empty would make deleting a
      // chart silently do nothing.
      await putQueryCharts(id, nextCharts);
      // The cached payload echoes every chart's mapping, so a stale answer
      // would keep drawing the old way until it aged out.
      invalidateCoalesced(id);
      query.reload();
      rules.reload();
      charts.reload();
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

  // A rules request that failed must not fall through to the editor. The editor
  // would show an empty rule list, which is indistinguishable from a query that
  // genuinely has none, and the next save PUTs that empty list - deleting the
  // rules that are actually stored. Refusing to render is the only safe answer.
  if (rules.error) {
    return (
      <PageBody crumbs={[{ label: "Connections", href: "/" }, { label: "Query" }]}>
        <ErrorState
          title="Could not load this query's flag rules"
          message={`${rules.error.displayMessage} Editing is blocked until they load, so that saving cannot erase rules this page never saw.`}
          onRetry={rules.reload}
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
      {/* Both resources must settle before the editor mounts. It seeds its rule
          state once, from `initialRules`, so mounting it against a half-loaded
          page means seeding it wrong. */}
      {query.initial || rules.initial || charts.initial || !query.data || !connectionId ? (
        <div className="skeleton-sweep grid gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="h-96 border border-line bg-surface" />
          <div className="h-64 border border-line bg-surface" />
        </div>
      ) : (
        <QueryEditor
          // Keyed on the query being edited, nothing finer. Both resources have
          // settled by now, so there is nothing left to pick up, and remounting
          // on anything that a save changes - `updated_at`, the rule count -
          // throws away the editor's state the moment the reloads land.
          key={id}
          connectionId={connectionId}
          initial={query.data}
          initialCharts={charts.data?.charts.map((chart) => ({
            name: chart.name,
            chart_type: chart.chart_type,
            x_field: chart.x_field ?? "",
            y_field: chart.y_field ?? "",
            series_field: chart.series_field ?? "",
          }))}
          initialRules={rules.data?.rules.map((rule) => ({
            name: rule.name,
            severity: rule.severity,
            enabled: rule.enabled,
            conditions: rule.conditions.map((condition) => ({
              column_name: condition.column_name,
              operator: condition.operator,
              value: condition.value ?? "",
              value2: condition.value2 ?? "",
            })),
          }))}
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
