"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/services/api-client";
import { useDashboards } from "@/services/dashboards";
import { Popover, usePopoverClose } from "./Popover";

/**
 * Put a saved query on a dashboard.
 *
 * Built on `Popover`, so it closes on a choice, on an outside click and on
 * Escape. Every item here writes to the engine, so every item can fail, and a
 * click that quietly did nothing would read as the app being broken. Failures
 * are named in the popover, which is also why the menu only dismisses itself
 * once the write has actually landed.
 */
export function AddToDashboardMenu({ chartId }: { chartId: string }) {
  return (
    <Popover
      label="Add to dashboard"
      title="Add to dashboard"
      trigger={<span aria-hidden="true">+</span>}
      triggerClassName="grid size-7 cursor-pointer list-none place-items-center rounded-md text-[15px] leading-none text-muted transition-colors hover:bg-raised hover:text-ink"
      panelClassName="w-56 rounded-[var(--radius)] border border-line bg-surface py-1.5 shadow-lg"
    >
      <AddToDashboardPanel chartId={chartId} />
    </Popover>
  );
}

/** Inside the popover, so it can reach `usePopoverClose`. */
function AddToDashboardPanel({ chartId }: { chartId: string }) {
  const close = usePopoverClose();
  const { dashboards, addChartTo, removeChartFrom, create } = useDashboards();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dismiss only once the engine has taken the change; a failure has to stay on
  // screen, and this panel is where it is shown.
  const attempt = async (fallback: string, action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    let ok = false;
    try {
      await action();
      ok = true;
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.displayMessage : fallback);
    } finally {
      setBusy(false);
    }
    if (ok) close();
  };

  return (
    <>
        <p className="px-2.5 pt-1 pb-1.5 text-[11.5px] tracking-widest text-muted uppercase">
          Dashboards
        </p>

        {dashboards.length === 0 ? (
          <p className="px-2.5 pb-1.5 text-[12.5px] text-muted">None yet</p>
        ) : (
          <ul>
            {dashboards.map((dashboard) => {
              const present = dashboard.chart_ids.includes(chartId);
              return (
                <li key={dashboard.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      attempt(
                        present
                          ? "Could not take it off that dashboard"
                          : "Could not add it to that dashboard",
                        () =>
                          present
                            ? removeChartFrom(dashboard.id, chartId)
                            : addChartTo(dashboard.id, chartId),
                      )
                    }
                    className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-[13px] text-muted transition-colors disabled:opacity-40 hover:bg-surface hover:text-ink"
                  >
                    <span
                      aria-hidden="true"
                      className="tnum w-3 shrink-0 text-live"
                    >
                      {present ? "×" : ""}
                    </span>
                    <span className="truncate">{dashboard.name}</span>
                    <span className="sr-only">
                      {present ? "Remove from" : "Add to"} {dashboard.name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-1 border-t border-line pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              attempt("Could not create the dashboard", async () => {
                const dashboard = await create("New dashboard", [chartId]);
                router.push(`/dashboards/${dashboard.id}`);
              })
            }
            className="w-full px-2.5 py-1 text-left text-[13px] text-live transition-colors disabled:opacity-40 hover:bg-surface"
          >
            + New dashboard
          </button>
        </div>

        {error ? (
          <p className="px-2.5 pt-1.5 text-[11.5px] leading-snug text-change">{error}</p>
        ) : null}
    </>
  );
}
