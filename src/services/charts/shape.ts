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
import {
  type ChangeVerdict,
  DEFAULT_SURGE_THRESHOLD_PCT,
  bucketSurges,
  judgeChange,
  resolveThreshold,
} from "./severity";
import {
  MAX_PLOT_POINTS,
  MAX_PLOT_SERIES,
  OTHER_SERIES_LABEL,
  downsampleIndicesPreservingAlerts,
  downsamplePreservingAlerts,
} from "./downsample";

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
  [key: string]: Cell | Record<string, boolean> | Record<string, FlagMark> | undefined;
  __alert?: Record<string, boolean>;
  /** Per series: which rules flagged this point, and how badly. */
  __flag?: Record<string, FlagMark>;
}

/**
 * Why a mark is flagged: the rules that matched the row(s) behind it and the
 * worst severity among them. A boolean says "look here"; this says what to look
 * for, which is what makes the chart readable without opening the table.
 */
export interface FlagMark {
  rules: string[];
  severity: FlagSeverity | null;
}

const SEVERITY_RANK: Record<FlagSeverity, number> = { low: 1, medium: 2, high: 3 };

/** Fold another row's rules into a mark: union of names, worst severity. */
export function mergeFlagMark(
  into: FlagMark | undefined,
  rules: readonly string[],
  severity: FlagSeverity | null,
): FlagMark {
  if (!into) return { rules: [...new Set(rules)], severity };
  const names = new Set(into.rules);
  for (const rule of rules) names.add(rule);
  const worst =
    severity !== null &&
    (into.severity === null || SEVERITY_RANK[severity] > SEVERITY_RANK[into.severity])
      ? severity
      : into.severity;
  return { rules: [...names], severity: worst };
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
/**
 * Fold every series past the palette into one bucket, in place.
 *
 * Points are mutated rather than rebuilt because they were created a few lines
 * above and nothing else has seen them yet, and rebuilding 625 objects to
 * change four keys is work with no reader.
 *
 * The kept series stay in first-seen order rather than being re-ranked by
 * volume. Colour comes from position, and this chart re-polls every few
 * seconds: ranking would let two terminals swap colours mid-shift because one
 * overtook the other, which is a worse lie than an arbitrary but stable order.
 */
function foldSeriesTail(
  points: ChartPoint[],
  xKey: string,
  seriesKeys: string[],
  totals: Map<string, number>,
): { seriesKeys: string[]; label: string; folded: number } {
  const ranked = [...seriesKeys].sort(
    (a, b) => Math.abs(totals.get(b) ?? 0) - Math.abs(totals.get(a) ?? 0),
  );
  const kept = new Set(ranked.slice(0, MAX_PLOT_SERIES - 1));
  const tail = ranked.slice(MAX_PLOT_SERIES - 1);

  // A series genuinely called "Other" must not be silently swallowed by the
  // bucket named after it, so the label is nudged until it is free.
  let label = OTHER_SERIES_LABEL;
  let suffix = 2;
  while (seriesKeys.includes(label)) {
    label = `${OTHER_SERIES_LABEL} (${suffix})`;
    suffix += 1;
  }

  // Kept series in first-seen order rather than re-ranked by volume. Colour
  // comes from position and this chart re-polls every few seconds: ranking
  // would let two terminals swap colours mid-shift because one overtook the
  // other, which is a worse lie than an arbitrary but stable order.
  const keptOrder = seriesKeys.filter((name) => kept.has(name));

  /*
   * Each point is rebuilt rather than having its folded keys deleted. `delete`
   * drops a V8 object out of its hidden class into dictionary mode, and at 625
   * buckets against 36 folded terminals that is 22,500 of them - measurably
   * more expensive than building 625 small objects from scratch.
   */
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const mask = (point.__alert ?? {}) as Record<string, boolean>;
    const marks = point.__flag;

    let sum = 0;
    let present = false;
    let alert = false;
    let foldedMark: FlagMark | undefined;
    for (const name of tail) {
      if (marks?.[name]) {
        foldedMark = mergeFlagMark(foldedMark, marks[name].rules, marks[name].severity);
      }
      const value = point[name];
      if (typeof value === "number") {
        sum += value;
        present = true;
      }
      if (mask[name] === true) alert = true;
    }

    const nextMask: Record<string, boolean> = {};
    const nextMarks: Record<string, FlagMark> = {};
    const next: ChartPoint = { [xKey]: point[xKey] as Cell };
    for (const name of keptOrder) {
      const value = point[name];
      if (value !== undefined) next[name] = value;
      if (mask[name] === true) nextMask[name] = true;
      if (marks?.[name]) nextMarks[name] = marks[name];
    }
    // A bucket with no rows in any folded series stays absent rather than
    // becoming a zero: the two mean different things on a line chart.
    if (present) next[label] = sum;
    if (alert) nextMask[label] = true;
    if (foldedMark) nextMarks[label] = foldedMark;
    next.__alert = nextMask;
    if (Object.keys(nextMarks).length > 0) next.__flag = nextMarks;

    points[index] = next;
  }

  return { seriesKeys: [...keptOrder, label], label, folded: tail.length };
}

