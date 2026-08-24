/**
 * Decides which data points get `--signal-alert`.
 *
 * The design brief reserves that colour for flagged or anomalous points in the
 * data itself, never for UI chrome, so "anomalous" has to mean something
 * precise rather than "looks big". Two sources, in priority order:
 *
 *   1. An explicit flag column in the result set. If the analyst's SQL already
 *      says a row is fraud, we believe it and do no statistics.
 *   2. A robust outlier test on the plotted values.
 *
 * The test is the Iglewicz-Hoaglin modified z-score: median and median absolute
 * deviation instead of mean and standard deviation. That matters here because a
 * fraud spike is exactly the kind of point that inflates a standard deviation
 * enough to hide itself. Same input, same output - no model in this path.
 */

import type { FlagOutcome, FlagSeverity } from "@/contracts/api";

/** Column names that mean "this row is already known-bad". */
const FLAG_COLUMNS = [
  "is_flagged",
  "flagged",
  "is_fraud",
  "fraud",
  "is_anomaly",
  "anomaly",
  "anomalous",
  "is_suspicious",
  "suspicious",
  "alert",
  "is_alert",
];

/** Iglewicz-Hoaglin recommend 3.5; the 0.6745 scales MAD to a normal sigma. */
export const MODIFIED_Z_THRESHOLD = 3.5;
const MAD_TO_SIGMA = 0.6745;

/** Below this many points the sample cannot support an outlier claim. */
export const MIN_SAMPLE_FOR_OUTLIERS = 5;

export function isFlagColumn(name: string): boolean {
  return FLAG_COLUMNS.includes(name.trim().toLowerCase());
}

/** Literals a two-valued column is allowed to contain. */
const BOOLEAN_DOMAIN = new Set([
  "0", "1", "true", "false", "t", "f", "yes", "no", "y", "n",
]);

/**
 * True when every non-null value in the column is two-valued.
 *
 * The name check alone is not enough. A query like
 *   SELECT bucket, COUNT(*) AS flagged ... GROUP BY bucket
 * produces a column called `flagged` holding counts (3, 4, 88). Treating that
 * as a per-row fraud flag would paint every non-zero bucket with the alert
 * colour, which is exactly the "colour as decoration" failure the design brief
 * rules out. A flag column has to prove it is boolean.
 */
export function looksBoolean(values: unknown[]): boolean {
  let seen = 0;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "boolean") {
      seen += 1;
      continue;
    }
    if (typeof value === "number") {
      if (value !== 0 && value !== 1) return false;
      seen += 1;
      continue;
    }
    if (typeof value === "string") {
      if (!BOOLEAN_DOMAIN.has(value.trim().toLowerCase())) return false;
      seen += 1;
      continue;
    }
    return false;
  }
  return seen > 0;
}

/**
 * Find a usable flag column: the name has to match and the values have to be
 * boolean. `excludeColumn` drops the column being plotted as a magnitude, which
 * by definition is a measurement rather than a flag.
 */
export function findFlagColumn(
  columns: string[],
  rows: unknown[][],
  excludeColumn?: string | null,
): number | null {
  for (let index = 0; index < columns.length; index += 1) {
    if (!isFlagColumn(columns[index])) continue;
    if (excludeColumn && columns[index] === excludeColumn) continue;
    if (rows.length === 0) return index;
    if (looksBoolean(rows.map((row) => row[index]))) return index;
  }
  return null;
}

/**
 * Column names that hold an identifier rather than a measurement.
 *
 * An outlier test on a bank sort code, an account number or a row id is
 * arithmetic on something that has no distribution: the values are labels that
 * happen to be spelled with digits. Left unguarded it produces confident
 * nonsense - three banks out of ten reported as anomalous because their sort
 * codes are numerically further from the median than the rest.
 */
