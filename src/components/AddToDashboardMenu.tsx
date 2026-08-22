"use client";

import { useRouter } from "next/navigation";
import { useDashboards } from "@/services/dashboards";

/**
 * Put a saved query on a dashboard.
 *
 * Built on `<details>` so the popover is keyboard-operable and dismissible
 * without a focus trap of our own. Dashboards live in this browser only, which
 * the menu says outright rather than letting the analyst assume otherwise.
 */
export function AddToDashboardMenu({ queryId }: { queryId: string }) {
  const { dashboards, addQueryTo, removeQueryFrom, create } = useDashboards();
  const router = useRouter();

  return (
    <details className="relative">
      <summary
        className="cursor-pointer list-none px-1 text-[13px] leading-none text-muted transition-colors hover:text-live"
        aria-label="Add to dashboard"
        title="Add to dashboard"
      >
        <span aria-hidden="true">+</span>
      </summary>

      <div className="absolute top-full right-0 z-30 mt-1 w-52 border border-line-strong bg-raised py-1">
        <p className="px-2.5 pt-1 pb-1.5 text-[10px] tracking-widest text-muted uppercase">
          Dashboards
        </p>

        {dashboards.length === 0 ? (
          <p className="px-2.5 pb-1.5 text-[11px] text-muted">None yet</p>
        ) : (
          <ul>
            {dashboards.map((dashboard) => {
              const present = dashboard.queryIds.includes(queryId);
              return (
                <li key={dashboard.id}>
                  <button
                    type="button"
                    onClick={() =>
                      present
                        ? removeQueryFrom(dashboard.id, queryId)
                        : addQueryTo(dashboard.id, queryId)
                    }
                    className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-[12px] text-muted transition-colors hover:bg-surface hover:text-ink"
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
            onClick={() => {
              const dashboard = create("New dashboard", [queryId]);
              router.push(`/dashboards/${dashboard.id}`);
            }}
            className="w-full px-2.5 py-1 text-left text-[12px] text-live transition-colors hover:bg-surface"
          >
            + New dashboard
          </button>
        </div>

        <p className="px-2.5 pt-1.5 text-[10px] leading-snug text-muted">
          Saved in this browser only.
        </p>
      </div>
    </details>
  );
}