export function buildCartesian(result: ResultSet): CartesianData {
  const { columns, rows } = result;
  const fields = resolveFields(result);
  if (!fields.xKey || !fields.yKey) {
    return { ...EMPTY_CARTESIAN, warnings: fields.warnings };
  }

  const xIndex = columns.indexOf(fields.xKey);
  const yIndex = columns.indexOf(fields.yKey);
  const warnings = [...fields.warnings];

  const anomalies = detectRowAnomalies({
    columns,
    rows,
    valueColumn: fields.yKey,
    flags: result.flags,
  });
  const flagged = anomalies.flags;

  if (!fields.seriesKey) {
    const xKey = fields.xKey;
    const yKey = fields.yKey;

    /*
     * Values first, chart objects second.
     *
     * Recharts draws SVG, so every point is a DOM node. Ten thousand of them
     * for a plot 900px wide is ten points per pixel column: slower and no more
     * informative. Choosing *which* points survive needs only the numbers, so
     * the 25,000 objects this used to build and then discard are never built -
     * only the 900 that get drawn. Flagged points are exempt from the thinning,
     * because a finding missing from the chart would disagree with the table
     * beside it.
     */
    const values = new Float64Array(rows.length);
    for (let index = 0; index < rows.length; index += 1) {
      values[index] = toNumber(rows[index][yIndex]);
    }

    const kept = downsampleIndicesPreservingAlerts(
      rows.length,
      (index) => values[index],
      (index) => flagged[index] === true,
      MAX_PLOT_POINTS,
    );

    const point = (index: number): ChartPoint => ({
      [xKey]: rows[index][xIndex] ?? null,
      [yKey]: values[index],
      __alert: { [yKey]: flagged[index] === true },
      ...(flagged[index] === true
        ? {
            __flag: {
              [yKey]: mergeFlagMark(
                undefined,
                anomalies.ruleNames[index] ?? [],
                anomalies.severities[index] ?? null,
              ),
            },
          }
        : {}),
    });

    const data: ChartPoint[] = kept
      ? kept.map(point)
      : rows.map((_row, index) => point(index));

    let hasAlerts = false;
    for (let index = 0; index < flagged.length; index += 1) {
      if (flagged[index]) {
        hasAlerts = true;
        break;
      }
    }

    return {
      data,
      seriesKeys: [yKey],
      xKey,
      yKey,
      warnings,
      hasAlerts,
      alertReason: hasAlerts ? anomalies.reason : "none",
      alertSource: hasAlerts ? anomalies.source : null,
    };
  }

  // ---- pivot long -> wide, preserving first-seen order on both axes
  const seriesIndex = columns.indexOf(fields.seriesKey);
  const byX = new Map<string, ChartPoint>();
  const seriesKeys: string[] = [];
  // Doubles as the first-seen register and the ranking the fold below needs.
  const seriesTotals = new Map<string, number>();

  let hasAlerts = false;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const xRaw = row[xIndex] ?? null;
    const xLabel = String(xRaw);
    const seriesName = String(row[seriesIndex] ?? "unknown");
    const value = toNumber(row[yIndex]);

    let point = byX.get(xLabel);
    if (!point) {
      point = { [fields.xKey]: xRaw, __alert: {} };
      byX.set(xLabel, point);
    }
    if (flagged[rowIndex] === true) {
      // A flagged row marks its own cell. Rows are summed into a cell, so one
      // flagged row among several is enough to mark it: the alert says "there
      // is something here to look at", not "every contribution matched".
      hasAlerts = true;
      point.__alert![seriesName] = true;
      const marks = (point.__flag ??= {});
      marks[seriesName] = mergeFlagMark(
        marks[seriesName],
        anomalies.ruleNames[rowIndex] ?? [],
        anomalies.severities[rowIndex] ?? null,
      );
    }
    // Repeated x/series pairs are summed: the analyst asked for a grouping the
    // SQL did not fully collapse, and dropping rows would understate volume.
    const previous = typeof point[seriesName] === "number" ? (point[seriesName] as number) : 0;
    const finite = Number.isFinite(value);
    point[seriesName] = finite ? previous + value : previous;

    const total = seriesTotals.get(seriesName);
    if (total === undefined) {
      seriesKeys.push(seriesName);
      seriesTotals.set(seriesName, finite ? value : 0);
    } else if (finite) {
      seriesTotals.set(seriesName, total + value);
    }
  }

  const pivoted = [...byX.values()];

  /*
   * Bound the series count, not only the point count.
   *
   * Forty terminals on one plot is forty marks at every x position - 25,000
   * SVG nodes for a 900px plot - and `seriesColor` clamps past the fifth
   * colour, so thirty-six of those lines are drawn in the same green and no
   * reader can tell them apart. Folding the tail is what the pie already does
   * with its wedges, for the same reason.
   */
  let plottedSeries = seriesKeys;
  if (seriesKeys.length > MAX_PLOT_SERIES) {
    const fold = foldSeriesTail(pivoted, fields.xKey, seriesKeys, seriesTotals);
    plottedSeries = fold.seriesKeys;
    warnings.push(
      `Summed ${fold.folded} of ${seriesKeys.length} series into "${fold.label}": the palette holds ${MAX_PLOT_SERIES}.`,
    );
  }

  // Same reasoning as the single-series branch. A pivoted point carries one
  // value per series, so "the" value for shape purposes is the first series -
  // enough to place the point, while any alert on any series keeps it.
  const primary = plottedSeries[0];
  const data = primary
    ? (downsamplePreservingAlerts(
        pivoted,
        MAX_PLOT_POINTS,
        (point) =>
          typeof point[primary] === "number" ? (point[primary] as number) : Number.NaN,
        (point) => Object.keys((point.__alert as Record<string, boolean>) ?? {}).length > 0,
      ) as ChartPoint[])
    : pivoted;

  return {
    data,
    seriesKeys: plottedSeries,
    xKey: fields.xKey,
    yKey: fields.yKey,
    warnings,
    hasAlerts,
    alertReason: hasAlerts ? anomalies.reason : "none",
    alertSource: hasAlerts ? anomalies.source : null,
  };
}

// ---------------------------------------------------------------------------
// Two measures on two axes
// ---------------------------------------------------------------------------

export interface BiaxialData {
  /** One point per x. The two measures live under their own column names. */
  data: ChartPoint[];
  xKey: string;
  /** Plotted against the left axis. */
  leftKey: string;
  /** Plotted against the right axis. */
  rightKey: string;
  warnings: string[];
  hasAlerts: boolean;
}

const EMPTY_BIAXIAL: BiaxialData = {
  data: [],
  xKey: "",
  leftKey: "",
  rightKey: "",
  warnings: [],
  hasAlerts: false,
};

/**
 * Two different measures over one category axis, each against its own y axis.
 *
 * The use is a count beside a rate: approved volume in the thousands next to a
 * decline percentage under one, which on a shared axis would flatten the rate
 * into the floor. Each measure gets the scale that suits it.
 *
 * A chart spec names one `y_field`, so the second measure rides in
 * `series_field`, read here as "the column for the right-hand axis". That keeps
 * the wire contract unchanged and suits the natural shape of the query: one row
 * per x with a column per measure (wide form), not the long form a real series
 * split needs. `y_field` is the left axis.
 *
 * A row flags both of its bars: the rule matched the row, not one column of it.
 */
