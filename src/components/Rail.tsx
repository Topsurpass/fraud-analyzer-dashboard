"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ownerLabel, useDashboards } from "@/services/dashboards";
import { useConnections } from "@/services/connections/ConnectionsContext";
import { useEngineHealth, type EngineStatus } from "@/lib/useEngineHealth";
import { useFlagged } from "@/services/flagged/FlaggedContext";
import { useAuth } from "@/services/auth/AuthContext";
import { usePublishRequests } from "@/services/publishing/PublishRequestsContext";
import { AccountChip } from "./auth/AccountChip";
import { FlaggedBadge } from "./FlaggedBadge";
import { StatusDot } from "./StatusDot";
import { Wordmark as Brand } from "./Logo";

/**
 * The persistent left rail.
 *
 * At 256px it is wide enough to be a status panel rather than a list of links:
 * every connection shows what kind of database it is alongside whether it last
 * answered, every dashboard shows how many cards are on it, and the foot of the
 * rail carries the engine's own state. That is the point of the width - a rail
 * that only holds names does not need it.
 *
 * Collapsed it becomes a 56px strip rather than disappearing. An instrument
 * panel should not lose its status lights just because the analyst wanted more
 * room for charts, so the collapsed form keeps every dot and drops only labels.
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
  const { dashboards, initial: dashboardsLoading } = useDashboards();
  const flagged = useFlagged();
  const pendingRequests = usePublishRequests();
  const { can, user } = useAuth();
  /*
   * An analyst queries these databases but never adds one, so the "+ New" affordance
   * is absent rather than disabled. A disabled control in a nav rail is a
   * permanent reminder of something you will never be allowed to do; the admin
   * section below is absent for the same reason.
   */
  const mayAddConnection = can("connections.create");
  const mayAdminister = can("users.manage");

  const liveCount = connections.filter((connection) => connection.status === "ok").length;

  return (
    <nav aria-label="Primary" className="flex h-full min-h-0 flex-col bg-[var(--sidebar-bg)]">
      <Wordmark
        collapsed={collapsed}
        onNavigate={onNavigate}
        onToggleCollapse={onToggleCollapse}
      />

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1 py-2">
        <ul className="pb-1">
          <li>
            <RailLink
              href="/"
              active={pathname === "/"}
              onNavigate={onNavigate}
              collapsed={collapsed}
              title="Overview"
            >
              <NavGlyph kind="overview" />
              {collapsed ? null : <span className="truncate">Overview</span>}
            </RailLink>
          </li>
          <li>
            <RailLink
              href="/lists"
              active={pathname.startsWith("/lists")}
              onNavigate={onNavigate}
              collapsed={collapsed}
              title="Lists"
            >
              <NavGlyph kind="lists" />
              {collapsed ? null : <span className="truncate">Lists</span>}
            </RailLink>
          </li>
        </ul>
        <Section
          title="Connections"
          /* The count is the reason to look here at all: how many of the
             analyst's databases are actually answering right now. */
          meta={
            connections.length > 0 ? `${liveCount}/${connections.length}` : null
          }
          action={mayAddConnection ? { href: "/connections/new", label: "New" } : undefined}
          onNavigate={onNavigate}
          collapsed={collapsed}
        >
          {initial ? (
            <RailSkeleton rows={3} collapsed={collapsed} />
          ) : error ? (
            <RailNote collapsed={collapsed}>Engine unreachable</RailNote>
          ) : connections.length === 0 ? (
            <RailNote
              collapsed={collapsed}
              href={mayAddConnection ? "/connections/new" : undefined}
              onNavigate={onNavigate}
            >
              {mayAddConnection ? "Connect a database" : "No connections yet"}
            </RailNote>
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
                      title={`${connection.name} · ${connection.db_type} · ${connection.status}`}
                    >
                      <StatusDot status={connection.status} />
                      {collapsed ? null : (
                        <>
                          <span className="truncate">{connection.name}</span>
                          <FlaggedBadge
                            count={flagged.countForConnection(connection.id)}
                            severity={flagged.severityForConnection(connection.id)}
                          />
                        </>
                      )}
                    </RailLink>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

                <Section
          title="Dashboards"
          meta={dashboards.length > 0 ? String(dashboards.length) : null}
          action={{ href: "/dashboards/new", label: "New" }}
          onNavigate={onNavigate}
          collapsed={collapsed}
        >
          {dashboardsLoading ? (
            <RailSkeleton rows={2} collapsed={collapsed} />
          ) : dashboards.length === 0 ? (
            <RailNote collapsed={collapsed} href="/dashboards/new" onNavigate={onNavigate}>
              Build your first board
            </RailNote>
          ) : (
            <ul>
              {dashboards.map((dashboard) => {
                const href = `/dashboards/${dashboard.id}`;
                const count = dashboard.chart_ids.length;
                /*
                 * An admin's rail holds every board on the instance, and board
                 * names do not identify their owner. Own boards stay bare -
                 * that is most of an analyst's list, and "you" is not news.
                 */
                const owner = ownerLabel(dashboard, user?.id ?? null);
                return (
                  <li key={dashboard.id}>
                    <RailLink
                      href={href}
                      active={pathname === href}
                      onNavigate={onNavigate}
                      collapsed={collapsed}
                      title={
                        owner
                          ? `${dashboard.name} - ${owner} (${count} ${count === 1 ? "card" : "cards"})`
                          : `${dashboard.name} (${count} ${count === 1 ? "card" : "cards"})`
                      }
                    >
                      {collapsed ? (
                        <span className="tnum text-[10px]">{count}</span>
                      ) : (
                        <>
                          {/*
                           * Name over owner rather than side by side: at 256px
                           * one line holding both truncates both, and the name
                           * is what you scan for once you know the owner.
                           */}
                          <NavGlyph kind="overview" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{dashboard.name}</span>
                            {owner ? (
                              <span className="block truncate text-[11px] leading-tight text-muted">
                                {owner}
                              </span>
                            ) : null}
                          </span>
                          <span className="tnum ml-auto shrink-0 text-[11px] text-muted">
                            {count}
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

        {mayAdminister ? (
          <>
            
            <Section title="Administration" onNavigate={onNavigate} collapsed={collapsed}>
              <ul>
                <li>
                  <RailLink
                    href="/approvals"
                    active={pathname.startsWith("/approvals")}
                    onNavigate={onNavigate}
                    collapsed={collapsed}
                    title={
                      pendingRequests.count > 0
                        ? `Approvals, ${pendingRequests.count} waiting`
                        : "Approvals"
                    }
                  >
                    <NavGlyph kind="approvals" />
                    {collapsed ? null : <span className="truncate">Approvals</span>}
                    {pendingRequests.count > 0 ? (
                      // A count, not a colour: it is a to-do list length. Never
                      // --signal-alert, which means a rule matched a row.
                      <span
                        className={`tnum rounded-full bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-white ${
                          collapsed ? "absolute top-0.5 right-1.5" : "ml-auto"
                        }`}
                        aria-label={`${pendingRequests.count} waiting`}
                      >
                        {pendingRequests.count > 99 ? "99+" : pendingRequests.count}
                      </span>
                    ) : null}
                  </RailLink>
                </li>
                <li>
                  <RailLink
                    href="/admin/users"
                    active={pathname.startsWith("/admin/users")}
                    onNavigate={onNavigate}
                    collapsed={collapsed}
                    title="People"
                  >
                    <NavGlyph kind="people" />
                    {collapsed ? null : <span className="truncate">People</span>}
                  </RailLink>
                </li>
                <li>
                  <RailLink
                    href="/admin/audit-log"
                    active={pathname.startsWith("/admin/audit-log")}
                    onNavigate={onNavigate}
                    collapsed={collapsed}
                    title="Audit log"
                  >
                    <NavGlyph kind="log" />
                    {collapsed ? null : <span className="truncate">Audit log</span>}
                  </RailLink>
                </li>
              </ul>
            </Section>
          </>
        ) : null}
      </div>

      <AccountChip collapsed={collapsed} onNavigate={onNavigate} />
      <EngineFoot collapsed={collapsed} onToggleCollapse={onToggleCollapse} />
    </nav>
  );
}

function Wordmark({
  collapsed,
  onNavigate,
  onToggleCollapse,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
  onToggleCollapse?: () => void;
}) {
  return (
    <div
      className={`flex h-16 shrink-0 items-center ${
        collapsed ? "justify-center px-1" : "gap-2 px-4"
      }`}
    >
      <Link
        href="/"
        onClick={onNavigate}
        title={collapsed ? "Fraud Analyzer" : undefined}
        aria-label="Fraud Analyzer"
        className="block min-w-0"
      >
        <Brand compact={collapsed} />
      </Link>

      {onToggleCollapse && !collapsed ? (
        <CollapseButton collapsed={collapsed} onClick={onToggleCollapse} className="ml-auto" />
      ) : null}
    </div>
  );
}

/**
 * The engine's own state, at the foot of the rail.
 *
 * Every card on the grid reports whether *its* query is moving; none of them
 * says whether the engine is reachable at all, which is the difference between
 * "nothing is happening" and "nothing is being asked". That belongs on the
 * panel permanently, not in a toast.
 */
function EngineFoot({
  collapsed,
  onToggleCollapse,
}: {
  collapsed: boolean;
  onToggleCollapse?: () => void;
}) {
  const { status, message, check } = useEngineHealth();

  /* Four states, because "up but cannot serve" needs different people from
     "nothing answered" - see useEngineHealth. */
  const label = ENGINE_LABEL[status];

  if (collapsed) {
    return (
      <div className="shrink-0 space-y-1 p-2">
        <button
          type="button"
          onClick={check}
          title={message ?? `Engine ${label}`}
          aria-label={`Engine ${label}. Check again`}
          className="mx-auto grid size-9 place-items-center rounded-[var(--radius-sm)] hover:bg-raised"
        >
          <EngineDot status={status} />
        </button>
        {onToggleCollapse ? (
          <CollapseButton collapsed onClick={onToggleCollapse} className="mx-auto" />
        ) : null}
      </div>
    );
  }

  return (
    <div className="shrink-0 px-3 pb-2">
      <button
        type="button"
        onClick={check}
        title={message ?? "Check the engine now"}
        className="flex w-full items-center gap-2.5 rounded-[var(--radius)] border border-line bg-sunken px-3 py-2.5 text-left transition-colors hover:border-line-strong"
      >
        <EngineDot status={status} />
        <span className="min-w-0">
          <span className="block text-[12px] font-medium text-ink">Detection engine</span>
          <span className="block text-[11px] text-muted">Click to re-check</span>
        </span>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL[status]}`}
        >
          {label}
        </span>
      </button>
    </div>
  );
}

const PILL: Record<EngineStatus, string> = {
  checking: "bg-raised text-muted",
  ok: "bg-live/12 text-live",
  degraded: "bg-change/12 text-change",
  down: "bg-alert/12 text-alert",
};

/** One word each. `degraded` is the state the two-probe check exists to name. */
const ENGINE_LABEL: Record<EngineStatus, string> = {
  checking: "checking",
  ok: "live",
  degraded: "not ready",
  down: "no answer",
};

function EngineDot({ status }: { status: EngineStatus }) {
  const color =
    status === "ok"
      ? "text-live"
      : status === "degraded"
        ? "text-change"
        : status === "down"
          ? "text-alert"
          : "text-muted";
  return (
    // Status is also in words beside it; the dot only reinforces it. The ring
    // animates for "live" so a stalled engine is visibly different.
    <span aria-hidden="true" className={`relative grid size-2.5 shrink-0 place-items-center ${color}`}>
      <span
        className={`absolute inset-0 rounded-full ${status === "ok" ? "beacon" : ""}`}
      />
      <span className="relative size-2.5 rounded-full bg-current" />
    </span>
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
      className={`grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] text-muted transition-colors hover:bg-raised hover:text-ink ${className ?? ""}`}
    >
      <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
        <rect x={2} y={2.5} width={12} height={11} rx={2.5} />
        <path d="M6.2 2.8v10.4" />
        {collapsed ? <path d="m9.4 6.4 1.6 1.6-1.6 1.6" strokeLinecap="round" /> : <path d="M10.8 6.4 9.2 8l1.6 1.6" strokeLinecap="round" />}
      </svg>
    </button>
  );
}

function Section({
  title,
  meta,
  action,
  children,
  onNavigate,
  collapsed,
}: {
  title: string;
  meta?: string | null;
  /** Omitted when the signed-in role cannot create one of these. */
  action?: { href: string; label: string };
  children: React.ReactNode;
  onNavigate?: () => void;
  collapsed: boolean;
}) {
  return (
    <section className="py-2">
      {collapsed ? (
        action ? (
          <div className="flex justify-center pb-1">
            <Link
              href={action.href}
              onClick={onNavigate}
              title={`${title}: ${action.label}`}
              aria-label={`${title}: ${action.label}`}
              className="grid size-6 place-items-center rounded-md text-[14px] leading-none text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              +
            </Link>
          </div>
        ) : null
      ) : (
        <div className="flex items-center gap-2 px-3 pb-1.5">
          <h2 className="t-eyebrow">{title}</h2>
          {meta ? (
            <span className="tnum rounded-full bg-raised px-1.5 text-[10.5px] font-medium text-muted">
              {meta}
            </span>
          ) : null}
          {action ? (
            <Link
              href={action.href}
              onClick={onNavigate}
              className="ml-auto rounded-md px-1.5 py-0.5 text-[12px] font-medium text-accent transition-colors hover:bg-accent-soft"
            >
              + {action.label}
            </Link>
          ) : null}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Glyphs for the nav, so the collapsed rail keeps distinguishable rows instead
 * of identical dots. 16px, 1.5 stroke, currentColor.
 */
function NavGlyph({ kind }: { kind: "overview" | "lists" | "people" | "log" | "approvals" }) {
  return (
    <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" className="shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {kind === "overview" ? (
        <>
          <rect x={2} y={2} width={5} height={6} rx={1.4} />
          <rect x={9} y={2} width={5} height={3.5} rx={1.4} />
          <rect x={9} y={7.5} width={5} height={6.5} rx={1.4} />
          <rect x={2} y={10} width={5} height={4} rx={1.4} />
        </>
      ) : kind === "lists" ? (
        <>
          <path d="M6 4h7.5M6 8h7.5M6 12h7.5" />
          <path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
        </>
      ) : kind === "approvals" ? (
        <>
          <rect x={2.5} y={2.5} width={11} height={11} rx={2.6} />
          <path d="M5.4 8.2 7.2 10l3.4-3.8" />
        </>
      ) : kind === "people" ? (
        <>
          <circle cx={6} cy={5.5} r={2.4} />
          <path d="M1.8 13.5c.2-2.3 1.9-3.6 4.2-3.6s4 1.3 4.2 3.6" />
          <path d="M10.8 3.4a2.3 2.3 0 0 1 0 4.2M12.6 10.3c1 .6 1.6 1.6 1.7 3.2" />
        </>
      ) : (
        <>
          <rect x={3} y={1.8} width={10} height={12.4} rx={2} />
          <path d="M5.6 5.6h4.8M5.6 8h4.8M5.6 10.4h2.8" />
        </>
      )}
    </svg>
  );
}

/**
 * An empty section is a place to act, not a place to be told nothing is there,
 * so the note is the link that fixes it.
 */
function RailNote({
  children,
  collapsed,
  href,
  onNavigate,
}: {
  children: React.ReactNode;
  collapsed: boolean;
  href?: string;
  onNavigate?: () => void;
}) {
  if (collapsed) return null;
  if (!href) {
    return <p className="px-4 py-1.5 text-[12px] text-muted">{children}</p>;
  }
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="mx-2 block rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[12px] text-accent transition-colors hover:bg-accent-soft"
    >
      {children}
    </Link>
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
      /* A filled pill rather than a left rule: the accent marks "you are here",
         which is interaction, and must not borrow the signal vocabulary that
         means "this data is alive". */
      className={`relative mx-2 flex items-center gap-2.5 rounded-[var(--radius-sm)] py-2 text-[13px] transition-colors duration-[var(--tween-fast)] ${
        collapsed ? "justify-center px-0" : "px-2.5"
      } ${
        active
          ? "bg-accent-soft font-semibold text-accent"
          : "font-medium text-secondary hover:bg-raised hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function RailSkeleton({ rows, collapsed }: { rows: number; collapsed: boolean }) {
  return (
    <ul className="skeleton-sweep space-y-1.5 px-3 py-1.5">
      {Array.from({ length: rows }, (_, index) => (
        <li
          key={index}
          className="h-3 rounded-md bg-raised"
          style={{ width: collapsed ? "100%" : `${80 - index * 12}%` }}
        />
      ))}
    </ul>
  );
}
