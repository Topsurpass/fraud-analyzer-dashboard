"use client";

import { useCallback, useState } from "react";
import { ApiError, listLogs, runQuery } from "@/services/api-client";
import { useResource } from "@/lib/useResource";
import { formatClock, formatDuration, formatInteger } from "@/services/format";
import { Button, Panel } from "./ui";

/**
 * Recent runs of one saved query.
 *
 * This is the answer to "is the card wrong, or is the query failing?" - it
 * shows the engine's own record, including the errors a card can only summarise
 * in a line.
 */
export function ExecutionLog({ queryId, limit = 20 }: { queryId: string; limit?: number }) {
  const load = useCallback(
    (signal: AbortSignal) => listLogs(queryId, limit, { signal }),
    [queryId, limit],
  );
  const logs = useResource(load);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  /**
   * Force an execution now. Distinct from a card's poll: this always runs the
   * SQL against the target database and writes an entry to the history below,
   * which is how an analyst reproduces a failure on demand.
   */
  const run = async () => {
    setRunning(true);
    setRunError(null);
    try {
      await runQuery(queryId);
      logs.reload();
    } catch (cause) {
      setRunError(cause instanceof ApiError ? cause.displayMessage : "The query failed to run");
      logs.reload();
    } finally {
      setRunning(false);
    }
  };

  return (
    <Panel
      title="Execution history"
      actions={
        <>
          <Button type="button" onClick={run} disabled={running || logs.loading}>
            {running ? "Running…" : "Run now"}
          </Button>
          <Button type="button" onClick={logs.reload} disabled={logs.loading}>
            {logs.loading ? "…" : "Refresh"}
          </Button>
        </>
      }
    >
      {runError ? (
        <p className="border-b border-line px-3 py-1.5 text-[11px] text-change">{runError}</p>
      ) : null}

      <div className="max-h-64 overflow-y-auto">
        {logs.error ? (
          <p className="p-3 text-[12px] text-muted">{logs.error.displayMessage}</p>
        ) : logs.initial ? (
          <div className="skeleton-sweep space-y-2 p-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-2.5 bg-line" />
            ))}
          </div>
        ) : (logs.data ?? []).length === 0 ? (
          <p className="p-3 text-[12px] text-muted">This query has not run yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {logs.data?.map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-2 px-3 py-1.5">
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 ${entry.success ? "bg-live" : "bg-change"}`}
                  style={entry.success ? undefined : { clipPath: "polygon(50% 0,100% 100%,0 100%)" }}
                />
                <span className="tnum text-[11px]">{formatClock(entry.executed_at)}</span>
                {entry.success ? (
                  <span className="tnum ml-auto text-[11px] text-muted">
                    {formatInteger(entry.row_count ?? 0)} rows · {formatDuration(entry.duration_ms)}
                  </span>
                ) : (
                  <span
                    className="ml-auto truncate text-[11px] text-change"
                    title={entry.error_message ?? undefined}
                  >
                    {entry.error_code ?? "failed"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
