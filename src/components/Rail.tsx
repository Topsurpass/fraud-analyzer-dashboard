"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDashboards } from "@/services/dashboards";
import { useConnections } from "@/services/connections/ConnectionsContext";
import { StatusDot } from "./StatusDot";

/**
 * The persistent left rail.
 *
 * Collapses to a 48px strip rather than disappearing: an instrument panel
 * should not lose its connection status lights just because the analyst wanted
 * more room for charts, so the collapsed form keeps every status dot and drops
 * only the labels.
 */
export function Rail({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const { connections, initial, error } = useConnections();
  const { dashboards, hydrated } = useDashboards();

  return (
    <nav
      aria-label="Primary"
      className="flex h-full min-h-0 flex-col bg-sunken"
    >
      <div
        className={`flex shrink-0 items-start border-b border-line py-3 ${collapsed ? "justify-center px-1" : "gap-1 px-3"}`}
      >
        <Link
          href="/"
          onClick={onNavigate}
          title={collapsed ? "Fraud Analyzer" : undefined}
          className="display block min-w-0 text-[13px] leading-tight font-medium tracking-tight"
        >
          {collapsed ? (
            <span aria-label="Fraud Analyzer">FA</span>
          ) : (
            <>
              FRAUD
              <br />
              ANALYZER
            </>
          )}
        </Link>

        {onToggleCollapse && !collapsed ? (
          <CollapseButton collapsed={collapsed} onClick={onToggleCollapse} className="ml-auto" />
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <Section
          title="Connections"
          action={{ href: "/connections/new", label: "+ New" }}
          onNavigate={onNavigate}
          collapsed={collapsed}
        >
          {initial ? (
            <RailSkeleton rows={3} collapsed={collapsed} />
          ) : error ? (
            collapsed ? null : (
              <p className="px-3 py-1.5 text-[11px] text-muted">Engine unreachable</p>
            )
          ) : connections.length === 0 ? (
            collapsed ? null : (
              <p className="px-3 py-1.5 text-[11px] text-muted">No connections yet</p>
            )
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
                      collapsed={collapsed}
                      title={connection.name}
                    >
                      <StatusDot status={connection.status} />
                      {collapsed ? null : <span className="truncate">{connection.name}</span>}
                    </RailLink>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <div className="mx-3 my-1 border-t border-line" />

        <Section
          title="Dashboards"
          action={{ href: "/dashboards/new", label: "+ New" }}
          onNavigate={onNavigate}
          collapsed={collapsed}
        >
          {!hydrated ? (
            <RailSkeleton rows={2} collapsed={collapsed} />
          ) : dashboards.length === 0 ? (
            collapsed ? null : (
              <p className="px-3 py-1.5 text-[11px] text-muted">No dashboards yet</p>
            )
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
                      collapsed={collapsed}
                      title={`${dashboard.name} (${dashboard.queryIds.length})`}
                    >
                      {collapsed ? (
                        <span className="tnum text-[10px]">{dashboard.queryIds.length}</span>
                      ) : (
                        <>
                          <span className="truncate">{dashboard.name}</span>
                          <span className="tnum ml-auto shrink-0 text-[10px] text-muted">
                            {dashboard.queryIds.length}
                          </span>
                        </>
                      )}
                    </RailLink>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>

      {onToggleCollapse && collapsed ? (
        <div className="shrink-0 border-t border-line p-1">
          <CollapseButton collapsed={collapsed} onClick={onToggleCollapse} className="mx-auto" />
        </div>
      ) : null}
    </nav>
  );
}

function CollapseButton({
  collapsed,
  onClick,
  className,
}: {
  collapsed: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className={`block shrink-0 p-1 text-muted transition-colors hover:text-live ${className ?? ""}`}
    >
      <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
        <rect
          x={1.5}
          y={2}
          width={11}
          height={10}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
        />
        {/* The filled column shows which side the panel is on. */}
        <rect
          x={collapsed ? 1.5 : 1.5}
          y={2}
          width={3.5}
          height={10}
          fill="currentColor"
          opacity={collapsed ? 0.35 : 1}
        />
      </svg>
    </button>
  );
}

function Section({
  title,
  action,
  children,
  onNavigate,
  collapsed,
}: {
  title: string;
  action: { href: string; label: string };
  children: React.ReactNode;
  onNavigate?: () => void;
  collapsed: boolean;
}) {
  return (
    <section className="py-2">
      {collapsed ? (
        <div className="flex justify-center pb-1">
          <Link
            href={action.href}
            onClick={onNavigate}
            title={`${title}: ${action.label}`}
            aria-label={`${title}: ${action.label}`}
            className="text-[11px] text-muted transition-colors hover:text-live"
          >
            +
          </Link>
        </div>
      ) : (
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
      )}
      {children}
    </section>
  );
}

function RailLink({
  href,
  active,
  children,
  onNavigate,
  collapsed,
  title,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  onNavigate?: () => void;
  collapsed: boolean;
  title?: string;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed ? title : undefined}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 border-l-2 py-1.5 text-[12px] transition-colors ${
        collapsed ? "justify-center px-0" : "pr-3 pl-[10px]"
      } ${
        active
          ? "border-live bg-surface text-ink"
          : "border-transparent text-muted hover:bg-surface/60 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function RailSkeleton({ rows, collapsed }: { rows: number; collapsed: boolean }) {
  return (
    <ul className={`skeleton-sweep space-y-1.5 py-1.5 ${collapsed ? "px-3" : "px-3"}`}>
      {Array.from({ length: rows }, (_, index) => (
        <li
          key={index}
          className="h-2.5 bg-line"
          style={{ width: collapsed ? "100%" : `${80 - index * 12}%` }}
        />
      ))}
    </ul>
  );
}