export function buildBiaxial(result: ResultSet): BiaxialData {
  const { columns, rows } = result;
  const fields = resolveFields(result);
  const warnings = [...fields.warnings];

  if (!fields.xKey || !fields.yKey) return { ...EMPTY_BIAXIAL, warnings };
  if (!fields.seriesKey) {
    return {
      ...EMPTY_BIAXIAL,
      warnings: [
        ...warnings,
        "A two-axis chart needs a second measure: set the right-axis column (series field).",
      ],
    };
  }
  if (fields.seriesKey === fields.yKey) {
    return {
      ...EMPTY_BIAXIAL,
      warnings: [
        ...warnings,
        `Both axes point at "${fields.yKey}". Pick a different column for the right axis.`,
      ],
    };
  }

  const xIndex = columns.indexOf(fields.xKey);
  const leftIndex = columns.indexOf(fields.yKey);
  const rightIndex = columns.indexOf(fields.seriesKey);
  const { xKey, yKey: leftKey, seriesKey: rightKey } = fields;

  const anomalies = detectRowAnomalies({
    columns,
    rows,
    valueColumn: leftKey,
    flags: result.flags,
  });
  const flagged = anomalies.flags;

  const points: ChartPoint[] = rows.map((row, index) => {
    const left = toNumber(row[leftIndex]);
    const right = toNumber(row[rightIndex]);
    const isFlagged = flagged[index] === true;
    const point: ChartPoint = {
      [xKey]: row[xIndex] ?? null,
      // NaN becomes null: Recharts draws a gap for a missing value, where NaN
      // draws a bar of unknown height.
      [leftKey]: Number.isFinite(left) ? left : null,
      [rightKey]: Number.isFinite(right) ? right : null,
      __alert: { [leftKey]: isFlagged, [rightKey]: isFlagged },
    };
    if (isFlagged) {
      const mark = mergeFlagMark(
        undefined,
        anomalies.ruleNames[index] ?? [],
        anomalies.severities[index] ?? null,
      );
      point.__flag = { [leftKey]: mark, [rightKey]: mark };
    }
    return point;
  });

  const hasAlerts = flagged.some(Boolean);
  const data = downsamplePreservingAlerts(
    points,
    MAX_PLOT_POINTS,
    (point) => (typeof point[leftKey] === "number" ? (point[leftKey] as number) : Number.NaN),
    (point) => Object.values((point.__alert ?? {}) as Record<string, boolean>).some(Boolean),
  ) as ChartPoint[];

  return { data, xKey, leftKey, rightKey, warnings, hasAlerts };
}

export interface PieSlice {
  name: string;
  value: number;
  alert: boolean;
  /** Rules that flagged any row behind this slice, and the worst severity. */
  rules: string[];
  severity: FlagSeverity | null;
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

  // Categories are merged rather than drawn twice.
  //
  // A pie is a breakdown by category, so two slices with the same name are not
  // two things - they are one thing the query returned on two rows, and drawing
  // them separately makes the same label appear twice in the legend for two
  // wedges nobody can tell apart. It also happens constantly in practice: a
  // chart whose category and value are the same column produces a duplicate for
  // every repeated value.
  //
  // A merged slice is flagged if any of the rows behind it was, because the
  // wedge stands for all of them.
  const merged = new Map<string, PieSlice>();
  for (const [index, row] of rows.entries()) {
    const name =
      row[nameIndex] === null || row[nameIndex] === undefined
        ? "NULL"
        : String(row[nameIndex]);
    const value = Math.max(0, toNumber(row[valueIndex]) || 0);
    const alert = anomalies.flags[index] === true;

    const existing = merged.get(name);
    const names = alert ? (anomalies.ruleNames[index] ?? []) : [];
    const severity = alert ? (anomalies.severities[index] ?? null) : null;

    if (existing) {
      existing.value += value;
      existing.alert = existing.alert || alert;
      if (alert) {
        const mark = mergeFlagMark(
          { rules: existing.rules, severity: existing.severity },
          names,
          severity,
        );
        existing.rules = mark.rules;
        existing.severity = mark.severity;
      }
    } else {
      merged.set(name, { name, value, alert, rules: [...new Set(names)], severity });
    }
  }

  const slices = [...merged.values()];

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

/**
 * Which columns are numeric, in one pass over the rows instead of one pass per
 * column.
 *
 * `columnIsNumeric` per column re-walks the whole result once for every numeric
 * column that survives to the end - four full scans of 25,000 rows on a card
 * result with four numeric columns. One pass reads each row object once and
 * stops testing a column the moment it has seen a value that is not a number,
 * so the work shrinks as the answer is decided.
 */
function numericColumnMask(rows: Row[], columnCount: number): boolean[] {
  const numeric = new Array<boolean>(columnCount).fill(true);
  const seen = new Array<number>(columnCount).fill(0);
  let undecided = columnCount;

  for (let rowIndex = 0; rowIndex < rows.length && undecided > 0; rowIndex += 1) {
    const row = rows[rowIndex];
    for (let column = 0; column < columnCount; column += 1) {
      if (!numeric[column]) continue;
      const cell = row[column];
      if (cell === null || cell === undefined) continue;
      if (!Number.isFinite(toNumber(cell))) {
        numeric[column] = false;
        undecided -= 1;
        continue;
      }
      seen[column] += 1;
    }
  }

  // A column of nothing but NULLs is not a column of numbers.
  for (let column = 0; column < columnCount; column += 1) {
    if (seen[column] === 0) numeric[column] = false;
  }
  return numeric;
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
    numericColumns: numericColumnMask(rows, columns.length),
  };
}

// ---------------------------------------------------------------------------
// Period comparison
// ---------------------------------------------------------------------------

export interface ComparePoint {
  /** Bucket label from the current window. */
  bucket: string;
  /**
   * The bucket the `previous` value actually came from.
   *
   * The two windows are laid on one axis, so a point labelled "16:00" carries a
   * previous value measured at "04:00". Without this the tooltip would imply
   * both numbers were taken at the same time, which is the one way this chart
   * misleads.
   */
  previousBucket: string;
  current: number | null;
  previous: number | null;
  /** current - previous, or null when either side is missing. */
  delta: number | null;
  /** True when the current value is flagged. */
  alert?: boolean;
}

export interface CompareData {
  points: ComparePoint[];
  /** The window-over-window movement, judged against the threshold. */
  verdict: ChangeVerdict;
  /** Buckets that jumped past the threshold from the one directly before. */
  surges: { index: number; verdict: ChangeVerdict }[];
  /** The largest absolute gap between the two lines, and where it happened. */
  widestGap: { bucket: string; delta: number } | null;
  /** Totals for each window, which is what "up 12%" is read from. */
  currentTotal: number;
  previousTotal: number;
  warnings: string[];
  hasAlerts: boolean;
}

const EMPTY_COMPARE: CompareData = {
  points: [],
  verdict: {
    severity: "normal",
    pctChange: null,
    fromNothing: false,
    toNothing: false,
    threshold: DEFAULT_SURGE_THRESHOLD_PCT,
  },
  surges: [],
  widestGap: null,
  currentTotal: 0,
  previousTotal: 0,
  warnings: [],
  hasAlerts: false,
};

/**
 * The same measure over two consecutive windows, aligned so the gap is visible.
 *
 * The result is split in half by row order: the older half is the previous
 * window, the newer half is the current one, and they are laid on top of each
 * other by position within the window. A query returning two hours of
 * five-minute buckets therefore draws "the last hour" against "the hour before
 * it" with no extra SQL and no configuration.
 *
 * Splitting by position rather than by parsing timestamps is deliberate. The
 * engine never knows what a bucket column contains - it may be an hour, a date,
 * a label - and a chart that only works when the x axis parses as a date is a
 * chart that silently draws nothing the first time someone buckets by something
 * else. Position is what the analyst already ordered by.
 *
 * An odd number of rows drops the oldest, because a half-window would make the
 * two lines describe different amounts of time and the gap between them
 * meaningless.
 */
