/**
 * Wire types for the Fraud Analyzer Engine.
 *
 * Mirrors https://fraud-analyzer-engine.fastapicloud.dev/openapi.json
 * (Fraud Analyzer Engine 0.1.0). This file is the contract boundary: nothing
 * outside `services/api-client` should construct these by hand, and nothing in
 * the app should reach past them to raw `fetch`.
 */

export type DbType = "postgres" | "mysql" | "sqlite";
export type ConnectionStatus = "untested" | "ok" | "failed";
export type ChartType = "line" | "bar" | "pie" | "number" | "table";

export const DB_TYPES: readonly DbType[] = ["postgres", "mysql", "sqlite"];
export const CHART_TYPES: readonly ChartType[] = ["line", "bar", "pie", "number", "table"];

/** Default ports the engine expects, used to prefill the connection form. */
export const DEFAULT_PORTS: Record<DbType, number | null> = {
	postgres: 5432,
	mysql: 3306,
	sqlite: null,
};

export interface ConnectionRead {
	id: string;
	name: string;
	db_type: DbType;
	host: string | null;
	port: number | null;
	database: string | null;
	username: string | null;
	sqlite_path: string | null;
	status: ConnectionStatus;
	last_tested_at: string | null;
	last_test_error: string | null;
	created_at: string;
	updated_at: string;
}

export interface ConnectionCreate {
	name: string;
	db_type: DbType;
	host?: string | null;
	port?: number | null;
	database?: string | null;
	username?: string | null;
	sqlite_path?: string | null;
	password?: string | null;
}

export type ConnectionUpdate = Partial<Omit<ConnectionCreate, "db_type">>;

export interface ConnectionCreateResult {
	connection: ConnectionRead;
	test_ok: boolean;
	test_error: string | null;
	test_error_code: string | null;
}

export interface ConnectionTestResult {
	connection_id: string;
	status: ConnectionStatus;
	tested_at: string;
	ok: boolean;
	error: string | null;
	error_code: string | null;
}

export interface TableInfo {
	name: string;
	kind: string;
}

export interface TableList {
	connection_id: string;
	tables: TableInfo[];
}

export interface ColumnInfo {
	name: string;
	type: string;
	nullable: boolean;
	primary_key: boolean;
}

export interface ColumnList {
	connection_id: string;
	table: string;
	columns: ColumnInfo[];
}

export interface ChartSpec {
	type: ChartType;
	x_field: string | null;
	y_field: string | null;
	series_field: string | null;
	warnings: string[];
}

export interface SavedQueryRead {
	id: string;
	connection_id: string;
	name: string;
	description: string | null;
	sql_text: string;
	table_hint: string | null;
	chart_type: ChartType;
	x_field: string | null;
	y_field: string | null;
	series_field: string | null;
	row_limit: number;
	poll_interval_ms: number | null;
	created_at: string;
	updated_at: string;
}

export interface SavedQueryCreate {
	name: string;
	sql_text: string;
	description?: string | null;
	table_hint?: string | null;
	chart_type?: ChartType;
	x_field?: string | null;
	y_field?: string | null;
	series_field?: string | null;
	row_limit?: number | null;
	poll_interval_ms?: number | null;
}

export type SavedQueryUpdate = Partial<SavedQueryCreate>;

/** A single result cell. The engine is schema-agnostic, so this stays open. */
export type Cell = string | number | boolean | null;
export type Row = Cell[];

/* -------------------------------------------------------------------------
 * Flag rules
 *
 * A rule is a named set of conditions the analyst attaches to a saved query.
 * A rule matches a row when ALL its conditions match; a row is flagged when
 * ANY enabled rule matches. The engine evaluates them in Python over rows the
 * database already returned, so none of this is ever spliced into SQL.
 * ---------------------------------------------------------------------- */

export type FlagSeverity = "low" | "medium" | "high";

export const FLAG_SEVERITIES: readonly FlagSeverity[] = ["low", "medium", "high"];

export type FlagOperator =
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "eq"
	| "neq"
	| "contains"
	| "not_contains"
	| "starts_with"
	| "in"
	| "not_in"
	| "is_null"
	| "is_not_null"
	| "between";

/** Operators that read no value at all. */
export const NULLARY_OPERATORS: readonly FlagOperator[] = ["is_null", "is_not_null"];
/** Operators that need both `value` and `value2`. */
export const BINARY_OPERATORS: readonly FlagOperator[] = ["between"];

/** Labels for the operator dropdown, in the order they should be offered. */
export const OPERATOR_LABELS: Record<FlagOperator, string> = {
	gt: "greater than",
	gte: "at least",
	lt: "less than",
	lte: "at most",
	eq: "equals",
	neq: "does not equal",
	between: "between",
	contains: "contains",
	not_contains: "does not contain",
	starts_with: "starts with",
	in: "is one of",
	not_in: "is not one of",
	is_null: "is empty",
	is_not_null: "is not empty",
};

