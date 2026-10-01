"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import type { ItemListSummary } from "@/contracts/api";
import { ApiError, listLists } from "@/services/api-client";
import { useResource } from "./useResource";

/**
 * Named lists, owned by the engine.
 *
 * Fetched once at the shell so the rule editor's picker and the lists pages
 * share a single load. A page that creates, edits or deletes a list writes
 * through the client and then calls `reload()`, so what the picker offers is
 * what the engine stored rather than an optimistic guess.
 *
 * Only the summaries live here. A list's items can run to tens of thousands of
 * rows and nothing outside the edit form needs them.
 */
export interface ListsValue {
  lists: ItemListSummary[];
  loading: boolean;
  /** True only before the first successful load. */
  initial: boolean;
  error: ApiError | null;
  reload: () => void;
}

const ListsContext = createContext<ListsValue | null>(null);

export function ListsProvider({ children }: { children: React.ReactNode }) {
  const load = useCallback((signal: AbortSignal) => listLists({ signal }), []);
  const resource = useResource(load);

  const lists = useMemo(() => resource.data ?? [], [resource.data]);
  const { reload } = resource;

  const value = useMemo<ListsValue>(
    () => ({
      lists,
      loading: resource.loading,
      initial: resource.initial,
      error: resource.error,
      reload,
    }),
    [lists, resource.loading, resource.initial, resource.error, reload],
  );

  return <ListsContext.Provider value={value}>{children}</ListsContext.Provider>;
}

export function useLists(): ListsValue {
  const value = useContext(ListsContext);
  if (!value) {
    throw new Error("useLists must be used inside <ListsProvider>");
  }
  return value;
}
