"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import type { FlagSeverity, FlaggedSummary } from "@/contracts/api";
import { ApiError, getFlaggedSummary } from "@/services/api-client";
import { useResource } from "@/lib/useResource";

/**
 * How many findings each connection and each query is holding.
 *
 * Fetched once at the shell rather than per card. Every connection in the rail,
 * every card on a dashboard and every row of the home page wants this number,
 * so a count endpoint per thing on screen would be the same data fetched once
 * per thing on screen.
 *
 * Deliberately not live. This drives a badge that says "there is something to
 * look at here", and a badge that changes under the reader is worse than one
 * that is a minute stale. It reloads when the user does something that could
 * change it - dismissing, deleting, refreshing a flagged view.
 */
export interface FlaggedValue {
	/** Total across every connection. */
	total: number;
	countForConnection: (connectionId: string) => number;
	severityForConnection: (connectionId: string) => FlagSeverity | null;
	countForQuery: (queryId: string) => number;
	severityForQuery: (queryId: string) => FlagSeverity | null;
	loading: boolean;
	error: ApiError | null;
	reload: () => void;
}

const FlaggedContext = createContext<FlaggedValue | null>(null);

export function FlaggedProvider({ children }: { children: React.ReactNode }) {
	const load = useCallback((signal: AbortSignal) => getFlaggedSummary({ signal }), []);
	const resource = useResource(load);

	const value = useMemo<FlaggedValue>(() => {
		const summary: FlaggedSummary | null = resource.data;
		const byConnection = new Map(
			(summary?.connections ?? []).map((entry) => [entry.connection_id, entry]),
		);
		const byQuery = new Map(
			(summary?.queries ?? []).map((entry) => [entry.query_id, entry]),
		);
		return {
			total: summary?.flagged_count ?? 0,
			countForConnection: (id) => byConnection.get(id)?.flagged_count ?? 0,
			severityForConnection: (id) => byConnection.get(id)?.severity ?? null,
			countForQuery: (id) => byQuery.get(id)?.flagged_count ?? 0,
			severityForQuery: (id) => byQuery.get(id)?.severity ?? null,
			loading: resource.loading,
			error: resource.error,
			reload: resource.reload,
		};
	}, [resource.data, resource.loading, resource.error, resource.reload]);

	return <FlaggedContext.Provider value={value}>{children}</FlaggedContext.Provider>;
}

/**
 * Zero findings everywhere. What a component sees with no provider above it.
 *
 * Unlike the connections context this does not throw. The badge is chrome laid
 * over components that are otherwise provider-free - the rail, a chart card -
 * and the honest failure for "we could not count the findings" is to show no
 * badge, not to take down the page that was going to render the data.
 */
const NOTHING_FLAGGED: FlaggedValue = {
	total: 0,
	countForConnection: () => 0,
	severityForConnection: () => null,
	countForQuery: () => 0,
	severityForQuery: () => null,
	loading: false,
	error: null,
	reload: () => {},
};

export function useFlagged(): FlaggedValue {
	return useContext(FlaggedContext) ?? NOTHING_FLAGGED;
}
