/**
 * Dashboards: named, ordered collections of saved queries.
 *
 * The engine has no dashboard resource - it models connections and saved
 * queries only - so a dashboard is a client-side arrangement over query ids and
 * lives in localStorage. That has one real consequence worth being honest about
 * in the UI: dashboards are per-browser and do not follow the analyst to
 * another machine. Everything they contain (the queries, the SQL, the results)
 * is server-side and shared; only the grouping is local.
 *
 * All functions here are pure over an explicit state value. Persistence and
 * React live in `useDashboards`.
 */

export const STORAGE_KEY = "fraud-analyzer.dashboards.v1";

export interface Dashboard {
  id: string;
  name: string;
  /** Saved-query ids, in display order. May span connections. */
  queryIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DashboardState {
  version: 1;
  dashboards: Dashboard[];
}

export const EMPTY_STATE: DashboardState = { version: 1, dashboards: [] };

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `dash_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function isDashboard(value: unknown): value is Dashboard {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<Dashboard>;
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.name === "string" &&
    Array.isArray(entry.queryIds) &&
    entry.queryIds.every((id) => typeof id === "string")
  );
}

/**
 * Parse persisted state, discarding anything malformed.
 *
 * A corrupt entry must never take the rail down: the dashboards list is
 * navigation, and losing one bad dashboard is far better than an app that will
 * not render. Unknown future versions are dropped rather than guessed at.
 */
export function parseState(raw: string | null): DashboardState {
  if (!raw) return EMPTY_STATE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_STATE;
  }
  if (!parsed || typeof parsed !== "object") return EMPTY_STATE;

  const candidate = parsed as Partial<DashboardState>;
  if (candidate.version !== 1 || !Array.isArray(candidate.dashboards)) return EMPTY_STATE;

  const dashboards = candidate.dashboards.filter(isDashboard).map((entry) => ({
    id: entry.id,
    name: entry.name,
    // De-duplicate: the same query twice on one board is always a mistake.
    queryIds: [...new Set(entry.queryIds)],
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date(0).toISOString(),
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date(0).toISOString(),
  }));

  return { version: 1, dashboards };
}

export function serializeState(state: DashboardState): string {
  return JSON.stringify(state);
}

/** Trimmed, length-capped, never empty. */
export function normalizeName(name: string, fallback = "Untitled dashboard"): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return fallback;
  return trimmed.slice(0, 80);
}

export function createDashboard(
  state: DashboardState,
  name: string,
  options: { id?: string; now?: string; queryIds?: string[] } = {},
): { state: DashboardState; dashboard: Dashboard } {
  const now = options.now ?? new Date().toISOString();
  const dashboard: Dashboard = {
    id: options.id ?? createId(),
    name: normalizeName(name),
    queryIds: [...new Set(options.queryIds ?? [])],
    createdAt: now,
    updatedAt: now,
  };
  return {
    state: { ...state, dashboards: [...state.dashboards, dashboard] },
    dashboard,
  };
}

function mapDashboard(
  state: DashboardState,
  id: string,
  update: (dashboard: Dashboard) => Dashboard,
  now?: string,
): DashboardState {
  const stamp = now ?? new Date().toISOString();
  return {
    ...state,
    dashboards: state.dashboards.map((dashboard) =>
      dashboard.id === id ? { ...update(dashboard), updatedAt: stamp } : dashboard,
    ),
  };
}

export function renameDashboard(
  state: DashboardState,
  id: string,
  name: string,
  now?: string,
): DashboardState {
  return mapDashboard(state, id, (dashboard) => ({
    ...dashboard,
    name: normalizeName(name, dashboard.name),
  }), now);
}

export function deleteDashboard(state: DashboardState, id: string): DashboardState {
  return { ...state, dashboards: state.dashboards.filter((dashboard) => dashboard.id !== id) };
}

export function addQuery(
  state: DashboardState,
  id: string,
  queryId: string,
  now?: string,
): DashboardState {
  return mapDashboard(state, id, (dashboard) =>
    dashboard.queryIds.includes(queryId)
      ? dashboard
      : { ...dashboard, queryIds: [...dashboard.queryIds, queryId] },
    now,
  );
}

export function removeQuery(
  state: DashboardState,
  id: string,
  queryId: string,
  now?: string,
): DashboardState {
  return mapDashboard(state, id, (dashboard) => ({
    ...dashboard,
    queryIds: dashboard.queryIds.filter((entry) => entry !== queryId),
  }), now);
}

/** Move a query within a board. Out-of-range targets clamp rather than throw. */
export function moveQuery(
  state: DashboardState,
  id: string,
  queryId: string,
  toIndex: number,
  now?: string,
): DashboardState {
  return mapDashboard(state, id, (dashboard) => {
    const from = dashboard.queryIds.indexOf(queryId);
    if (from === -1) return dashboard;
    const next = [...dashboard.queryIds];
    next.splice(from, 1);
    const target = Math.max(0, Math.min(toIndex, next.length));
    next.splice(target, 0, queryId);
    return { ...dashboard, queryIds: next };
  }, now);
}

/**
 * Drop references to queries that no longer exist on the engine.
 *
 * Deleting a saved query leaves every dashboard holding a dangling id. Rather
 * than rendering a card that can only ever error, boards are reconciled against
 * the live query list whenever it is known.
 */
export function pruneMissingQueries(
  state: DashboardState,
  knownQueryIds: Iterable<string>,
  now?: string,
): DashboardState {
  const known = new Set(knownQueryIds);
  const stamp = now ?? new Date().toISOString();
  let changed = false;

  const dashboards = state.dashboards.map((dashboard) => {
    const kept = dashboard.queryIds.filter((queryId) => known.has(queryId));
    if (kept.length === dashboard.queryIds.length) return dashboard;
    changed = true;
    return { ...dashboard, queryIds: kept, updatedAt: stamp };
  });

  return changed ? { ...state, dashboards } : state;
}

export function findDashboard(state: DashboardState, id: string | null): Dashboard | null {
  if (!id) return null;
  return state.dashboards.find((dashboard) => dashboard.id === id) ?? null;
}

/** Which boards contain a given query, for the "on N dashboards" affordance. */
export function dashboardsContaining(state: DashboardState, queryId: string): Dashboard[] {
  return state.dashboards.filter((dashboard) => dashboard.queryIds.includes(queryId));
}