const IDENTIFIER_WORDS = [
  "id",
  "code",
  "key",
  "ref",
  "reference",
  "no",
  "number",
  "msisdn",
  "account",
  "uuid",
  "guid",
  "hash",
];

/**
 * Matched on word boundaries only - the whole name, a `snake_case` part, or a
 * `camelCase` part. Deliberately not a bare suffix test: "encode" ends with
 * "code" and "casino" ends with "no", and a false positive here silently turns
 * anomaly detection off for a real measurement, which is a worse failure than
 * missing an unconventionally-named identifier.
 */
export function looksLikeIdentifier(name: string): boolean {
  const parts = name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s_\-.]+/)
    .filter(Boolean);

  return parts.some((part) => IDENTIFIER_WORDS.includes(part));
}

/** SQL truthiness across drivers: 1, "1", true, "true", "yes", "t". */
export function isTruthyFlag(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    return text === "1" || text === "true" || text === "t" || text === "yes" || text === "y";
  }
  return false;
}

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Modified z-score per point. Returns 0 for every point when the sample has no
 * spread at all, which is the honest answer: nothing stands out.
 */
export function modifiedZScores(values: number[]): number[] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return values.map(() => 0);

  const centre = median(finite);
  const deviations = finite.map((value) => Math.abs(value - centre));
  let scale = median(deviations) / MAD_TO_SIGMA;

  if (scale === 0) {
    // Every deviation is zero for at least half the sample (common for counts
    // that sit at a constant). Fall back to mean absolute deviation, which the
    // literature pairs with a 1.253314 constant.
    const meanAbsolute =
      deviations.reduce((sum, value) => sum + value, 0) / deviations.length;
    scale = meanAbsolute * 1.253314;
  }

  if (scale === 0) return values.map(() => 0);

  return values.map((value) =>
    Number.isFinite(value) ? (value - centre) / scale : 0,
  );
}

export interface OutlierOptions {
  threshold?: number;
  minSample?: number;
  /** Only call unusually *high* points anomalies. Fraud spikes go up. */
  direction?: "both" | "high";
}

/** Boolean mask, parallel to `values`, of which points are statistical outliers. */
export function detectOutliers(values: number[], options: OutlierOptions = {}): boolean[] {
  const threshold = options.threshold ?? MODIFIED_Z_THRESHOLD;
  const minSample = options.minSample ?? MIN_SAMPLE_FOR_OUTLIERS;
  const direction = options.direction ?? "high";

  const finiteCount = values.reduce(
    (count, value) => (Number.isFinite(value) ? count + 1 : count),
    0,
  );
  if (finiteCount < minSample) return values.map(() => false);

  const scores = modifiedZScores(values);
  return scores.map((score, index) => {
    if (!Number.isFinite(values[index])) return false;
    return direction === "high" ? score >= threshold : Math.abs(score) >= threshold;
  });
}

export interface RowAnomalyInput {
  columns: string[];
  rows: unknown[][];
  /** Column plotted on the value axis; only used for the statistical path. */
  valueColumn?: string | null;
  /**
   * The engine's flag-rule outcome, when the query has rules. Outranks both
   * heuristics below: the analyst stated what counts, so nothing here should
   * be inferring it.
   */
  flags?: FlagOutcome | null;
}

export interface RowAnomalyResult {
  /** Parallel to `rows`. */
  flags: boolean[];
  /** How each anomaly was decided, for the "why is this red" tooltip. */
  reason: "flag-rule" | "flag-column" | "outlier" | "none";
  /** Name of the flag column, when that path was used. */
  source: string | null;
  /**
   * Parallel to `rows`: names of the rules that caught each row. Empty arrays
   * everywhere unless `reason` is "flag-rule". This is what lets a tooltip say
   * "Large transfer" instead of only colouring the mark.
   */
  ruleNames: string[][];
  /** Parallel to `rows`: highest severity among matching rules, else null. */
  severities: (FlagSeverity | null)[];
}

