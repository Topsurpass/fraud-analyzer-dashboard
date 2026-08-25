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
import { MAX_PLOT_POINTS, downsamplePreservingAlerts } from "./downsample";

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
    const full: ChartPoint[] = rows.map((row, index) => ({
      [fields.xKey as string]: row[xIndex] ?? null,
      [fields.yKey as string]: toNumber(row[yIndex]),
      __alert: { [fields.yKey as string]: anomalies.flags[index] === true },
    }));

    // Recharts draws SVG, so every point is a DOM node. Ten thousand of them
    // for a plot 900px wide is ten points per pixel column: slower and no more
    // informative. Flagged points are exempt - a finding missing from the chart
    // would disagree with the table beside it.
    const yKey = fields.yKey as string;
    const data = downsamplePreservingAlerts(
      full,
      MAX_PLOT_POINTS,
      (point) => (typeof point[yKey] === "number" ? (point[yKey] as number) : Number.NaN),
      (point) => (point.__alert as Record<string, boolean> | undefined)?.[yKey] === true,
    ) as ChartPoint[];

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

  const pivoted = [...byX.values()];

  // Same reasoning as the single-series branch. A pivoted point carries one
  // value per series, so "the" value for shape purposes is the first series -
  // enough to place the point, while any alert on any series keeps it.
  const primary = seriesKeys[0];
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
  const merged = new Map<string, { name: string; value: number; alert: boolean }>();
  for (const [index, row] of rows.entries()) {
    const name =
      row[nameIndex] === null || row[nameIndex] === undefined
        ? "NULL"
        : String(row[nameIndex]);
    const value = Math.max(0, toNumber(row[valueIndex]) || 0);
    const alert = anomalies.flags[index] === true;

    const existing = merged.get(name);
    if (existing) {
      existing.value += value;
      existing.alert = existing.alert || alert;
    } else {
      merged.set(name, { name, value, alert });
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
export function buildCompare(result: ResultSet): CompareData {
  const { columns, rows } = result;
  const fields = resolveFields(result);
  if (!fields.xKey || !fields.yKey) {
    return { ...EMPTY_COMPARE, warnings: fields.warnings };
  }

  const xIndex = columns.indexOf(fields.xKey);
  const yIndex = columns.indexOf(fields.yKey);
  const warnings = [...fields.warnings];

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

  const half = Math.floor(rows.length / 2);
  const offset = rows.length - half * 2;
  if (offset > 0) {
    warnings.push(
      "An odd number of rows: the oldest was dropped so both windows cover the same span.",
    );
  }

  const previousRows = rows.slice(offset, offset + half);
  const currentRows = rows.slice(offset + half);

  const points: ComparePoint[] = currentRows.map((row, index) => {
    const current = toNumber(row[yIndex]);
    const previous = toNumber(previousRows[index]?.[yIndex]);
    const label = (cell: Cell | undefined) =>
      cell === null || cell === undefined ? "" : String(cell);
    return {
      bucket: label(row[xIndex]),
      previousBucket: label(previousRows[index]?.[xIndex]),
      current: Number.isFinite(current) ? current : null,
      previous: Number.isFinite(previous) ? previous : null,
      delta:
        Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null,
      alert: anomalies.flags[offset + half + index] === true,
    };
  });

  const widest = points.reduce<ComparePoint | null>((worst, point) => {
    if (point.delta === null) return worst;
    if (worst === null || Math.abs(point.delta) > Math.abs(worst.delta as number)) {
      return point;
    }
    return worst;
  }, null);

  const sum = (values: (number | null)[]) =>
    values.reduce<number>((total, value) => total + (value ?? 0), 0);

  // Totals and the widest gap are computed on every bucket, then the series is
  // thinned only for plotting. Deriving the headline from the thinned set would
  // make the number on the card depend on how many pixels were available, and
  // the largest divergence is exactly the kind of single bucket a downsampler
  // is entitled to drop.
  const currentTotal = sum(points.map((point) => point.current));
  const previousTotal = sum(points.map((point) => point.previous));

  const plotted = downsamplePreservingAlerts(
    points,
    MAX_PLOT_POINTS,
    // Shape is judged on the current window: it is the subject of the chart,
    // and thinning against the previous line would preserve last hour's spikes
    // at the expense of this hour's.
    (point) => point.current ?? point.previous ?? 0,
    (point) => point.alert === true,
  );

  if (plotted.length < points.length) {
    warnings.push(
      `Plotting ${plotted.length} of ${points.length} buckets; totals cover them all.`,
    );
  }

  return {
    points: [...plotted],
    widestGap:
      widest && widest.delta !== null
        ? { bucket: widest.bucket, delta: widest.delta }
        : null,
    currentTotal,
    previousTotal,
    warnings,
    hasAlerts: points.some((point) => point.alert),
  };
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

export interface HeatCell {
  bucket: string;
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

  // Insertion order is the query's ORDER BY, which is the order the analyst
  // asked for. Sorting buckets here would silently reorder a deliberate axis.
  const bucketOrder: string[] = [];
  const seen = new Set<string>();
  const grid = new Map<string, Map<string, { value: number; alert: boolean }>>();

  for (const [index, row] of rows.entries()) {
    const bucket = label(row[xIndex]);
    const category = label(row[seriesIndex]);
    const value = toNumber(row[yIndex]);
    if (!Number.isFinite(value)) continue;

    if (!seen.has(bucket)) {
      seen.add(bucket);
      bucketOrder.push(bucket);
    }

    let cells = grid.get(category);
    if (!cells) {
      cells = new Map();
      grid.set(category, cells);
    }
    const existing = cells.get(bucket);
    const alert = anomalies.flags[index] === true;
    if (existing) {
      existing.value += value;
      existing.alert = existing.alert || alert;
    } else {
      cells.set(bucket, { value, alert });
    }
  }

  if (grid.size === 0) {
    return { ...EMPTY_HEATMAP, warnings };
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

  let built: HeatRow[] = [...grid.entries()].map(([category, cells]) => {
    const rowCells = buckets.map((bucket) => {
      const cell = cells.get(bucket);
      return {
        bucket,
        value: cell ? cell.value : null,
        intensity: 0,
        alert: cell ? cell.alert : false,
      };
    });
    const total = [...cells.entries()]
      .filter(([bucket]) => bucketSet.has(bucket))
      .reduce((sum, [, cell]) => sum + cell.value, 0);
    return { category, cells: rowCells, total };
  });

  if (built.length > MAX_HEAT_ROWS) {
    const dropped = built.length - MAX_HEAT_ROWS;
    built = [...built].sort((a, b) => b.total - a.total).slice(0, MAX_HEAT_ROWS);
    warnings.push(
      `Showing the ${MAX_HEAT_ROWS} busiest of ${MAX_HEAT_ROWS + dropped} categories.`,
    );
  }

  const values = built.flatMap((row) =>
    row.cells.map((cell) => cell.value).filter((value): value is number => value !== null),
  );
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;
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
    hasAlerts: built.some((row) => row.cells.some((cell) => cell.alert)),
  };
}
