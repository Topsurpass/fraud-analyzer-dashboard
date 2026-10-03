"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PublishRequestRead } from "@/contracts/api";
import { ApiError, listPublishRequests } from "@/services/api-client";
import { useOptionalUser } from "@/services/auth/AuthContext";
import { isAdmin } from "@/services/auth/permissions";
import { useResource } from "@/lib/useResource";

/**
 * The publish requests waiting for an administrator, for the rail, the bell and
 * the approvals page to share.
 *
 * Fetched once at the shell, and only for an administrator. For anyone else the
 * loader answers with an empty list without sending a request, so an analyst's
 * browser never asks an endpoint that would refuse it, and nothing about the
 * queue appears in their interface. Refetched on a slow interval while the tab
 * is visible, like the flagged summary: a request arrives while somebody is
 * looking at something else, and a badge that only updated on reload would
 * defeat the point of having one.
 *
 * The approvals page reloads it after every decision, so the count in the rail
 * falls the moment a request is approved or rejected.
 */

const REFRESH_MS = 30_000;

export interface PublishRequestsValue {
	requests: PublishRequestRead[];
	/** How many are waiting. Zero for anyone who is not an administrator. */
	count: number;
	/** The first read has not answered yet. */
	initial: boolean;
	error: ApiError | null;
	reload: () => void;
}

const NONE: PublishRequestsValue = {
	requests: [],
	count: 0,
	initial: false,
	error: null,
	reload: () => {},
};

const PublishRequestsContext = createContext<PublishRequestsValue | null>(null);

export function PublishRequestsProvider({ children }: { children: React.ReactNode }) {
	const admin = isAdmin(useOptionalUser());

	const load = useCallback(
		(signal: AbortSignal) =>
			admin ? listPublishRequests({ signal }) : Promise.resolve([] as PublishRequestRead[]),
		[admin],
	);
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
		if (!admin || hidden) return;
		reload();
		const timer = setInterval(reload, REFRESH_MS);
		return () => clearInterval(timer);
	}, [admin, hidden, reload]);

	const value = useMemo<PublishRequestsValue>(() => {
		const requests = admin ? (resource.data ?? []) : [];
		return {
			requests,
			count: requests.length,
			initial: admin && resource.initial,
			error: admin ? resource.error : null,
			reload,
		};
	}, [admin, resource.data, resource.initial, resource.error, reload]);

	return <PublishRequestsContext.Provider value={value}>{children}</PublishRequestsContext.Provider>;
}

/**
 * Nothing waiting, with no provider above. The count is chrome laid over
 * components that otherwise work without it, so the honest failure is no badge
 * rather than a thrown error.
 */
export function usePublishRequests(): PublishRequestsValue {
	return useContext(PublishRequestsContext) ?? NONE;
}
