"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  STORAGE_KEY,
  addQuery,
  createDashboard,
  deleteDashboard,
  moveQuery,
  parseState,
  pruneMissingQueries,
  removeQuery,
  renameDashboard,
  serializeState,
  type Dashboard,
  type DashboardState,
  EMPTY_STATE,
} from "./store";

/**
 * React binding for the dashboard store.
 *
 * localStorage is an external store, so it is read through
 * `useSyncExternalStore` rather than an effect. That gets three things at once:
 * the server renders `EMPTY_STATE` and the client swaps in the real value
 * without a hydration mismatch, a write in another tab re-renders this one, and
 * there is no render-then-correct flash.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** `getSnapshot` must be referentially stable between real changes. */
let cachedRaw: string | null = null;
let cachedState: DashboardState = EMPTY_STATE;
let cachePrimed = false;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode and blocked-storage browsers throw on access. Dashboards are
    // a convenience; the rest of the app keeps working without them.
    return null;
  }
}

function getSnapshot(): DashboardState {
  const raw = readRaw();
  if (cachePrimed && raw === cachedRaw) return cachedState;
  cachedRaw = raw;
  cachedState = parseState(raw);
  cachePrimed = true;
  return cachedState;
}

function getServerSnapshot(): DashboardState {
  return EMPTY_STATE;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  // `storage` fires in *other* tabs only, so same-tab writes notify directly.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    cachePrimed = false;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function commit(next: DashboardState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeState(next));
  } catch {
    /* quota or blocked storage: fall through and still update this tab */
  }
  cachedRaw = serializeState(next);
  cachedState = next;
  cachePrimed = true;
  for (const listener of listeners) listener();
}

/** Latest persisted state, so one tab never clobbers another tab's write. */
function current(): DashboardState {
  cachePrimed = false;
  return getSnapshot();
}

/** Exported for tests: forget the module-level cache. */
export function resetDashboardCache(): void {
  cachePrimed = false;
  cachedRaw = null;
  cachedState = EMPTY_STATE;
}

export interface UseDashboards {
  dashboards: Dashboard[];
  /** False during the server render and the first client frame. */
  hydrated: boolean;
  create: (name: string, queryIds?: string[]) => Dashboard;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  addQueryTo: (id: string, queryId: string) => void;
  removeQueryFrom: (id: string, queryId: string) => void;
  moveQueryTo: (id: string, queryId: string, toIndex: number) => void;
  /** Drop ids for queries the engine no longer has. */
  prune: (knownQueryIds: Iterable<string>) => void;
}

export function useDashboards(): UseDashboards {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const create = useCallback((name: string, queryIds: string[] = []) => {
    const result = createDashboard(current(), name, { queryIds });
    commit(result.state);
    return result.dashboard;
  }, []);

  const rename = useCallback(
    (id: string, name: string) => commit(renameDashboard(current(), id, name)),
    [],
  );
  const remove = useCallback((id: string) => commit(deleteDashboard(current(), id)), []);
  const addQueryTo = useCallback(
    (id: string, queryId: string) => commit(addQuery(current(), id, queryId)),
    [],
  );
  const removeQueryFrom = useCallback(
    (id: string, queryId: string) => commit(removeQuery(current(), id, queryId)),
    [],
  );
  const moveQueryTo = useCallback(
    (id: string, queryId: string, toIndex: number) =>
      commit(moveQuery(current(), id, queryId, toIndex)),
    [],
  );
  const prune = useCallback((knownQueryIds: Iterable<string>) => {
    const before = current();
    const after = pruneMissingQueries(before, knownQueryIds);
    if (after !== before) commit(after);
  }, []);

  return useMemo(
    () => ({
      dashboards: state.dashboards,
      hydrated,
      create,
      rename,
      remove,
      addQueryTo,
      removeQueryFrom,
      moveQueryTo,
      prune,
    }),
    [
      state.dashboards,
      hydrated,
      create,
      rename,
      remove,
      addQueryTo,
      removeQueryFrom,
      moveQueryTo,
      prune,
    ],
  );
}
