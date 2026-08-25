"use client";

import { useState } from "react";
import type { ConnectionRead } from "@/contracts/api";
import {
  ApiError,
  disconnectConnection,
  reconnectConnection,
} from "@/services/api-client";
import { Button } from "@/components/ui";

/**
 * Turn a database connection off, and back on.
 *
 * Disconnecting closes the engine's pooled connections immediately and stops
 * the scheduler running this connection's queries, so nothing reaches that
 * database until someone reconnects. Everything the analyst built is kept:
 * saved queries, flag rules, and every flagged row already found.
 *
 * Disconnecting takes a second press. It stops every card on the connection at
 * once, and a mis-click that silently halts a fraud queue is worse than one
 * extra click. Reconnecting does not: the risk is entirely in the other
 * direction.
 */
export function ConnectionPowerButton({
  connection,
  onChanged,
}: {
  connection: ConnectionRead;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (what: string, action: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      setConfirming(false);
      onChanged?.();
    } catch (cause) {
      setProblem(cause instanceof ApiError ? cause.displayMessage : `Could not ${what}.`);
    } finally {
      setBusy(false);
    }
  };

  if (connection.paused) {
    return (
      <div className="flex items-center gap-2">
        {problem ? <span className="text-[11.5px] text-change">{problem}</span> : null}
        <Button
          type="button"
          tone="primary"
          disabled={busy}
          title="Reopen this connection. It is tested on the way, so a password rotated while it was off is reported now rather than at the next scheduled run."
          onClick={() => run("reconnect", () => reconnectConnection(connection.id))}
        >
          {busy ? "Reconnecting…" : "Reconnect"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {problem ? <span className="text-[11.5px] text-change">{problem}</span> : null}
      {confirming ? (
        <>
          <Button
            type="button"
            tone="danger"
            disabled={busy}
            onClick={() => run("disconnect", () => disconnectConnection(connection.id))}
          >
            {busy ? "Disconnecting…" : "Disconnect now"}
          </Button>
          <Button type="button" disabled={busy} onClick={() => setConfirming(false)}>
            Keep connected
          </Button>
        </>
      ) : (
        <Button
          type="button"
          disabled={busy}
          title="Close this connection and stop running its queries. Nothing is deleted."
          onClick={() => setConfirming(true)}
        >
          Disconnect
        </Button>
      )}
    </div>
  );
}

/**
 * The banner a disconnected connection shows above its cards.
 *
 * Separate from the button because it belongs at the top of the page rather
 * than in its actions, and because a page full of cards that will not load
 * needs to say why before the reader starts diagnosing their queries.
 */
export function DisconnectedNotice({ name }: { name: string }) {
  return (
    <p className="mb-3 rounded-[var(--radius-sm)] border border-change/40 bg-change/5 px-3 py-2 text-[12px] text-change">
      <strong className="font-semibold">{name} is disconnected.</strong> Nothing
      is running against it and no new rows are being flagged. Saved queries,
      rules and existing findings are all kept — reconnect to resume.
    </p>
  );
}