export interface FlagCondition {
	column_name: string;
	operator: FlagOperator;
	value?: string | null;
	value2?: string | null;
}

export interface FlagConditionRead extends FlagCondition {
	id: string;
	position: number;
}

export interface FlagRule {
	name: string;
	severity: FlagSeverity;
	enabled: boolean;
	conditions: FlagCondition[];
}

export interface FlagRuleRead {
	id: string;
	query_id: string;
	name: string;
	severity: FlagSeverity;
	enabled: boolean;
	position: number;
	conditions: FlagConditionRead[];
	created_at: string;
	updated_at: string;
}

export interface FlagRuleSetRead {
	query_id: string;
	rules: FlagRuleRead[];
}

export interface FlagRuleSetUpdate {
	rules: FlagRule[];
}

/** One flagged row. `index` is a position in the result's `rows`. */
export interface RowFlag {
	index: number;
	rule_ids: string[];
}

export interface RuleHit {
	id: string;
	name: string;
	severity: FlagSeverity;
	matched: number;
}

/**
 * Always present on a run, empty when the query defines no rules.
 *
 * `rows` carries ONLY flagged rows, so its length is the flagged count rather
 * than the result size.
 */
export interface FlagOutcome {
	flagged_count: number;
	rows: RowFlag[];
	rules: RuleHit[];
	warnings: string[];
}

export const EMPTY_FLAGS: FlagOutcome = {
	flagged_count: 0,
	rows: [],
	rules: [],
	warnings: [],
};

/** One query's section of a connection's flagged view. */
export interface FlaggedQuery {
	query_id: string;
	query_name: string;
	columns: string[];
	rows: { index: number; rule_ids: string[]; values: Row }[];
	rules: RuleHit[];
	warnings: string[];
	flagged_count: number;
	executed_at: string | null;
	/** No cached result: never run, or the entry aged out. Not an error. */
	stale: boolean;
	error_code: string | null;
	error_message: string | null;
}

export interface ConnectionFlagged {
	connection_id: string;
	queries: FlaggedQuery[];
	flagged_count: number;
	refreshed: boolean;
	/** True when FAE_FLAGGED_REFRESH_MAX_QUERIES capped the refresh. */
	refresh_truncated: boolean;
}

export interface PreviewRequest {
	sql_text: string;
	row_limit?: number | null;
	/** Unsaved rules, evaluated against the preview rows and discarded. */
	flag_rules?: FlagRule[];
}

export interface PreviewResponse {
	connection_id: string;
	executed_at: string;
	duration_ms: number;
	row_count: number;
	truncated: boolean;
	columns: string[];
	rows: Row[];
	flags: FlagOutcome;
}

export interface RunResponse {
	query_id: string;
	executed_at: string;
	duration_ms: number;
	row_count: number;
	truncated: boolean;
	data_hash: string;
	columns: string[];
	rows: Row[];
	chart: ChartSpec;
	flags: FlagOutcome;
	poll_interval_ms: number;
}

export interface PollChanged extends RunResponse {
	changed?: true;
	from_cache?: boolean;
}

export interface PollUnchanged {
	query_id: string;
	changed?: false;
	data_hash: string;
	poll_interval_ms: number;
	from_cache: boolean;
}

export type PollResponse = PollChanged | PollUnchanged;

/**
 * The engine omits `changed` when it defaults, so presence of `rows` is the
 * only reliable discriminator between the two poll shapes.
 */
export function isPollChanged(poll: PollResponse): poll is PollChanged {
	return poll.changed !== false && Array.isArray((poll as PollChanged).rows);
}

export interface ExecutionLogRead {
	id: string;
	query_id: string;
	executed_at: string;
	row_count: number | null;
	duration_ms: number | null;
	success: boolean;
	error_code: string | null;
	error_message: string | null;
}

/**
 * A named, ordered arrangement of saved queries. May span connections.
 *
 * `query_ids` is the display order. The engine keeps it honest: deleting a
 * saved query removes it from every dashboard, so this list never names
 * something that no longer exists.
 */
export interface DashboardRead {
	id: string;
	name: string;
	query_ids: string[];
	created_at: string;
	updated_at: string;
}

export interface DashboardCreate {
	name: string;
	query_ids?: string[];
}

export interface DashboardUpdate {
	name?: string;
	/** Replaces the whole arrangement rather than merging into it. */
	query_ids?: string[];
}

/** Error envelope the engine returns on 4xx/5xx. */
export interface ApiErrorBody {
	error_code?: string | null;
	message?: string | null;
	detail?: unknown;
}
