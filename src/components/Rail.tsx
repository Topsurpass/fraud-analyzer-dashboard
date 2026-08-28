"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDashboards } from "@/services/dashboards";
import { useConnections } from "@/services/connections/ConnectionsContext";
import { useEngineHealth, type EngineStatus } from "@/lib/useEngineHealth";
import { useFlagged } from "@/services/flagged/FlaggedContext";
import { useAuth } from "@/services/auth/AuthContext";
import { AccountChip } from "./auth/AccountChip";
import { FlaggedBadge } from "./FlaggedBadge";
import { StatusDot } from "./StatusDot";

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
  const { can } = useAuth();
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
    <nav aria-label="Primary" className="flex h-full min-h-0 flex-col bg-sunken">
      <Wordmark
        collapsed={collapsed}
        onNavigate={onNavigate}
        onToggleCollapse={onToggleCollapse}
      />

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-1">
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
                          <span className="tnum ml-auto shrink-0 text-[9px] tracking-wider text-muted/70 uppercase">
                            {connection.db_type}
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

        <div className="mx-3 my-2 border-t border-line" />

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
                return (
                  <li key={dashboard.id}>
                    <RailLink
                      href={href}
                      active={pathname === href}
                      onNavigate={onNavigate}
                      collapsed={collapsed}
                      title={`${dashboard.name} (${count} ${count === 1 ? "card" : "cards"})`}
                    >
                      {collapsed ? (
                        <span className="tnum text-[10px]">{count}</span>
                      ) : (
                        <>
                          <span className="truncate">{dashboard.name}</span>
                          <span className="tnum ml-auto shrink-0 text-[10px] text-muted/70">
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
            <div className="mx-3 my-2 border-t border-line" />
            <Section title="Administration" onNavigate={onNavigate} collapsed={collapsed}>
              <ul>
                <li>
                  <RailLink
                    href="/admin/users"
                    active={pathname.startsWith("/admin/users")}
                    onNavigate={onNavigate}
                    collapsed={collapsed}
                    title="People"
                  >
                    <AdminGlyph kind="people" />
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
                    <AdminGlyph kind="log" />
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

/**
 * The wordmark, set as two stacked words in the display face.
 *
 * Stacked rather than on one line because the rail is a narrow column and the
 * two-line block gives the top of the panel a squarer anchor, which the rules
 * below it then hang off.
 */
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
      className={`flex shrink-0 items-start border-b border-line ${
        collapsed ? "justify-center px-1 py-3" : "gap-2 px-3 py-3"
      }`}
    >
      <Link
        href="/"
        onClick={onNavigate}
        title={collapsed ? "Fraud Analyzer" : undefined}
        className="block min-w-0"
      >
        {collapsed ? (
          <span className="display text-[13px] font-medium" aria-label="Fraud Analyzer">
            FA
          </span>
        ) : (
          <>
            <span className="display block text-[15px] leading-[1.1] font-medium tracking-tight">
              FRAUD
              <br />
              ANALYZER
            </span>
            <span className="tnum mt-1 block text-[9px] tracking-[0.18em] text-muted/70 uppercase">
              instrument panel
            </span>
          </>
        )}
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
  const tone = ENGINE_TONE[status];

  if (collapsed) {
    return (
      <div className="shrink-0 border-t border-line p-1">
        <button
          type="button"
          onClick={check}
          title={message ?? `Engine ${label}`}
          aria-label={`Engine ${label}. Check again`}
          className="mx-auto block p-1"
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
    <div className="shrink-0 border-t border-line px-3 py-2">
      <button
        type="button"
        onClick={check}
        title={message ?? "Check the engine now"}
        className="flex w-full items-center gap-2 text-left"
      >
        <EngineDot status={status} />
        <span className="t-eyebrow">Engine</span>
        <span className={`tnum ml-auto text-[10px] ${tone}`}>{label}</span>
      </button>
    </div>
  );
}

/** One word each. `degraded` is the state the two-probe check exists to name. */
const ENGINE_LABEL: Record<EngineStatus, string> = {
  checking: "checking",
  ok: "live",
  degraded: "not ready",
  down: "no answer",
};

const ENGINE_TONE: Record<EngineStatus, string> = {
  checking: "text-muted",
  ok: "text-live",
  degraded: "text-change",
  down: "text-change",
};

function EngineDot({ status }: { status: EngineStatus }) {
  return (
    <svg viewBox="0 0 10 10" width={8} height={8} aria-hidden="true" className="shrink-0">
      <circle
        cx={5}
        cy={5}
        r={3.25}
        fill={status === "ok" ? "var(--signal-live)" : "none"}
        stroke={
          status === "ok"
            ? "var(--signal-live)"
            : status === "degraded"
              ? "var(--signal-change)"
              : "var(--text-muted)"
        }
        strokeWidth={1.25}
      />
      {/* Three shapes, not three colours: a hollow ring is "checking", a half-
          filled ring is "answering but not serving", a cross is "no answer".
          Reading the state must not depend on telling amber from grey. */}
      {status === "degraded" ? (
        <path d="M5 1.75 A3.25 3.25 0 0 1 5 8.25 Z" fill="var(--signal-change)" />
      ) : null}
      {status === "down" ? (
        <line x1={2.2} y1={7.8} x2={7.8} y2={2.2} stroke="var(--signal-change)" strokeWidth={1.25} />
      ) : null}
    </svg>
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
        <rect x={1.5} y={2} width={3.5} height={10} fill="currentColor" opacity={collapsed ? 0.35 : 1} />
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
    <section className="py-1.5">
      {collapsed ? (
        action ? (
          <div className="flex justify-center pb-1">
            <Link
              href={action.href}
              onClick={onNavigate}
              title={`${title}: ${action.label}`}
              aria-label={`${title}: ${action.label}`}
              className="text-[13px] leading-none text-muted transition-colors hover:text-live"
            >
              +
            </Link>
          </div>
        ) : null
      ) : (
        <div className="flex items-center gap-2 px-3 pb-1.5">
          <h2 className="t-eyebrow">{title}</h2>
          {meta ? <span className="tnum text-[10px] text-muted/60">{meta}</span> : null}
          {action ? (
            <Link
              href={action.href}
              onClick={onNavigate}
              className="ml-auto text-[10px] text-muted transition-colors hover:text-live"
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
 * A glyph per admin destination, so the collapsed rail keeps two distinguishable
 * rows instead of two identical dots.
 */
function AdminGlyph({ kind }: { kind: "people" | "log" }) {
  return (
    <svg viewBox="0 0 12 12" width={11} height={11} aria-hidden="true" className="shrink-0">
      {kind === "people" ? (
        <>
          <circle cx={4.5} cy={4} r={2} fill="none" stroke="currentColor" strokeWidth={1.1} />
          <path d="M1.5 10c0-1.7 1.3-2.8 3-2.8s3 1.1 3 2.8" fill="none" stroke="currentColor" strokeWidth={1.1} />
          <path d="M8.5 10c0-1.4-.5-2.3-1.3-2.8" fill="none" stroke="currentColor" strokeWidth={1.1} opacity={0.55} />
        </>
      ) : (
        <>
          <rect x={2} y={1.5} width={8} height={9} rx={1} fill="none" stroke="currentColor" strokeWidth={1.1} />
          <path d="M4 4.5h4M4 6.5h4M4 8.5h2.5" stroke="currentColor" strokeWidth={1.1} />
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
    return <p className="px-3 py-1.5 text-[11px] text-muted">{children}</p>;
  }
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="block px-3 py-1.5 text-[11px] text-muted transition-colors hover:text-live"
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
      className={`mx-2 flex items-center gap-2 rounded-[var(--radius-sm)] py-[7px] text-[12.5px] transition-all duration-[var(--tween-fast)] ${
        collapsed ? "justify-center px-0" : "px-2.5"
      } ${
        active
          ? "bg-accent/12 font-medium text-ink shadow-sm ring-1 ring-accent/25"
          : "text-secondary hover:bg-raised hover:text-ink"
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
          className="h-2.5 bg-line"
          style={{ width: collapsed ? "100%" : `${80 - index * 12}%` }}
        />
      ))}
    </ul>
  );
}
