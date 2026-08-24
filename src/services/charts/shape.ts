/**
 * Turns an engine result set into something a chart component can render.
 *
 * The engine is schema-agnostic: it hands back `columns: string[]` plus
 * `rows: Cell[][]` and a `ChartSpec` naming which columns to use. Everything
 * here is pure and deterministic - reshaping, not deciding. The one judgement
 * call is field fallback, and every fallback records a warning so the card can
 * tell the analyst that the axis was guessed rather than configured.
 */

import type { Cell, ChartSpec, FlagOutcome, FlagSeverity, Row } from "@/contracts/api";
import { detectRowAnomalies } from "@/services/anomaly";

export interface ResultSet {
  columns: string[];
  rows: Row[];
  chart: ChartSpec;
  /**
   * The engine's flag-rule outcome. Optional so a caller holding only a bare
   * result (a preview, a test fixture) still type-checks; when present and
   * When it names no rules nothing is flagged: the app never guesses.
   */
  flags?: FlagOutcome | null;
}

export interface ResolvedFields {
  xKey: string | null;
  yKey: string | null;
  seriesKey: string | null;
  warnings: string[];
}

/** Cell -> number, tolerating the numeric strings MySQL and SQLite return. */
export function toNumber(cell: Cell | undefined): number {
  if (typeof cell === "number") return cell;
  if (typeof cell === "boolean") return cell ? 1 : 0;
  if (cell === null || cell === undefined || cell === "") return Number.NaN;
  const parsed = Number(cell);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Is this column numeric across the sample? Used only for axis fallback. */
function columnIsNumeric(rows: Row[], index: number): boolean {
  let seen = 0;
  for (const row of rows) {
    const cell = row[index];
    if (cell === null || cell === undefined) continue;
    if (!Number.isFinite(toNumber(cell))) return false;
    seen += 1;
  }
  return seen > 0;
}

/**
 * True when the column arrives as actual numbers rather than numeric-looking
 * strings.
 *
 * Both are "numeric" for alignment purposes, but only one is reliably a
 * *measurement*. A driver returns a real number column as JS numbers; a bank
 * sort code, an account number or an external reference comes back as a string
 * even though every character in it is a digit. Preferring a true numeric
 * column when defaulting the value axis is what stops a table of
 * `code, name, collateral` plotting the sort codes.
 */
function columnIsRealNumber(rows: Row[], index: number): boolean {
  let seen = 0;
  for (const row of rows) {
    const cell = row[index];
    if (cell === null || cell === undefined) continue;
    if (typeof cell !== "number" || !Number.isFinite(cell)) return false;
    seen += 1;
  }
  return seen > 0;
}

/**
 * Decide which columns to plot. Honours the saved ChartSpec first; falls back
 * only when a named field is missing from the result set, which happens the
 * moment someone edits the SQL without updating the chart config.
 */
export function resolveFields(result: ResultSet): ResolvedFields {
  const { columns, rows, chart } = result;
  const warnings = [...(chart.warnings ?? [])];
  const has = (name: string | null): name is string =>
    Boolean(name) && columns.includes(name as string);

  let xKey: string | null = null;
  let yKey: string | null = null;
  let seriesKey: string | null = null;

  if (chart.x_field && !has(chart.x_field)) {
    warnings.push(`x_field "${chart.x_field}" is not in the result set`);
  }
  if (chart.y_field && !has(chart.y_field)) {
    warnings.push(`y_field "${chart.y_field}" is not in the result set`);
  }
  if (chart.series_field && !has(chart.series_field)) {
    warnings.push(`series_field "${chart.series_field}" is not in the result set`);
  }

  if (has(chart.series_field)) seriesKey = chart.series_field;
  if (has(chart.x_field)) xKey = chart.x_field;
  if (has(chart.y_field)) yKey = chart.y_field;

  if (!yKey) {
    const eligible = (name: string) => name !== xKey && name !== seriesKey;
    /*
     * A column of real numbers wins over one of numeric-looking strings, even
     * when the string column comes first. `SELECT code, name, collateral` used
     * to default its value axis to `code` - the sort code - because the digits
     * coerce; the magnitude the analyst meant is always the real number.
     */
    let candidate = columns.findIndex(
      (name, index) => eligible(name) && columnIsRealNumber(rows, index),
    );
    if (candidate === -1) {
      candidate = columns.findIndex(
        (name, index) => eligible(name) && columnIsNumeric(rows, index),
      );
    }
    if (candidate !== -1) {
      yKey = columns[candidate];
      if (chart.type !== "table") warnings.push(`value axis defaulted to "${yKey}"`);
    }
  }

  if (!xKey) {
    const candidate = columns.findIndex(
      (name, index) => name !== yKey && name !== seriesKey && !columnIsNumeric(rows, index),
    );
    const chosen = candidate !== -1 ? columns[candidate] : columns.find((name) => name !== yKey);
    if (chosen) {
      xKey = chosen;
      if (chart.type !== "number" && chart.type !== "table") {
        warnings.push(`category axis defaulted to "${xKey}"`);
      }
    }
  }

  return { xKey, yKey, seriesKey, warnings };
}

/**
 * One point on a line or bar chart. Series values live under their own column
 * names; `__alert` carries the per-series alert mask that drives the alert
 * colour, and is stripped before anything is rendered as a value.
 */
export interface ChartPoint {
  [key: string]: Cell | Record<string, boolean> | undefined;
  __alert?: Record<string, boolean>;
}

export interface CartesianData {
  data: ChartPoint[];
  /** One entry per rendered series; length > 1 only when pivoting. */
  seriesKeys: string[];
  xKey: string;
  yKey: string;
  warnings: string[];
  /** True when at least one point is flagged or anomalous. */
  hasAlerts: boolean;
  /** How alerts were decided, for the card's inline explanation. */
  alertReason: "flag-rule" | "none";
  alertSource: string | null;
}

export const EMPTY_CARTESIAN: CartesianData = {
  data: [],
  seriesKeys: [],
  xKey: "",
  yKey: "",
  warnings: [],
  hasAlerts: false,
  alertReason: "none",
  alertSource: null,
};

/**
 * Build line/bar data. When the spec names a series field the rows arrive in
 * long form (one row per x/series pair) and have to be pivoted to the wide form
 * Recharts expects (one object per x, one key per series).
 */
export function buildCartesian(result: ResultSet): CartesianData {
  const { columns, rows } = result;
  const fields = resolveFields(result);
  if (!fields.xKey || !fields.yKey) {
    return { ...EMPTY_CARTESIAN, warnings: fields.warnings };
  }

  const xIndex = columns.indexOf(fields.xKey);
  const yIndex = columns.indexOf(fields.yKey);

  if (!fields.seriesKey) {
    const anomalies = detectRowAnomalies({ columns, rows, valueColumn: fields.yKey, flags: result.flags });
    const data: ChartPoint[] = rows.map((row, index) => ({
      [fields.xKey as string]: row[xIndex] ?? null,
      [fields.yKey as string]: toNumber(row[yIndex]),
      __alert: { [fields.yKey as string]: anomalies.flags[index] === true },
    }));
    return {
      data,
      seriesKeys: [fields.yKey],
      xKey: fields.xKey,
      yKey: fields.yKey,
      warnings: fields.warnings,
      hasAlerts: anomalies.flags.some(Boolean),
      alertReason: anomalies.flags.some(Boolean) ? anomalies.reason : "none",
      alertSource: anomalies.flags.some(Boolean) ? anomalies.source : null,
    };
  }

  // ---- pivot long -> wide, preserving first-seen order on both axes
  const seriesIndex = columns.indexOf(fields.seriesKey);
  const byX = new Map<string, ChartPoint>();
  const seriesKeys: string[] = [];
  const seriesValues = new Map<string, number[]>();

  // The same outcome the single-series branch uses. This path used to ignore
  // flag rules entirely and run its own outlier test per series, so a chart
  // with a series field showed guesses instead of what the analyst wrote.
  const anomalies = detectRowAnomalies({
    columns,
    rows,
    valueColumn: fields.yKey,
    flags: result.flags,
  });
  let hasAlerts = false;

  for (const [rowIndex, row] of rows.entries()) {
    const xRaw = row[xIndex] ?? null;
    const xLabel = String(xRaw);
    const seriesName = String(row[seriesIndex] ?? "unknown");
    const value = toNumber(row[yIndex]);

    if (!byX.has(xLabel)) {
      byX.set(xLabel, { [fields.xKey]: xRaw, __alert: {} });
    }
    if (anomalies.flags[rowIndex] === true) {
      // A flagged row marks its own cell. Rows are summed into a cell, so one
      // flagged row among several is enough to mark it: the alert says "there
      // is something here to look at", not "every contribution matched".
      hasAlerts = true;
      (byX.get(xLabel) as ChartPoint).__alert![seriesName] = true;
    }
    // Repeated x/series pairs are summed: the analyst asked for a grouping the
    // SQL did not fully collapse, and dropping rows would understate volume.
    const point = byX.get(xLabel) as ChartPoint;
    const previous = typeof point[seriesName] === "number" ? (point[seriesName] as number) : 0;
    point[seriesName] = Number.isFinite(value) ? previous + value : previous;

    if (!seriesValues.has(seriesName)) {
      seriesKeys.push(seriesName);
      seriesValues.set(seriesName, []);
    }
  }

  const data = [...byX.values()];

  return {
    data,
    seriesKeys,
    xKey: fields.xKey,
    yKey: fields.yKey,
    warnings: fields.warnings,
    hasAlerts,
    alertReason: hasAlerts ? anomalies.reason : "none",
    alertSource: hasAlerts ? anomalies.source : null,
  };
}

export interface PieSlice {
  name: string;
  value: number;
  alert: boolean;
}

export interface PieData {
  slices: PieSlice[];
  total: number;
  warnings: string[];
  hasAlerts: boolean;
}

export function buildPie(result: ResultSet): PieData {
  const { columns, rows } = result;
  const fields = resolveFields(result);
  if (!fields.xKey || !fields.yKey) {
    return { slices: [], total: 0, warnings: fields.warnings, hasAlerts: false };
  }

  const nameIndex = columns.indexOf(fields.xKey);
  const valueIndex = columns.indexOf(fields.yKey);
  const anomalies = detectRowAnomalies({ columns, rows, valueColumn: fields.yKey, flags: result.flags });

  const slices = rows.map((row, index) => ({
    name: row[nameIndex] === null || row[nameIndex] === undefined
      ? "NULL"
      : String(row[nameIndex]),
    value: Math.max(0, toNumber(row[valueIndex]) || 0),
    alert: anomalies.flags[index] === true,
  }));

  return {
    slices,
    total: slices.reduce((sum, slice) => sum + slice.value, 0),
    warnings: fields.warnings,
    hasAlerts: slices.some((slice) => slice.alert),
  };
}

export interface NumberData {
  value: number | null;
  /** Raw cell, so non-numeric single results still render something true. */
  raw: Cell;
  label: string;
  warnings: string[];
  /** Extra rows the query returned beyond the one a number card can show. */
  extraRows: number;
}

/**
 * A number card reads the first row of the value column. When the query returns
 * more than one row that is a mismatch between SQL and chart type, and the card
 * says so rather than silently showing row one.
 */
export function buildNumber(result: ResultSet): NumberData {
  const { columns, rows } = result;
  const fields = resolveFields(result);
  const warnings = [...fields.warnings];

  const key = fields.yKey ?? columns[0] ?? null;
  if (!key || rows.length === 0) {
    return { value: null, raw: null, label: key ?? "", warnings, extraRows: 0 };
  }

  const index = columns.indexOf(key);
  const raw = rows[0][index] ?? null;
  const value = toNumber(raw);

  return {
    value: Number.isFinite(value) ? value : null,
    raw,
    label: key,
    warnings,
    extraRows: Math.max(0, rows.length - 1),
  };
}

export interface TableData {
  columns: string[];
  rows: Row[];
  /** Parallel to rows: which ones the analyst should look at first. */
  alerts: boolean[];
  alertReason: "flag-rule" | "none";
  alertSource: string | null;
  /** Per row: which rules caught it. Empty unless alertReason is "flag-rule". */
  alertRuleNames: string[][];
  /** Per row: highest severity among the matching rules, else null. */
  alertSeverities: (FlagSeverity | null)[];
  numericColumns: boolean[];
}

export function buildTable(result: ResultSet): TableData {
  const { columns, rows } = result;
  const fields = resolveFields(result);
  const anomalies = detectRowAnomalies({ columns, rows, valueColumn: fields.yKey, flags: result.flags });
  const any = anomalies.flags.some(Boolean);

  return {
    columns,
    rows,
    alerts: anomalies.flags,
    alertReason: any ? anomalies.reason : "none",
    alertSource: any ? anomalies.source : null,
    alertRuleNames: anomalies.ruleNames,
    alertSeverities: anomalies.severities,
    // Right-align numeric columns; a column of figures is unreadable ragged.
    numericColumns: columns.map((_, index) => columnIsNumeric(rows, index)),
  };
}
