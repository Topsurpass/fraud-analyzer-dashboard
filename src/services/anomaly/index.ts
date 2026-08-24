/**
 * Decides which data points get `--signal-alert`.
 *
 * The design brief reserves that colour for flagged or anomalous points in the
 * data itself, never for UI chrome, so "anomalous" has to mean something
 * precise rather than "looks big". Here it means exactly one thing: a flag rule
 * the analyst wrote matched the row.
 *
 * This module used to guess when a query had no rules - first by hunting for a
 * column named like `is_fraud`, then by running an Iglewicz-Hoaglin modified
 * z-score over the plotted values. Both are gone. On screen a guess and a
 * finding are the same red mark, so a brand-new query with no rules saved came
 * up with rows already flagged, which invites someone to act on an inference
 * nobody made. Nothing is flagged now until a rule says so.
 */

import type { FlagOutcome, FlagSeverity } from "@/contracts/api";

export interface RowAnomalyInput {
  columns: string[];
  rows: unknown[][];
  /**
   * Kept because callers pass it and the chart builders resolve it anyway. It
   * no longer decides anything: there is no statistical path left to plot it
   * against.
   */
  valueColumn?: string | null;
  /** The engine's flag-rule outcome. The only thing that flags a row. */
  flags?: FlagOutcome | null;
}

export interface RowAnomalyResult {
  /** Parallel to `rows`. */
  flags: boolean[];
  /** How each anomaly was decided, for the "why is this red" tooltip. */
  reason: "flag-rule" | "none";
  /** Retained in the shape for callers; always null now that rules decide. */
  source: string | null;
  /**
   * Parallel to `rows`: names of the rules that caught each row. This is what
   * lets a tooltip say "Large transfer" instead of only colouring the mark.
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
 * A row is flagged when a rule the analyst wrote says so, and never otherwise.
 *
 * This used to fall back to guessing when a query had no rules: first by
 * looking for a column with a conventional name like `is_fraud`, then by
 * running an outlier test on the plotted values. Both are gone. A guess is
 * indistinguishable on screen from a finding, so an unsaved query with no
 * rules at all came up with rows already marked - which is worse than marking
 * nothing, because it invites someone to act on it.
 */
export function detectRowAnomalies(input: RowAnomalyInput): RowAnomalyResult {
  const { rows, flags: outcome } = input;

  // An outcome with no rules means "this query defines none", which is not the
  // same as "these rules matched nothing" - but both flag nothing, so the
  // distinction no longer needs a branch.
  if (outcome && outcome.rules.length > 0) {
    return maskFromFlagOutcome(outcome, rows.length);
  }

  return {
    flags: rows.map(() => false),
    reason: "none",
    source: null,
    ...unlabelled(rows.length),
  };
}