/**
 * Positions in the thinned array for surges detected on the full one.
 *
 * Surges are found before thinning, because a jump from one bucket to the next
 * is exactly the single-bucket event a downsampler is entitled to drop, and a
 * chart that reports fewer threshold crossings when the window gets longer is
 * lying. The thinning is told to keep every surge bucket, so this only ever
 * drops one in the degenerate case where surges alone exceed the plot budget.
 */
function remapSurges(
  surges: { index: number; verdict: ChangeVerdict }[],
  kept: number[] | null,
): { index: number; verdict: ChangeVerdict }[] {
  if (kept === null) return surges;
  const position = new Map<number, number>();
  for (let i = 0; i < kept.length; i += 1) position.set(kept[i], i);

  const remapped: { index: number; verdict: ChangeVerdict }[] = [];
  for (const surge of surges) {
    const index = position.get(surge.index);
    if (index !== undefined) remapped.push({ index, verdict: surge.verdict });
  }
  return remapped;
}

export function buildCompare(result: ResultSet): CompareData {
  const { columns, rows } = result;
  const fields = resolveFields(result);
  if (!fields.xKey || !fields.yKey) {
    return { ...EMPTY_COMPARE, warnings: fields.warnings };
  }

  const xIndex = columns.indexOf(fields.xKey);
  const yIndex = columns.indexOf(fields.yKey);
  const warnings = [...fields.warnings];
  const compareThreshold = resolveThreshold(result.chart.surge_threshold_pct);

  if (rows.length < 4) {
    // Two points a side is the least that can show a shape rather than a step.
    return {
      ...EMPTY_COMPARE,
      warnings: [
        ...warnings,
        "A comparison needs at least four rows: two windows of at least two buckets each.",
      ],
    };
  }

  const anomalies = detectRowAnomalies({
    columns,
    rows,
    valueColumn: fields.yKey,
    flags: result.flags,
  });
  const flagged = anomalies.flags;

  const half = Math.floor(rows.length / 2);
  const offset = rows.length - half * 2;
  if (offset > 0) {
    warnings.push(
      "An odd number of rows: the oldest was dropped so both windows cover the same span.",
    );
  }

  const previousStart = offset;
  const currentStart = offset + half;

  const label = (cell: Cell | undefined) =>
    cell === null || cell === undefined ? "" : String(cell);

  /*
   * Numbers first, points second.
   *
   * Totals, the widest gap and the surge scan all read values, and only the
   * buckets that survive thinning are ever drawn - so a long window of fine
   * buckets no longer builds 12,500 point objects to throw 11,600 of them
   * away. Totals and the widest gap are still computed over every bucket:
   * deriving the headline from the thinned set would make the number on the
   * card depend on how many pixels were available, and the largest divergence
   * is exactly the kind of single bucket a downsampler is entitled to drop.
   */
  const current = new Array<number | null>(half);
  const previous = new Array<number | null>(half);
  const alerts = new Array<boolean>(half);
  let currentTotal = 0;
  let previousTotal = 0;
  let widestIndex = -1;
  let widestDelta = 0;
  let hasAlerts = false;

  for (let index = 0; index < half; index += 1) {
    const currentValue = toNumber(rows[currentStart + index]?.[yIndex]);
    const previousValue = toNumber(rows[previousStart + index]?.[yIndex]);
    const currentCell = Number.isFinite(currentValue) ? currentValue : null;
    const previousCell = Number.isFinite(previousValue) ? previousValue : null;

    current[index] = currentCell;
    previous[index] = previousCell;
    currentTotal += currentCell ?? 0;
    previousTotal += previousCell ?? 0;

    if (currentCell !== null && previousCell !== null) {
      const delta = currentCell - previousCell;
      if (widestIndex === -1 || Math.abs(delta) > Math.abs(widestDelta)) {
        widestIndex = index;
        widestDelta = delta;
      }
    }

    const alert = flagged[currentStart + index] === true;
    alerts[index] = alert;
    if (alert) hasAlerts = true;
  }

  // Judged over the current window only: the two windows sit adjacent in the
  // array and are a whole window apart in time, so a step across the join is
  // not the "last bucket against this one" comparison it would look like.
  const surges = bucketSurges(current, compareThreshold);
  /*
   * Pinning every threshold crossing is pointless once there are more of them
   * than the plot can hold - the thinner drops back to plain LTTB in that case
   * regardless - and a noisy window of 12,500 buckets can cross on nearly every
   * one of them. So the set is only built when it can actually be honoured.
   */
  const pinned =
    surges.length < MAX_PLOT_POINTS ? new Set(surges.map((surge) => surge.index)) : null;

  const kept = downsampleIndicesPreservingAlerts(
    half,
    // Shape is judged on the current window: it is the subject of the chart,
    // and thinning against the previous line would preserve last hour's spikes
    // at the expense of this hour's.
    (index) => current[index] ?? previous[index] ?? 0,
    (index) => alerts[index] || pinned?.has(index) === true,
    MAX_PLOT_POINTS,
  );

  const point = (index: number): ComparePoint => {
    const currentCell = current[index];
    const previousCell = previous[index];
    return {
      bucket: label(rows[currentStart + index]?.[xIndex]),
      previousBucket: label(rows[previousStart + index]?.[xIndex]),
      current: currentCell,
      previous: previousCell,
      delta: currentCell !== null && previousCell !== null ? currentCell - previousCell : null,
      alert: alerts[index],
    };
  };

  const points: ComparePoint[] = [];
  if (kept === null) {
    for (let index = 0; index < half; index += 1) points.push(point(index));
  } else {
    for (const index of kept) points.push(point(index));
    warnings.push(`Plotting ${kept.length} of ${half} buckets; totals cover them all.`);
  }

  return {
    points,
    widestGap:
      widestIndex === -1
        ? null
        : { bucket: label(rows[currentStart + widestIndex]?.[xIndex]), delta: widestDelta },
    currentTotal,
    previousTotal,
    verdict: judgeChange(previousTotal, currentTotal, compareThreshold),
    surges: remapSurges(surges, kept),
    warnings,
    hasAlerts,
  };
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

export interface HeatCell {
  bucket: string;
  /** Rules that flagged any row behind this cell. Empty unless `alert`. */
  rules: string[];
  /** null means the query returned no row for this category/bucket pair. */
  value: number | null;
  /** 0..1 against the grid's own range. What the colour is drawn from. */
  intensity: number;
  alert: boolean;
}

export interface HeatRow {
  category: string;
  cells: HeatCell[];
  total: number;
}

export interface HeatmapData {
  buckets: string[];
  rows: HeatRow[];
  min: number;
  max: number;
  warnings: string[];
  hasAlerts: boolean;
}

const EMPTY_HEATMAP: HeatmapData = {
  buckets: [],
  rows: [],
  min: 0,
  max: 0,
  warnings: [],
  hasAlerts: false,
};

/**
 * How many categories a person can actually scan before the grid is wallpaper.
 * Beyond this the tail is dropped by total, keeping the rows worth looking at.
 */
export const MAX_HEAT_ROWS = 40;

/** Buckets are columns; past this they are narrower than a finger. */
export const MAX_HEAT_BUCKETS = 96;

/**
 * A category against a time bucket, coloured by a measure.
 *
 * This is the chart for "which terminal, and when". Fifty terminals as fifty
 * line charts is fifty things to read; as one grid, the hot row and the hot
 * column are pre-attentive - the eye finds them before it reads any label.
 *
 * `x_field` is the bucket (a column of the grid), `series_field` the category
 * (a row), `y_field` the measure. Repeated pairs are summed, the same way the
 * pie folds repeated categories, because two rows for one cell is one cell.
 *
 * Both axes are bounded. An unbounded grid over a busy day is hundreds of
 * columns of two-pixel cells, which is not a chart; the tail is dropped by
 * total and the drop is reported as a warning rather than done quietly.
 */
export function buildHeatmap(result: ResultSet): HeatmapData {
  const { columns, rows } = result;
  const fields = resolveFields(result);
  if (!fields.xKey || !fields.yKey || !fields.seriesKey) {
    return {
      ...EMPTY_HEATMAP,
      warnings: [
        ...fields.warnings,
        !fields.seriesKey
          ? "A heatmap needs a category column as well as a bucket and a value."
          : "A heatmap needs a bucket column and a value column.",
      ],
    };
  }

  const xIndex = columns.indexOf(fields.xKey);
  const yIndex = columns.indexOf(fields.yKey);
  const seriesIndex = columns.indexOf(fields.seriesKey);
  const warnings = [...fields.warnings];

  const anomalies = detectRowAnomalies({
    columns,
    rows,
    valueColumn: fields.yKey,
    flags: result.flags,
  });

  const label = (cell: Cell | undefined) =>
    cell === null || cell === undefined ? "" : String(cell);

  /*
   * The bucket window is decided before the grid is filled, not after.
   *
   * Insertion order is the query's ORDER BY, which is the order the analyst
   * asked for, so sorting here would silently reorder a deliberate axis - the
   * first pass only records which buckets exist and coerces each row's value
   * once. Filling the grid for every bucket and then dropping all but the last
   * 96 columns meant a 25,000-row result built 25,000 map entries to draw at
   * most 40 x 96 of them; deciding the window first keeps the grid the size of
   * the thing on screen.
   */
  const values = new Float64Array(rows.length);
  // Both passes need the bucket label, and `String()` over 25,000 cells is not
  // free enough to do twice.
  const bucketLabels = new Array<string>(rows.length);
  const bucketOrder: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < rows.length; index += 1) {
    const value = toNumber(rows[index][yIndex]);
    values[index] = value;
    if (!Number.isFinite(value)) continue;
    const bucket = label(rows[index][xIndex]);
    bucketLabels[index] = bucket;
    if (!seen.has(bucket)) {
      seen.add(bucket);
      bucketOrder.push(bucket);
    }
  }

  let buckets = bucketOrder;
  if (buckets.length > MAX_HEAT_BUCKETS) {
    // The newest buckets, not the oldest: a fraud queue reads the right edge.
    buckets = buckets.slice(-MAX_HEAT_BUCKETS);
    warnings.push(
      `Showing the most recent ${MAX_HEAT_BUCKETS} of ${bucketOrder.length} buckets.`,
    );
  }
  const bucketSet = new Set(buckets);

  const grid = new Map<
    string,
    Map<string, { value: number; alert: boolean; rules: string[] }>
  >();

  for (let index = 0; index < rows.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    const bucket = bucketLabels[index];
    // A category whose rows all fall outside the drawn window has nothing to
    // show; it used to occupy a row of 96 empty cells and a place in the
    // "busiest categories" count.
    if (!bucketSet.has(bucket)) continue;

    const category = label(rows[index][seriesIndex]);
    let cells = grid.get(category);
    if (!cells) {
      cells = new Map();
      grid.set(category, cells);
    }
    const existing = cells.get(bucket);
    const alert = anomalies.flags[index] === true;
    const names = alert ? (anomalies.ruleNames[index] ?? []) : [];
    if (existing) {
      existing.value += value;
      existing.alert = existing.alert || alert;
      if (alert) existing.rules = mergeFlagMark({ rules: existing.rules, severity: null }, names, null).rules;
    } else {
      cells.set(bucket, { value, alert, rules: [...new Set(names)] });
    }
  }

  if (grid.size === 0) {
    return { ...EMPTY_HEATMAP, warnings };
  }

  let built: HeatRow[] = [...grid.entries()].map(([category, cells]) => {
    let total = 0;
    const rowCells = buckets.map((bucket) => {
      const cell = cells.get(bucket);
      if (cell) total += cell.value;
      return {
        bucket,
        value: cell ? cell.value : null,
        intensity: 0,
        alert: cell ? cell.alert : false,
        rules: cell ? cell.rules : [],
      };
    });
    return { category, cells: rowCells, total };
  });

  if (built.length > MAX_HEAT_ROWS) {
    const dropped = built.length - MAX_HEAT_ROWS;
    built = [...built].sort((a, b) => b.total - a.total).slice(0, MAX_HEAT_ROWS);
    warnings.push(
      `Showing the ${MAX_HEAT_ROWS} busiest of ${MAX_HEAT_ROWS + dropped} categories.`,
    );
  }

  // A loop rather than Math.min(...values): the spread form is bounded here by
  // MAX_HEAT_ROWS x MAX_HEAT_BUCKETS, but it is one raised cap away from
  // blowing the argument limit, and a crash is a poor way to learn that.
  let min = 0;
  let max = 0;
  let anyValue = false;
  let hasAlerts = false;
  for (const row of built) {
    for (const cell of row.cells) {
      if (cell.alert) hasAlerts = true;
      if (cell.value === null) continue;
      if (!anyValue) {
        min = cell.value;
        max = cell.value;
        anyValue = true;
      } else {
        if (cell.value < min) min = cell.value;
        if (cell.value > max) max = cell.value;
      }
    }
  }

  // A flat grid is every cell equal; colouring that by (v-min)/(max-min) is a
  // divide by zero, and "all the same" is honestly drawn as one shade.
  const span = max - min;

  for (const row of built) {
    for (const cell of row.cells) {
      cell.intensity =
        cell.value === null ? 0 : span === 0 ? 1 : (cell.value - min) / span;
    }
  }

  return {
    buckets,
    rows: built,
    min,
    max,
    warnings,
    hasAlerts,
  };
}

