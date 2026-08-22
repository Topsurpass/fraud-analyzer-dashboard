"use client";

import Link from "next/link";
import { formatRelative } from "@/services/format";
import { useEngineHealth } from "@/lib/useEngineHealth";
import { useNow } from "@/lib/useNow";

/**
 * Breadcrumb location plus one global engine readout. Deliberately not a busy
 * header: the cards below carry per-query status, so the only thing that
 * belongs up here is where you are and whether the engine is answering at all.
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
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-bg px-3">
      <button
        type="button"
        onClick={onOpenNav}
        className="-ml-1 shrink-0 p-1 text-muted transition-colors hover:text-ink md:hidden"
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
        <EngineReadout />
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
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
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
                  className={`truncate ${last ? "text-ink" : "text-muted"}`}
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
