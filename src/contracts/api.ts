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
export const CHART_TYPES: readonly ChartType[] = [
  "line",
  "bar",
  "pie",
  "number",
  "table",
];

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

export interface PreviewRequest {
  sql_text: string;
  row_limit?: number | null;
}

export interface PreviewResponse {
  connection_id: string;
  executed_at: string;
  duration_ms: number;
  row_count: number;
  truncated: boolean;
  columns: string[];
  rows: Row[];
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

/** Error envelope the engine returns on 4xx/5xx. */
export interface ApiErrorBody {
  error_code?: string | null;
  message?: string | null;
  detail?: unknown;
}
