"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import type { DashboardRead } from "@/contracts/api";
import {
  ApiError,
  createDashboard,
  deleteDashboard,
  getDashboard,
  listDashboards,
  updateDashboard,
} from "@/services/api-client";
import { useResource } from "@/lib/useResource";
import { moved, normalizeName, withQuery, withoutQuery } from "./arrange";

/**
 * Dashboards, owned by the engine.
 *
 * They used to live in `localStorage`, which made them per-browser: invisible
 * from a second machine and lost with the site data. They are data, not a
 * preference, so the engine holds them and every client sees the same boards.
 *
 * Fetched once at the shell, like connections, because the rail renders them on
 * every screen. Each mutation writes through and then reloads, so what the UI
 * shows is what the engine stored rather than an optimistic guess.
 */
export interface DashboardsValue {
  dashboards: DashboardRead[];
  loading: boolean;
  /** True only before the first successful load. */
  initial: boolean;
  error: ApiError | null;
  reload: () => void;

  create: (name: string, queryIds?: string[]) => Promise<DashboardRead>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  addChartTo: (id: string, queryId: string) => Promise<void>;
  removeChartFrom: (id: string, queryId: string) => Promise<void>;
  moveQueryTo: (id: string, queryId: string, toIndex: number) => Promise<void>;
}

const DashboardsContext = createContext<DashboardsValue | null>(null);

export function DashboardsProvider({ children }: { children: React.ReactNode }) {
  const load = useCallback((signal: AbortSignal) => listDashboards({ signal }), []);
  const resource = useResource(load);

  const dashboards = useMemo(() => resource.data ?? [], [resource.data]);
  const { reload } = resource;

  const create = useCallback(
    async (name: string, queryIds: string[] = []) => {
      const dashboard = await createDashboard({
        name: normalizeName(name),
        chart_ids: queryIds,
      });
      reload();
      return dashboard;
    },
    [reload],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      await updateDashboard(id, { name: normalizeName(name) });
      reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteDashboard(id);
      reload();
    },
    [reload],
  );

  /**
   * `chart_ids` replaces the arrangement wholesale, so every membership change
   * is "read the current order, compute the next one, send it".
   *
   * The read is a fresh GET rather than a lookup in the list above, for two
   * reasons. The list may not contain the board at all - a link opened straight
   * to a board this browser has never listed - and reading from it would make
   * the action silently do nothing. And a read-modify-write over a cached order
   * would clobber a card another machine added between the list loading and
   * this click.
   */
  const rearrange = useCallback(
    async (id: string, next: (current: readonly string[]) => string[]) => {
      const current = await getDashboard(id);
      await updateDashboard(id, { chart_ids: next(current.chart_ids) });
      reload();
    },
    [reload],
  );

  const addChartTo = useCallback(
    (id: string, queryId: string) => rearrange(id, (ids) => withQuery(ids, queryId)),
    [rearrange],
  );

  const removeChartFrom = useCallback(
    (id: string, queryId: string) => rearrange(id, (ids) => withoutQuery(ids, queryId)),
    [rearrange],
  );

  const moveQueryTo = useCallback(
    (id: string, queryId: string, toIndex: number) =>
      rearrange(id, (ids) => moved(ids, queryId, toIndex)),
    [rearrange],
  );

  const value = useMemo<DashboardsValue>(
    () => ({
      dashboards,
      loading: resource.loading,
      initial: resource.initial,
      error: resource.error,
      reload,
      create,
      rename,
      remove,
      addChartTo,
      removeChartFrom,
      moveQueryTo,
    }),
    [
      dashboards,
      resource.loading,
      resource.initial,
      resource.error,
      reload,
      create,
      rename,
      remove,
      addChartTo,
      removeChartFrom,
      moveQueryTo,
    ],
  );

  return (
    <DashboardsContext.Provider value={value}>{children}</DashboardsContext.Provider>
  );
}

export function useDashboards(): DashboardsValue {
  const value = useContext(DashboardsContext);
  if (!value) {
    throw new Error("useDashboards must be used inside <DashboardsProvider>");
  }
  return value;
}

/** Find one board in an already-loaded list. */
export function findDashboard(
  dashboards: DashboardRead[],
  id: string | null,
): DashboardRead | null {
  if (!id) return null;
  return dashboards.find((dashboard) => dashboard.id === id) ?? null;
}