// ---------------------------------------------------------------------------
// Two windows, split by bucket
// ---------------------------------------------------------------------------

interface BucketWindows {
  /** Bucket labels in the older half, in query order. */
  previousList: string[];
  /** Bucket labels in the newer half, in query order. */
  currentList: string[];
  previousBuckets: Set<string>;
  currentBuckets: Set<string>;
  warnings: string[];
}

/**
 * Split a result's *distinct buckets* down the middle: older half previous,
 * newer half current.
 *
 * Splitting by distinct bucket rather than by row position is what makes this
 * safe for a result grouped by (bucket, category). Such a result interleaves
 * categories inside every bucket, so halving the row list cuts through the
 * middle of a bucket and files one terminal's 09:00 under "previous" while its
 * neighbour's 09:00 lands under "current" - every total silently wrong, with
 * nothing on screen to suggest it. Bucket order is the only thing carrying time
 * in that shape.
 *
 * Returns null when there is no second bucket to compare against. An odd count
 * drops the oldest bucket, because two windows covering different spans make
 * the difference between them meaningless.
 */
function splitBucketWindows(rows: Row[], xIndex: number): BucketWindows | null {
  const buckets: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const cell = row[xIndex];
    const bucket = cell === null || cell === undefined ? "" : String(cell);
    if (!seen.has(bucket)) {
      seen.add(bucket);
      buckets.push(bucket);
    }
  }

  if (buckets.length < 2) return null;

  const half = Math.floor(buckets.length / 2);
  const offset = buckets.length - half * 2;
  const previousList = buckets.slice(offset, offset + half);
  const currentList = buckets.slice(offset + half);

  return {
    previousList,
    currentList,
    previousBuckets: new Set(previousList),
    currentBuckets: new Set(currentList),
    warnings:
      offset > 0
        ? ["An odd number of buckets: the oldest was dropped so both windows cover the same span."]
        : [],
  };
}

