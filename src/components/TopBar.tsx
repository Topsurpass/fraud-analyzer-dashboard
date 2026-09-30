"use client";

import Link from "next/link";
import { formatRelative } from "@/services/format";
import { useEngineHealth } from "@/lib/useEngineHealth";
import { useNow } from "@/lib/useNow";
import { FlaggedBell } from "./FlaggedBell";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Breadcrumb location and the page's own actions. Deliberately not a busy
 * header: the cards below carry per-query status and the rail carries the
 * engine's, so the only thing that always belongs up here is where you are.
 */
export interface Crumb {
  label: string;
  href?: string;
}

export function TopBar({
  crumbs,
  actions,
  onOpenNav,
}: {
  crumbs: Crumb[];
  actions?: React.ReactNode;
  onOpenNav?: () => void;
}) {
  return (
    /*
     * `flex-wrap` and a minimum height rather than a fixed one. A connection
     * page carries four actions plus the flagged bell and the engine readout,
     * which is 418px of controls - they do not fit beside a breadcrumb on a
     * 390px phone, and with everything held on one rigid line the surplus
     * pushed the whole document sideways. Wrapping to a second line costs a row
     * of header on a narrow screen and keeps every action reachable, where
     * hiding some would put "Settings" nowhere and a horizontal scroll would
     * put it somewhere nobody looks.
     */
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-bg/75 px-4 py-2 backdrop-blur-xl sm:flex-nowrap sm:px-6 sm:py-0">
      <button
        type="button"
        onClick={onOpenNav}
        className="-ml-1 grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] text-secondary transition-colors hover:bg-raised hover:text-ink md:hidden"
        aria-label="Open navigation"
      >
        <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
          {[4, 8, 12].map((y) => (
            <line key={y} x1={2} y1={y} x2={14} y2={y} stroke="currentColor" strokeWidth={1.25} />
          ))}
        </svg>
      </button>

      <Breadcrumb crumbs={crumbs} />

      {/* Wraps internally too. On the connection page this row is itself wider
          than a phone, so letting only the header wrap would move the overflow
          down a line rather than removing it. */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap sm:gap-3">
        {actions}
        {/* Always present, on every page: the whole point is not having to go
            and look. */}
        <FlaggedBell />
        <ThemeToggle />
        {/* The rail carries this permanently. Below `md` the rail is a drawer,
            so the readout moves up here rather than being two places at once. */}
        <span className="md:hidden">
          <EngineReadout />
        </span>
      </div>
    </header>
  );
}

function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 text-[13px]">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li
              key={`${crumb.label}-${index}`}
              /* On a phone the actions leave the crumb about 90px, which is not
                 enough for two truncated labels. The ancestors drop out and the
                 page keeps its own name; the rail drawer is the way back up. */
              className={`min-w-0 items-center gap-1.5 ${last ? "flex" : "hidden sm:flex"}`}
            >
              {index > 0 ? (
                <span aria-hidden="true" className="hidden shrink-0 text-line-strong sm:inline">
                  /
                </span>
              ) : null}
              {crumb.href && !last ? (
                <Link
                  href={crumb.href}
                  className="truncate text-muted transition-colors hover:text-ink"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={`truncate ${last ? "text-[17px] font-semibold tracking-tight text-ink" : "text-muted"}`}
                  aria-current={last ? "page" : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function EngineReadout() {
  const { status, message, checkedAt, check } = useEngineHealth();
  const now = useNow(5000);

  // Same four states as the sidebar's engine card, which this stands in for
  // below `md`.
  const label =
    status === "checking"
      ? "checking"
      : status === "ok"
        ? "live"
        : status === "degraded"
          ? "not ready"
          : "unreachable";
  const tone =
    status === "ok"
      ? "bg-live/12 text-live"
      : status === "degraded"
        ? "bg-change/12 text-change"
        : status === "down"
          ? "bg-alert/12 text-alert"
          : "bg-raised text-muted";

  return (
    <button
      type="button"
      onClick={check}
      title={
        message ??
        (checkedAt
          ? `Engine checked ${formatRelative(new Date(checkedAt).toISOString(), now)}`
          : "Check the engine now")
      }
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${tone}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      <span>{label}</span>
    </button>
  );
}
