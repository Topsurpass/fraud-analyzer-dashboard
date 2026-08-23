import type {
	ColumnList,
	DashboardCreate,
	DashboardRead,
	DashboardUpdate,
	ConnectionCreate,
	ConnectionCreateResult,
	ConnectionRead,
	ConnectionTestResult,
	ConnectionUpdate,
	ExecutionLogRead,
	PollResponse,
	PreviewRequest,
	PreviewResponse,
	RunResponse,
	SavedQueryCreate,
	SavedQueryRead,
	SavedQueryUpdate,
	TableList,
} from "@/contracts/api";
import { ApiError, messageFromBody } from "./errors";

/** Ceiling on any single request. Poll callers pass something tighter. */
export const DEFAULT_TIMEOUT_MS = 15_000;

export function resolveBaseUrl(raw?: string | undefined): string {
	const value = (raw ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "").trim();
	if (!value) {
		throw new ApiError({
			kind: "network",
			message:
				"NEXT_PUBLIC_API_BASE_URL is not set. Add it to .env.local and restart the dev server.",
			url: "",
		});
	}
	return value.replace(/\/+$/, "");
}

export interface RequestOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
	/** Overrides the env base URL. Only tests and the mock runner pass this. */
	baseUrl?: string;
}

interface RequestInput extends RequestOptions {
	method: "GET" | "POST" | "PUT" | "DELETE";
	path: string;
	query?: Record<string, string | number | boolean | null | undefined>;
	body?: unknown;
}

function buildUrl(input: RequestInput): string {
	const base = resolveBaseUrl(input.baseUrl);
	const url = new URL(base + input.path);
	for (const [key, value] of Object.entries(input.query ?? {})) {
		if (value === null || value === undefined) continue;
		url.searchParams.set(key, String(value));
	}
	return url.toString();
}

/**
 * One request. Applies a hard deadline, honours an external abort signal, and
 * converts every failure mode into an `ApiError`.
 */
export async function request<T>(input: RequestInput): Promise<T> {
	const url = buildUrl(input);
	const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	// A caller that already gave up (unmounted card, superseded poll) should cost
	// nothing. Issuing the request and unwinding it would still occupy a socket.
	if (input.signal?.aborted) {
		throw new ApiError({ kind: "aborted", message: "Request cancelled", url });
	}

	const controller = new AbortController();
	const onExternalAbort = () => controller.abort(new DOMException("aborted", "AbortError"));
	if (input.signal) {
		if (input.signal.aborted) onExternalAbort();
		else input.signal.addEventListener("abort", onExternalAbort, { once: true });
	}

	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort(new DOMException("timeout", "TimeoutError"));
	}, timeoutMs);

	let response: Response;
	try {
		response = await fetch(url, {
			method: input.method,
			signal: controller.signal,
			headers: input.body === undefined ? undefined : { "content-type": "application/json" },
			body: input.body === undefined ? undefined : JSON.stringify(input.body),
			cache: "no-store",
		});
	} catch (cause) {
		if (timedOut) {
			throw new ApiError({ kind: "timeout", message: `Timed out after ${timeoutMs}ms`, url });
		}
		if (input.signal?.aborted) {
			throw new ApiError({ kind: "aborted", message: "Request cancelled", url });
		}
		throw new ApiError({
			kind: "network",
			message: cause instanceof Error ? cause.message : "Network request failed",
			url,
		});
	} finally {
		clearTimeout(timer);
		input.signal?.removeEventListener("abort", onExternalAbort);
	}

	if (response.status === 204 || response.headers.get("content-length") === "0") {
		if (!response.ok) {
			throw new ApiError({
				kind: "http",
				message: `Engine returned HTTP ${response.status}`,
				url,
				status: response.status,
			});
		}
		return undefined as T;
	}

	const text = await response.text();
	let parsed: unknown = null;
	if (text) {
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = text;
		}
	}

	if (!response.ok) {
		const { message, errorCode, detail } = messageFromBody(parsed, response.status);
		throw new ApiError({
			kind: "http",
			message,
			url,
			status: response.status,
			errorCode,
			detail,
		});
	}

	return parsed as T;
}

/* ---------------------------------------------------------------- connections */

export const listConnections = (options?: RequestOptions) =>
	request<ConnectionRead[]>({ method: "GET", path: "/connections", ...options });

export const getConnection = (connectionId: string, options?: RequestOptions) =>
	request<ConnectionRead>({
		method: "GET",
		path: `/connections/${encodeURIComponent(connectionId)}`,
		...options,
	});

export const createConnection = (body: ConnectionCreate, options?: RequestOptions) =>
	request<ConnectionCreateResult>({ method: "POST", path: "/connections", body, ...options });

export const updateConnection = (
	connectionId: string,
	body: ConnectionUpdate,
	options?: RequestOptions,
) =>
	request<ConnectionCreateResult>({
		method: "PUT",
		path: `/connections/${encodeURIComponent(connectionId)}`,
		body,
		...options,
	});

