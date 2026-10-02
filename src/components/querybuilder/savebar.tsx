"use client";

import type { ReactNode } from "react";
import type { ApiError } from "@/services/api-client";
import type { Blocker } from "@/services/querybuilder/model";
import { queryErrorMessage } from "@/components/lists/items";
import { Button } from "@/components/ui";

/**
 * The bar pinned to the bottom of the screen: what is stopping the save, in words a
 * person can act on, and the save itself.
 *
 * The old form had a Save button at the end of a long right-hand column and said
 * nothing when it was pressed with a field missing, so the first sign of a problem
 * was a small red line somewhere off screen. Here every blocker is a button that
 * jumps to the thing to fix, and the dock holding the results sits on top of this
 * bar, so the two are one stack that never leaves the screen.
 */

const MAX_SHOWN = 3;

export function SaveBar({
  blockers,
  warnings,
  dirty,
  busy,
  busyLabel,
  submitLabel,
  error,
  onJump,
  onCancel,
  dock,
}: {
  blockers: Blocker[];
  warnings: Blocker[];
  dirty: boolean;
  busy: boolean;
  busyLabel: string;
  submitLabel: string;
  error?: ApiError | null;
  onJump: (target: string) => void;
  onCancel?: () => void;
  /** The results dock, stacked above the bar. */
  dock?: ReactNode;
}) {
  const shown = blockers.slice(0, MAX_SHOWN);
  const more = blockers.length - shown.length;
  return (
    <div className="sticky bottom-0 z-30 -mx-4 mt-6 border-t border-line bg-surface shadow-[0_-10px_28px_-14px_rgb(0_0_0/0.25)] sm:-mx-6 lg:-mx-8">
      {dock}
      {error ? (
        <p
          role="alert"
          className="border-b border-change/30 bg-change/8 px-4 py-2 text-[13px] text-change sm:px-6 lg:px-8"
        >
          {queryErrorMessage(error)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-0" aria-live="polite">
          {blockers.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="text-[12.5px] font-medium text-change">
                {blockers.length === 1 ? "One thing to fix before saving:" : `${blockers.length} things to fix before saving:`}
              </span>
              <span className="sr-only">Things to fix</span>
              {shown.map((blocker, position) => (
                <button
                  key={`${blocker.target}:${blocker.text}`}
                  type="button"
                  onClick={() => onJump(blocker.target)}
                  className={`min-w-0 max-w-full text-left sm:truncate ${position > 0 ? "" : ""} rounded-full border border-change/40 bg-change/8 px-2.5 py-0.5 text-[12px] font-medium text-change transition-colors hover:bg-change/15`}
                >
                  {blocker.text}
                </button>
              ))}
              {more > 0 ? <span className="text-[12px] text-muted">and {more} more</span> : null}

            </div>
          ) : warnings.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] text-muted">
              <span className="font-medium text-secondary">Heads up:</span>
              <button
                type="button"
                onClick={() => onJump(warnings[0].target)}
                className="max-w-full truncate rounded-full border border-line-strong px-2.5 py-0.5 text-[12px] text-secondary transition-colors hover:bg-raised"
              >
                {warnings[0].text}
              </button>
              <span>It still saves.</span>
            </div>
          ) : dirty ? (
            <span className="inline-flex items-center gap-2 text-[12.5px] text-secondary">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-change" />
              Unsaved changes. Ready to save.
            </span>
          ) : (
            <span className="text-[12.5px] text-muted">No changes yet.</span>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {onCancel ? (
            <Button type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" tone="primary" disabled={busy}>
            {busy ? busyLabel : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
