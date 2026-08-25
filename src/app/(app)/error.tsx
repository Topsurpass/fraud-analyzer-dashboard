"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

/**
 * The last line of defence for a page that throws while rendering.
 *
 * There was no boundary at all before this, so a render failure took the whole
 * segment down with nothing on screen and nothing in the UI to recover from -
 * indistinguishable, from the reader's side, from a page that simply never
 * finished loading.
 *
 * The message is deliberately shown rather than swallowed. The engine's own
 * failures are already reported by the surfaces that call it; anything reaching
 * here is a bug in this app, and hiding it only makes it harder to report.
 */
export default function SegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page failed to render:", error);
  }, [error]);

  return (
    <div className="flex h-full min-h-0 items-center justify-center p-6">
      <div className="max-w-md rounded-[var(--radius)] border border-alert/30 bg-surface p-6 shadow-sm">
        <p className="t-section text-ink">This page could not be displayed</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          Something in the dashboard failed while drawing this screen. Your
          saved queries, rules and findings are stored on the engine and are
          unaffected.
        </p>
        {error.message ? (
          <p className="tnum mt-3 max-h-24 overflow-auto rounded-[var(--radius-sm)] border border-line bg-sunken px-2.5 py-2 text-[11.5px] text-secondary">
            {error.message}
          </p>
        ) : null}
        <div className="mt-4 flex items-center gap-2">
          <Button type="button" tone="primary" onClick={reset}>
            Try again
          </Button>
          <Button type="button" onClick={() => window.location.reload()}>
            Reload the page
          </Button>
        </div>
      </div>
    </div>
  );
}