export const deleteConnection = (connectionId: string, options?: RequestOptions) =>
	request<void>({
		method: "DELETE",
		path: `/connections/${encodeURIComponent(connectionId)}`,
		...options,
	});

export const testConnection = (connectionId: string, options?: RequestOptions) =>
	request<ConnectionTestResult>({
		method: "POST",
		path: `/connections/${encodeURIComponent(connectionId)}/test`,
		// A cold database can take a while to answer a handshake.
		timeoutMs: 30_000,
		...options,
	});

/* --------------------------------------------------------------------- schema */

export const listTables = (connectionId: string, options?: RequestOptions) =>
	request<TableList>({
		method: "GET",
		path: `/connections/${encodeURIComponent(connectionId)}/tables`,
		...options,
	});

export const listColumns = (connectionId: string, table: string, options?: RequestOptions) =>
	request<ColumnList>({
		method: "GET",
		path: `/connections/${encodeURIComponent(connectionId)}/tables/${encodeURIComponent(table)}/columns`,
		...options,
	});

export const previewQuery = (
	connectionId: string,
	body: PreviewRequest,
	options?: RequestOptions,
) =>
	request<PreviewResponse>({
		method: "POST",
		path: `/connections/${encodeURIComponent(connectionId)}/query/preview`,
		body,
		timeoutMs: 30_000,
		...options,
	});

/* -------------------------------------------------------------- saved queries */

export const listQueries = (connectionId: string, options?: RequestOptions) =>
	request<SavedQueryRead[]>({
		method: "GET",
		path: `/connections/${encodeURIComponent(connectionId)}/queries`,
		...options,
	});

export const createQuery = (
	connectionId: string,
	body: SavedQueryCreate,
	options?: RequestOptions,
) =>
	request<SavedQueryRead>({
		method: "POST",
		path: `/connections/${encodeURIComponent(connectionId)}/queries`,
		body,
		...options,
	});

export const getQuery = (queryId: string, options?: RequestOptions) =>
	request<SavedQueryRead>({
		method: "GET",
		path: `/queries/${encodeURIComponent(queryId)}`,
		...options,
	});

export const updateQuery = (queryId: string, body: SavedQueryUpdate, options?: RequestOptions) =>
	request<SavedQueryRead>({
		method: "PUT",
		path: `/queries/${encodeURIComponent(queryId)}`,
		body,
		...options,
	});

export const deleteQuery = (queryId: string, options?: RequestOptions) =>
	request<void>({
		method: "DELETE",
		path: `/queries/${encodeURIComponent(queryId)}`,
		...options,
	});

export const runQuery = (queryId: string, options?: RequestOptions) =>
	request<RunResponse>({
		method: "POST",
		path: `/queries/${encodeURIComponent(queryId)}/run`,
		timeoutMs: 30_000,
		...options,
	});

export const pollQuery = (
	queryId: string,
	params: { sinceHash?: string | null; force?: boolean } = {},
	options?: RequestOptions,
) =>
	request<PollResponse>({
		method: "GET",
		path: `/queries/${encodeURIComponent(queryId)}/poll`,
		query: {
			since_hash: params.sinceHash ?? undefined,
			force: params.force ? true : undefined,
		},
		...options,
	});

export const listLogs = (queryId: string, limit = 20, options?: RequestOptions) =>
	request<ExecutionLogRead[]>({
		method: "GET",
		path: `/queries/${encodeURIComponent(queryId)}/logs`,
		query: { limit },
		...options,
	});

/* ----------------------------------------------------------------- dashboards */

export const listDashboards = (options?: RequestOptions) =>
	request<DashboardRead[]>({ method: "GET", path: "/dashboards", ...options });

export const createDashboard = (body: DashboardCreate, options?: RequestOptions) =>
	request<DashboardRead>({ method: "POST", path: "/dashboards", body, ...options });

export const getDashboard = (dashboardId: string, options?: RequestOptions) =>
	request<DashboardRead>({
		method: "GET",
		path: `/dashboards/${encodeURIComponent(dashboardId)}`,
		...options,
	});

export const updateDashboard = (
	dashboardId: string,
	body: DashboardUpdate,
	options?: RequestOptions,
) =>
	request<DashboardRead>({
		method: "PUT",
		path: `/dashboards/${encodeURIComponent(dashboardId)}`,
		body,
		...options,
	});

export const deleteDashboard = (dashboardId: string, options?: RequestOptions) =>
	request<void>({
		method: "DELETE",
		path: `/dashboards/${encodeURIComponent(dashboardId)}`,
		...options,
	});

/* ----------------------------------------------------------------------- meta */

export const health = (options?: RequestOptions) =>
	request<Record<string, unknown>>({
		method: "GET",
		path: "/health",
		timeoutMs: 8_000,
		...options,
	});