/** First and last label of a window, for naming what was compared. */
function spanOf(list: string[]): [string, string] | null {
  return list.length === 0 ? null : [list[0], list[list.length - 1]];
}

// ---------------------------------------------------------------------------
// Movers: two windows, totalled per category
// ---------------------------------------------------------------------------

export interface MoverRow {
  category: string;
  previous: number;
  current: number;
  /** current - previous. The number the rows are ranked by. */
  delta: number;
  /**
   * Proportional change, or null when the previous window was zero. A ratio
   * against zero has no value, and printing one invites acting on it.
   */
  pctChange: number | null;
  /** True when any row behind either window total was flagged. */
  alert: boolean;
  /** The movement, judged against the chart's threshold. */
  verdict: ChangeVerdict;
}

export interface MoversData {
  rows: MoverRow[];
  /** The threshold every row here was judged against, in percent. */
  threshold: number;
  /** Categories that crossed it, counted before the ranking was capped. */
  surgingCount: number;
  previousTotal: number;
  currentTotal: number;
  /** Bucket labels each window spans, so the card can name what it compared. */
  previousSpan: [string, string] | null;
  currentSpan: [string, string] | null;
  /** Largest single-category value in either window; the bar scale. */
  scaleMax: number;
  warnings: string[];
  hasAlerts: boolean;
}

const EMPTY_MOVERS: MoversData = {
  rows: [],
  threshold: 0,
  surgingCount: 0,
  previousTotal: 0,
  currentTotal: 0,
  previousSpan: null,
  currentSpan: null,
  scaleMax: 0,
  warnings: [],
  hasAlerts: false,
};

/** Past this the list stops being a ranking and becomes a directory. */
export const MAX_MOVER_ROWS = 60;

/**
 * The same two windows as `buildCompare`, totalled per category.
 *
 * `buildCompare` answers "did this move". This answers "which terminal moved",
 * which is the question that names a suspect: an hour where total volume held
 * steady while one terminal quadrupled and another went dark reads as flat on a
 * time overlay and as two obvious rows here.
 *
 * The split is by *distinct bucket*, not by row position. A result grouped by
 * (bucket, terminal) interleaves terminals within every bucket, so halving the
 * row list would cut through the middle of a bucket and assign one terminal's
 * 09:00 to the previous window and another's to the current. Bucket order is
 * the only thing that carries time here.
 *
 * Rows are ranked by the size of the change rather than by either total,
 * because the biggest terminal is a fact an analyst already knows and the
 * biggest *change* is the one they do not.
 */
export function buildMovers(result: ResultSet): MoversData {
  const { columns, rows } = result;
  const fields = resolveFields(result);
  if (!fields.xKey || !fields.yKey || !fields.seriesKey) {
    return {
      ...EMPTY_MOVERS,
      warnings: [
        ...fields.warnings,
        !fields.seriesKey
          ? "Comparing per category needs a category column as well as a bucket and a measure."
          : "Comparing two windows needs a bucket column and a measure column.",
      ],
    };
  }

  const xIndex = columns.indexOf(fields.xKey);
  const yIndex = columns.indexOf(fields.yKey);
  const seriesIndex = columns.indexOf(fields.seriesKey);
  const warnings = [...fields.warnings];
  const moversThreshold = resolveThreshold(result.chart.surge_threshold_pct);

  const label = (cell: Cell | undefined) =>
    cell === null || cell === undefined ? "" : String(cell);

  const split = splitBucketWindows(rows, xIndex);
  if (!split) {
    return {
      ...EMPTY_MOVERS,
      threshold: moversThreshold,
      warnings: [
        ...warnings,
        "Comparing two windows needs at least two time buckets in the result.",
      ],
    };
  }
  warnings.push(...split.warnings);
  const { previousBuckets, currentBuckets } = split;

  const anomalies = detectRowAnomalies({
    columns,
    rows,
    valueColumn: fields.yKey,
    flags: result.flags,
  });

  const totals = new Map<string, { previous: number; current: number; alert: boolean }>();
  for (const [index, row] of rows.entries()) {
    const bucket = label(row[xIndex]);
    const inPrevious = previousBuckets.has(bucket);
    // A dropped odd bucket belongs to neither window.
    if (!inPrevious && !currentBuckets.has(bucket)) continue;

    const value = toNumber(row[yIndex]);
    if (!Number.isFinite(value)) continue;

    const category = label(row[seriesIndex]);
    let entry = totals.get(category);
    if (!entry) {
      entry = { previous: 0, current: 0, alert: false };
      totals.set(category, entry);
    }
    if (inPrevious) entry.previous += value;
    else entry.current += value;
    if (anomalies.flags[index] === true) entry.alert = true;
  }

  if (totals.size === 0) {
    return { ...EMPTY_MOVERS, threshold: moversThreshold, warnings };
  }

  let ranked: MoverRow[] = [...totals.entries()]
    .map(([category, entry]) => ({
      category,
      previous: entry.previous,
      current: entry.current,
      delta: entry.current - entry.previous,
      pctChange:
        entry.previous === 0 ? null : (entry.current - entry.previous) / Math.abs(entry.previous),
      alert: entry.alert,
      verdict: judgeChange(entry.previous, entry.current, moversThreshold),
    }))
    // Largest movement first, either direction: a terminal going dark is as
    // much a finding as one lighting up.
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Before the cap, so the count describes the data rather than the rows that
  // happened to fit.
  const moversSurging = ranked.filter((row) => row.verdict.severity !== "normal").length;

  if (ranked.length > MAX_MOVER_ROWS) {
    warnings.push(
      `Showing the ${MAX_MOVER_ROWS} biggest movers of ${ranked.length} categories.`,
    );
    ranked = ranked.slice(0, MAX_MOVER_ROWS);
  }

  return {
    rows: ranked,
    threshold: moversThreshold,
    surgingCount: moversSurging,
    // Totalled over every category, including any the ranking cut, so the
    // headline describes the window rather than the visible rows.
    previousTotal: [...totals.values()].reduce((sum, entry) => sum + entry.previous, 0),
    currentTotal: [...totals.values()].reduce((sum, entry) => sum + entry.current, 0),
    previousSpan: spanOf(split.previousList),
    currentSpan: spanOf(split.currentList),
    scaleMax: ranked.reduce((max, row) => Math.max(max, row.previous, row.current), 0),
    warnings,
    hasAlerts: ranked.some((row) => row.alert),
  };
}