function unlabelled(count: number): Pick<RowAnomalyResult, "ruleNames" | "severities"> {
  return {
    ruleNames: Array.from({ length: count }, () => [] as string[]),
    severities: Array.from({ length: count }, () => null as FlagSeverity | null),
  };
}

/** Highest severity wins when several rules catch the same row. */
const SEVERITY_RANK: Record<FlagSeverity, number> = { low: 0, medium: 1, high: 2 };

export function highestSeverity(
  severities: readonly FlagSeverity[],
): FlagSeverity | null {
  let best: FlagSeverity | null = null;
  for (const severity of severities) {
    if (best === null || SEVERITY_RANK[severity] > SEVERITY_RANK[best]) best = severity;
  }
  return best;
}

/**
 * Turn the engine's outcome into the parallel arrays the charts consume.
 *
 * The wire format carries only flagged rows, which keeps a 10,000-row payload
 * from hauling 10,000 mostly-empty entries. Charts want a mask, so this is
 * where the sparse form is expanded, once, rather than at four call sites.
 */
export function maskFromFlagOutcome(
  outcome: FlagOutcome,
  rowCount: number,
): RowAnomalyResult {
  const mask = Array.from({ length: rowCount }, () => false);
  const { ruleNames, severities } = unlabelled(rowCount);
  const ruleById = new Map(outcome.rules.map((rule) => [rule.id, rule]));

  for (const flagged of outcome.rows) {
    // A row index past the end means the rows and the outcome came from
    // different runs. Dropping it beats painting an unrelated row red.
    if (flagged.index < 0 || flagged.index >= rowCount) continue;
    mask[flagged.index] = true;
    const hits = flagged.rule_ids
      .map((id) => ruleById.get(id))
      .filter((rule): rule is NonNullable<typeof rule> => rule !== undefined);
    ruleNames[flagged.index] = hits.map((rule) => rule.name);
    severities[flagged.index] = highestSeverity(hits.map((rule) => rule.severity));
  }

  return { flags: mask, reason: "flag-rule", source: null, ruleNames, severities };
}

/**
 * Top-level entry point: given a result set, say which rows deserve the alert
 * colour and be explicit about why.
 *
 * Priority, highest first:
 *   1. Flag rules the analyst wrote. An explicit statement beats any guess.
 *   2. A conventionally-named boolean column in the result.
 *   3. A robust outlier test on the plotted values.
 */
export function detectRowAnomalies(input: RowAnomalyInput): RowAnomalyResult {
  const { columns, rows, valueColumn, flags: outcome } = input;

  // Only when the query actually has rules. An outcome with no rules at all
  // means "this query defines none", not "these rules matched nothing", and
  // must not switch off the heuristics below.
  if (outcome && outcome.rules.length > 0) {
    return maskFromFlagOutcome(outcome, rows.length);
  }

  const flagIndex = findFlagColumn(columns, rows, valueColumn);
  if (flagIndex !== null) {
    return {
      flags: rows.map((row) => isTruthyFlag(row[flagIndex])),
      reason: "flag-column",
      source: columns[flagIndex],
      ...unlabelled(rows.length),
    };
  }

  // An identifier has no distribution to be an outlier in.
  if (valueColumn && !looksLikeIdentifier(valueColumn)) {
    const valueIndex = columns.indexOf(valueColumn);
    if (valueIndex !== -1) {
      const values = rows.map((row) => {
        const cell = row[valueIndex];
        return typeof cell === "number" ? cell : Number(cell);
      });
      const flags = detectOutliers(values);
      const labels = unlabelled(rows.length);
      if (flags.some(Boolean)) {
        return { flags, reason: "outlier", source: valueColumn, ...labels };
      }
      return { flags, reason: "none", source: null, ...labels };
    }
  }

  return {
    flags: rows.map(() => false),
    reason: "none",
    source: null,
    ...unlabelled(rows.length),
  };
}
