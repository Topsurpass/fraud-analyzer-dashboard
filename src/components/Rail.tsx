"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDashboards } from "@/services/dashboards";
import { useConnections } from "@/services/connections/ConnectionsContext";
import { StatusDot } from "./StatusDot";

/**
 * The persistent left rail. This *is* the app's navigation - always visible on
 * desktop, never behind a hamburger, as the design brief requires. On small
 * screens the same component is rendered inside a drawer by `AppShell`.
 */
export function Rail({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { connections, initial, error } = useConnections();
  const { dashboards, hydrated } = useDashboards();

  return (
    <nav aria-label="Primary" className="flex h-full min-h-0 flex-col bg-sunken">
      <div className="shrink-0 border-b border-line px-3 py-3">
        <Link
          href="/"
          onClick={onNavigate}
          className="display block text-[13px] leading-tight font-medium tracking-tight"
        >
          FRAUD
          <br />
          ANALYZER
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Connections" action={{ href: "/connections/new", label: "+ New" }} onNavigate={onNavigate}>
          {initial ? (
            <RailSkeleton rows={3} />
          ) : error ? (
            <p className="px-3 py-1.5 text-[11px] text-muted">
              Engine unreachable
            </p>
          ) : connections.length === 0 ? (
            <p className="px-3 py-1.5 text-[11px] text-muted">No connections yet</p>
          ) : (
            <ul>
              {connections.map((connection) => {
                const href = `/connections/${connection.id}`;
                return (
                  <li key={connection.id}>
                    <RailLink
                      href={href}
                      active={pathname.startsWith(href)}
                      onNavigate={onNavigate}
                    >
                      <StatusDot status={connection.status} />
                      <span className="truncate">{connection.name}</span>
                    </RailLink>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <div className="mx-3 my-1 border-t border-line" />

        <Section title="Dashboards" action={{ href: "/dashboards/new", label: "+ New" }} onNavigate={onNavigate}>
          {!hydrated ? (
            <RailSkeleton rows={2} />
          ) : dashboards.length === 0 ? (
            <p className="px-3 py-1.5 text-[11px] text-muted">No dashboards yet</p>
          ) : (
            <ul>
              {dashboards.map((dashboard) => {
                const href = `/dashboards/${dashboard.id}`;
                return (
                  <li key={dashboard.id}>
                    <RailLink
                      href={href}
                      active={pathname === href}
                      onNavigate={onNavigate}
                    >
                      <span className="truncate">{dashboard.name}</span>
                      <span className="tnum ml-auto shrink-0 text-[10px] text-muted">
                        {dashboard.queryIds.length}
                      </span>
                    </RailLink>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </nav>
  );
}

function Section({
  title,
  action,
  children,
  onNavigate,
}: {
  title: string;
  action: { href: string; label: string };
  children: React.ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <section className="py-2">
      <div className="flex items-center justify-between px-3 pb-1">
        <h2 className="text-[10px] font-medium tracking-widest text-muted uppercase">
          {title}
        </h2>
        <Link
          href={action.href}
          onClick={onNavigate}
          className="text-[10px] text-muted transition-colors hover:text-live"
        >
          {action.label}
        </Link>
      </div>
      {children}
    </section>
  );
}

function RailLink({
  href,
  active,
  children,
  onNavigate,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 border-l-2 py-1.5 pr-3 pl-[10px] text-[12px] transition-colors ${
        active
          ? "border-live bg-surface text-ink"
          : "border-transparent text-muted hover:bg-surface/60 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function RailSkeleton({ rows }: { rows: number }) {
  return (
    <ul className="skeleton-sweep space-y-1.5 px-3 py-1.5">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="h-2.5 bg-line" style={{ width: `${80 - index * 12}%` }} />
      ))}
    </ul>
  );
}