// ---------------------------------------------------------------------------
// Compare grid: one two-window panel per category
// ---------------------------------------------------------------------------

export interface ComparePanel {
  category: string;
  /** Aligned by position within each window, oldest first. */
  points: ComparePoint[];
  previousTotal: number;
  currentTotal: number;
  delta: number;
  /** Proportional change, or null when the previous window was zero. */
  pctChange: number | null;
  /** Largest value in either window, which is this panel's own y scale. */
  peak: number;
  alert: boolean;
  /** The window-over-window movement, judged against the chart's threshold. */
  verdict: ChangeVerdict;
  /**
   * Buckets that jumped past the threshold from the bucket directly before
   * them - the "last hour against this hour" reading. A panel whose six-hour
   * total barely moved can still have gone from four transactions to four
   * hundred in one hour, and that hour is the one worth opening.
   */
  surges: { index: number; verdict: ChangeVerdict }[];
}

export interface CompareGridData {
  panels: ComparePanel[];
  /** The threshold every panel here was judged against, in percent. */
  threshold: number;
  /**
   * Panels worth investigating: those whose window-over-window change crossed
   * the threshold, *or* that contain an hour that jumped past it.
   *
   * Both, because either alone under-reports. A terminal whose six-hour total
   * fell 77% while one hour inside it rose 18,000% is the exact shape a fraud
   * queue is looking for, and counting only window totals would report that
   * card as having nothing to look at.
   */
  surgingCount: number;
  previousSpan: [string, string] | null;
  currentSpan: [string, string] | null;
  /**
   * Bucket labels of the current window, every one of them.
   *
   * A panel's own `points` may be thinned to what its viewBox can draw, so this
   * describes the window rather than indexing any panel's points.
   */
  buckets: string[];
  warnings: string[];
  hasAlerts: boolean;
}

const EMPTY_GRID: CompareGridData = {
  panels: [],
  threshold: 0,
  surgingCount: 0,
  previousSpan: null,
  currentSpan: null,
  buckets: [],
  warnings: [],
  hasAlerts: false,
};

/** Past this the panels are too small to read a shape in. */
export const MAX_PANELS = 24;

/**
 * Points a single panel draws.
 *
 * The maximised panel's viewBox is 600 units wide, so 600 points is one per
 * unit - the same "no more points than pixels" rule `MAX_PLOT_POINTS` applies
 * to a full-width plot. A result bucketed by the minute rather than the hour
 * would otherwise put 12,500 points into each of 24 panels.
 */
export const MAX_PANEL_POINTS = 600;

/**
 * One `buildCompare` panel per category, ranked by how far each one moved.
 *
 * The three period charts answer three different questions and none of them
 * substitutes for another. `compare` shows the shape of everything at once, so
 * a terminal that quadrupled while another went dark reads as flat. `movers`
 * shows two totals per terminal, so a terminal moving the same volume at a
 * completely different time of night reads as unchanged. This shows the shape
 * *per* terminal, which is the only one of the three where a change of rhythm
 * is visible at all.
 *
 * Each panel keeps its own y scale and prints its own peak. A shared scale is
 * the textbook default for small multiples and it is wrong for this data: one
 * terminal doing twenty times the volume of the rest flattens every other panel
 * into a straight line at the axis, which is the failure the chart exists to
 * avoid. Per-panel scaling makes each shape readable, and the printed peak plus
 * the totals carry the level that the scaling gives up.
 */
