"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type {
	FlagSeverity,
	FlaggedConnectionTally,
	FlaggedSummary,
} from "@/contracts/api";
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
 * Refetched on an interval, because the engine now runs queries on a schedule
 * and findings appear with nobody watching. Without that the only way to learn
 * something had been flagged would be to open the flagged view and look, which
 * is exactly what the notification exists to replace.
 *
 * The interval is slow on purpose - this is a badge, not a live chart - and
 * stops entirely while the tab is hidden, matching `useQueryPolling`. A
 * background tab polling a database summary forever is rude.
 *
 * It also reloads immediately whenever the user does something that could
 * change it: dismissing, clearing, refreshing a flagged view.
 */

/** How often to re-read the summary while the tab is visible. */
const REFRESH_MS = 30_000;
export interface FlaggedValue {
	/** Total across every connection. */
	total: number;
	countForConnection: (connectionId: string) => number;
	severityForConnection: (connectionId: string) => FlagSeverity | null;
	countForQuery: (queryId: string) => number;
	severityForQuery: (queryId: string) => FlagSeverity | null;
	/** Connections holding findings, most first. What the bell lists. */
	connections: FlaggedConnectionTally[];
	/** When the most recent finding anywhere first appeared, ISO, or null. */
	newestAt: string | null;
	loading: boolean;
	error: ApiError | null;
	reload: () => void;
}

const FlaggedContext = createContext<FlaggedValue | null>(null);

export function FlaggedProvider({ children }: { children: React.ReactNode }) {
	const load = useCallback((signal: AbortSignal) => getFlaggedSummary({ signal }), []);
	const resource = useResource(load);
	const { reload } = resource;

	const [hidden, setHidden] = useState(false);
	useEffect(() => {
		const read = () => setHidden(document.visibilityState === "hidden");
		read();
		document.addEventListener("visibilitychange", read);
		return () => document.removeEventListener("visibilitychange", read);
	}, []);

	useEffect(() => {
		if (hidden) return;
		// Reload on becoming visible again as well as on the interval: coming
		// back to the tab is exactly when the reader wants to know.
		reload();
		const timer = setInterval(reload, REFRESH_MS);
		return () => clearInterval(timer);
	}, [hidden, reload]);

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
			connections: summary?.connections ?? [],
			newestAt: summary?.newest_first_seen_at ?? null,
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
	connections: [],
	newestAt: null,
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
