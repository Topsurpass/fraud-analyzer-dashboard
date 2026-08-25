"use client";

import Link from "next/link";
import { formatRelative } from "@/services/format";
import { useEngineHealth } from "@/lib/useEngineHealth";
import { useNow } from "@/lib/useNow";
import { FlaggedBell } from "./FlaggedBell";

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
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md">
      <button
        type="button"
        onClick={onOpenNav}
        className="-ml-1 shrink-0 rounded-[var(--radius-sm)] p-1.5 text-muted transition-colors hover:bg-raised hover:text-ink md:hidden"
        aria-label="Open navigation"
      >
        <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
          {[4, 8, 12].map((y) => (
            <line key={y} x1={2} y1={y} x2={14} y2={y} stroke="currentColor" strokeWidth={1.25} />
          ))}
        </svg>
      </button>

      <Breadcrumb crumbs={crumbs} />

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {actions}
        {/* Always present, on every page: the whole point is not having to go
            and look. */}
        <FlaggedBell />
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
      <ol className="flex min-w-0 items-center gap-1.5 text-[12px]">
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
                <span aria-hidden="true" className="shrink-0 text-line-strong">
                  ›
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
                  className={`truncate ${last ? "t-page text-ink" : "text-muted"}`}
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

  const label =
    status === "checking" ? "checking" : status === "ok" ? "live" : "unreachable";

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
      className="flex items-center gap-1.5 text-[11px] text-muted transition-colors hover:text-ink"
    >
      <svg viewBox="0 0 10 10" width={8} height={8} aria-hidden="true" className="shrink-0">
        <circle
          cx={5}
          cy={5}
          r={3.25}
          fill={status === "ok" ? "var(--signal-live)" : "none"}
          stroke={status === "ok" ? "var(--signal-live)" : "var(--text-muted)"}
          strokeWidth={1.25}
        />
        {status === "down" ? (
          <line x1={2.2} y1={7.8} x2={7.8} y2={2.2} stroke="var(--text-muted)" strokeWidth={1.25} />
        ) : null}
      </svg>
      <span className="tnum">{label}</span>
    </button>
  );
}