export function buildCompareGrid(result: ResultSet): CompareGridData {
  const { columns, rows } = result;
  const fields = resolveFields(result);
  if (!fields.xKey || !fields.yKey || !fields.seriesKey) {
    return {
      ...EMPTY_GRID,
      warnings: [
        ...fields.warnings,
        !fields.seriesKey
          ? "A panel per category needs a category column as well as a bucket and a measure."
          : "Comparing two windows needs a bucket column and a measure column.",
      ],
    };
  }

  const xIndex = columns.indexOf(fields.xKey);
  const yIndex = columns.indexOf(fields.yKey);
  const seriesIndex = columns.indexOf(fields.seriesKey);
  const warnings = [...fields.warnings];
  const threshold = resolveThreshold(result.chart.surge_threshold_pct);

  const split = splitBucketWindows(rows, xIndex);
  if (!split) {
    return {
      ...EMPTY_GRID,
      threshold,
      warnings: [
        ...warnings,
        "Comparing two windows needs at least two time buckets in the result.",
      ],
    };
  }
  warnings.push(...split.warnings);

  const anomalies = detectRowAnomalies({
    columns,
    rows,
    valueColumn: fields.yKey,
    flags: result.flags,
  });

  const label = (cell: Cell | undefined) =>
    cell === null || cell === undefined ? "" : String(cell);

  // A bucket's position inside its window is what aligns the two lines: the
  // first hour of the previous window sits under the first hour of the current
  // one, whatever the labels say.
  const previousSlot = new Map(split.previousList.map((bucket, index) => [bucket, index]));
  const currentSlot = new Map(split.currentList.map((bucket, index) => [bucket, index]));
  const width = split.currentList.length;

  interface Accumulator {
    previous: (number | null)[];
    current: (number | null)[];
    alert: boolean[];
    flagged: boolean;
  }
  const byCategory = new Map<string, Accumulator>();

  for (const [index, row] of rows.entries()) {
    const bucket = label(row[xIndex]);
    const inPrevious = previousSlot.get(bucket);
    const inCurrent = currentSlot.get(bucket);
    // A dropped odd bucket belongs to neither window.
    if (inPrevious === undefined && inCurrent === undefined) continue;

    const value = toNumber(row[yIndex]);
    if (!Number.isFinite(value)) continue;

    const category = label(row[seriesIndex]);
    let entry = byCategory.get(category);
    if (!entry) {
      entry = {
        previous: Array<number | null>(width).fill(null),
        current: Array<number | null>(width).fill(null),
        alert: Array<boolean>(width).fill(false),
        flagged: false,
      };
      byCategory.set(category, entry);
    }

    const flagged = anomalies.flags[index] === true;
    if (flagged) entry.flagged = true;

    // Repeated (bucket, category) pairs are summed, the way every other chart
    // here folds a duplicate: two rows for one slot is one slot.
    if (inCurrent !== undefined) {
      entry.current[inCurrent] = (entry.current[inCurrent] ?? 0) + value;
      if (flagged) entry.alert[inCurrent] = true;
    } else if (inPrevious !== undefined && inPrevious < width) {
      entry.previous[inPrevious] = (entry.previous[inPrevious] ?? 0) + value;
    }
  }

  if (byCategory.size === 0) {
    return { ...EMPTY_GRID, threshold, warnings };
  }

  /*
   * Summarise every category, then materialise points for the panels that
   * survive the cap.
   *
   * Totals, the peak, the verdict and the threshold crossings are all read off
   * the accumulator arrays, so the ranking and the card's summary describe
   * every category - while the 40-odd categories that never reach the screen
   * no longer each build a window's worth of point objects first.
   */
  interface Summary {
    category: string;
    entry: Accumulator;
    previousTotal: number;
    currentTotal: number;
    delta: number;
    peak: number;
    verdict: ChangeVerdict;
    surges: { index: number; verdict: ChangeVerdict }[];
  }

  const summaries: Summary[] = [];
  for (const [category, entry] of byCategory) {
    let previousTotal = 0;
    let currentTotal = 0;
    let peak = 0;
    for (let slot = 0; slot < width; slot += 1) {
      const currentValue = entry.current[slot] ?? 0;
      const previousValue = entry.previous[slot] ?? 0;
      currentTotal += currentValue;
      previousTotal += previousValue;
      if (currentValue > peak) peak = currentValue;
      if (previousValue > peak) peak = previousValue;
    }
    summaries.push({
      category,
      entry,
      previousTotal,
      currentTotal,
      delta: currentTotal - previousTotal,
      peak,
      verdict: judgeChange(previousTotal, currentTotal, threshold),
      // Judged over the current window only. Running it across the join
      // between the two windows would compare the last hour of six hours ago
      // against the first hour of this one - two buckets that are adjacent in
      // the array and hours apart in time.
      surges: bucketSurges(entry.current, threshold),
    });
  }

  // Biggest movement first, either direction, so the panels worth reading are
  // in the first screen and the scan can stop when they go quiet.
  summaries.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Counted before the cap: the card's summary describes the data, not the
  // subset that happened to fit.
  const surgingCount = summaries.filter(
    (summary) => summary.verdict.severity !== "normal" || summary.surges.length > 0,
  ).length;

  let ranked = summaries;
  if (ranked.length > MAX_PANELS) {
    warnings.push(`Showing the ${MAX_PANELS} biggest movers of ${ranked.length} categories.`);
    ranked = ranked.slice(0, MAX_PANELS);
  }

  let thinned = false;
  const panels: ComparePanel[] = ranked.map((summary) => {
    const { entry } = summary;
    // Same guard as `buildCompare`: a pin set larger than the budget cannot be
    // honoured, so it is not built.
    const pinned =
      summary.surges.length < MAX_PANEL_POINTS
        ? new Set(summary.surges.map((surge) => surge.index))
        : null;

    // Every threshold crossing and every flagged bucket is pinned, so thinning
    // a long window can drop quiet stretches but never a finding.
    const kept = downsampleIndicesPreservingAlerts(
      width,
      (slot) => entry.current[slot] ?? entry.previous[slot] ?? 0,
      (slot) => entry.alert[slot] || pinned?.has(slot) === true,
      MAX_PANEL_POINTS,
    );
    if (kept !== null) thinned = true;

    const point = (slot: number): ComparePoint => {
      const current = entry.current[slot];
      const previous = entry.previous[slot];
      return {
        bucket: split.currentList[slot],
        previousBucket: split.previousList[slot] ?? "",
        current,
        previous,
        delta: current !== null && previous !== null ? current - previous : null,
        alert: entry.alert[slot],
      };
    };

    const points: ComparePoint[] = [];
    if (kept === null) {
      for (let slot = 0; slot < width; slot += 1) points.push(point(slot));
    } else {
      for (const slot of kept) points.push(point(slot));
    }

    return {
      category: summary.category,
      points,
      previousTotal: summary.previousTotal,
      currentTotal: summary.currentTotal,
      delta: summary.delta,
      pctChange:
        summary.previousTotal === 0
          ? null
          : (summary.currentTotal - summary.previousTotal) / Math.abs(summary.previousTotal),
      peak: summary.peak,
      alert: entry.flagged,
      verdict: summary.verdict,
      surges: remapSurges(summary.surges, kept),
    };
  });

  if (thinned) {
    warnings.push(
      `Plotting at most ${MAX_PANEL_POINTS} of ${width} buckets per panel; totals cover them all.`,
    );
  }

  return {
    panels,
    threshold,
    surgingCount,
    previousSpan: spanOf(split.previousList),
    currentSpan: spanOf(split.currentList),
    buckets: split.currentList,
    warnings,
    hasAlerts: panels.some((panel) => panel.alert),
  };
}

/**
 * An SVG polyline `points` attribute for one window of a panel.
 *
 * Kept here rather than in the view because it is arithmetic, not markup, and
 * because a line that silently bridges a gap is a correctness bug worth a test:
 * a missing bucket is a bucket with no rows, and drawing straight through it
 * invents activity that was never queried. Gaps therefore break the line into
 * separate segments instead.
 */
export function panelSegments(
  values: (number | null)[],
  width: number,
  height: number,
  peak: number,
): string[] {
  if (values.length === 0) return [];
  const scale = peak > 0 ? peak : 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;

  const segments: string[] = [];
  let run: string[] = [];
  for (const [index, value] of values.entries()) {
    if (value === null) {
      // Two points make a line; a lone point would render as nothing, so it is
      // dropped rather than emitted as an invisible segment.
      if (run.length > 1) segments.push(run.join(" "));
      run = [];
      continue;
    }
    const x = values.length > 1 ? index * step : width / 2;
    const y = height - (Math.max(0, value) / scale) * height;
    run.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  if (run.length > 1) segments.push(run.join(" "));
  return segments;
}
