"use client";

import { Button } from "./ui";

/**
 * Result of a connection test.
 *
 * A failure keeps the connection - the engine saved it either way - and says so
 * plainly, including the engine's own error code, because "connection refused"
 * and "password authentication failed" need very different fixes.
 */
export function TestOutcome({
  ok,
  error,
  errorCode,
  testedAt,
  onOpen,
}: {
  ok: boolean;
  error?: string | null;
  errorCode?: string | null;
  testedAt?: string | null;
  onOpen?: () => void;
}) {
  if (ok) {
    return (
      <p className="border border-live/40 bg-live/5 px-3 py-2 text-[12px] text-live">
        Connected.
        {testedAt ? <span className="tnum text-muted"> {testedAt}</span> : null}
      </p>
    );
  }

  return (
    <div className="border border-change/40 bg-change/5 px-3 py-2">
      <p className="text-[12px] text-change">
        The connection was saved but the engine could not reach it.
      </p>
      {error ? <p className="tnum mt-1 text-[11px] text-muted">{error}</p> : null}
      {errorCode ? (
        <p className="tnum mt-0.5 text-[10px] tracking-wide text-muted uppercase">{errorCode}</p>
      ) : null}
      {onOpen ? (
        <Button className="mt-2" onClick={onOpen}>
          Open it anyway
        </Button>
      ) : null}
    </div>
  );
}
