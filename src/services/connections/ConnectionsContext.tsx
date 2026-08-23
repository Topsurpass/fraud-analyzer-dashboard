"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import type { ConnectionRead } from "@/contracts/api";
import { ApiError, listConnections } from "@/services/api-client";
import { useResource } from "@/lib/useResource";

/**
 * The connection list, shared by the rail and every page under it.
 *
 * The rail shows connections on every screen, so fetching it per page would
 * mean the same request several times over and a rail that flickers on each
 * navigation. One fetch at the shell, one reload path after a mutation.
 */
export interface ConnectionsValue {
	connections: ConnectionRead[];
	loading: boolean;
	initial: boolean;
	error: ApiError | null;
	reload: () => void;
}

const ConnectionsContext = createContext<ConnectionsValue | null>(null);

export function ConnectionsProvider({ children }: { children: React.ReactNode }) {
	const load = useCallback((signal: AbortSignal) => listConnections({ signal }), []);
	const resource = useResource(load);

	const value = useMemo<ConnectionsValue>(
		() => ({
			connections: resource.data ?? [],
			loading: resource.loading,
			initial: resource.initial,
			error: resource.error,
			reload: resource.reload,
		}),
		[resource.data, resource.loading, resource.initial, resource.error, resource.reload],
	);

	return <ConnectionsContext.Provider value={value}>{children}</ConnectionsContext.Provider>;
}

export function useConnections(): ConnectionsValue {
	const value = useContext(ConnectionsContext);
	if (!value) {
		throw new Error("useConnections must be used inside <ConnectionsProvider>");
	}
	return value;
}
