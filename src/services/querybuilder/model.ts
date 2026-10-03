import type { ChartType, FlagRule, QueryChartInput } from "@/contracts/api";
import { validateCharts } from "@/components/ChartSetEditor";
import { validateRules } from "@/components/FlagRuleEditor";
import { describeDuration } from "@/services/format";

/**
 * What the query builder tells a person about where they are.
 *
 * Everything here is arithmetic on what has been typed and what the last preview
 * returned, so the outline's statuses, the list of things blocking a save, and the
 * suggested chart can all be tested without a browser. The components only draw it.
 */

export type PartId = "query" | "results" | "charts" | "rules" | "schedule";

/** `optional`: nothing is wrong with leaving it empty (rules). */
export type PartState = "todo" | "attention" | "done" | "optional";

/** The element each part lives in, so the outline and the save bar can jump to it. */
export const TARGETS: Record<PartId, string> = {
  query: "qb-query",
  results: "qb-results",
  charts: "qb-charts",
  rules: "qb-rules",
  schedule: "qb-schedule",
};

export interface PartStatus {
  id: PartId;
  label: string;
  state: PartState;
  /** Why, in a few words: "Run a preview", "12 rows", "Needs a name". */
  note: string;
}

export interface Blocker {
  part: PartId;
  text: string;
  /** Element to scroll to and focus. */
  target: string;
}

export interface BuilderInput {
  name: string;
  sql: string;
  /** A preview has returned for some version of the SQL. */
  hasPreview: boolean;
  /** The SQL has changed since that preview ran. */
  previewStale: boolean;
  previewFailed: boolean;
  previewRows: number | null;
  charts: QueryChartInput[];
  /** Columns the pickers can offer: from a preview, or from the saved charts. */
  columns: string[];
  rules: FlagRule[];
  pollInterval: string;
}

const LABELS: Record<PartId, string> = {
  query: "Query",
  results: "Results",
  charts: "Charts",
  rules: "Rules",
  schedule: "Schedule",
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** What stops the query being saved, in the order a person would fix it. */
export function computeBlockers(input: BuilderInput): Blocker[] {
  const blockers: Blocker[] = [];
  if (!input.name.trim()) {
    blockers.push({ part: "query", text: "Give the query a name", target: "query-name" });
  }
  if (!input.sql.trim()) {
    blockers.push({ part: "query", text: "Write the SQL", target: "query-sql" });
  }
  for (const [key, message] of validateCharts(input.charts)) {
    // A missing axis still saves (the engine reports it as a warning on the run),
    // so only the problems the engine would refuse block here.
    if (key.startsWith("chart:")) {
      const index = Number(key.split(":")[1]);
      blockers.push({ part: "charts", text: `Chart ${index + 1}: ${message}`, target: TARGETS.charts });
    }
  }
  for (const [key, message] of validateRules(input.rules)) {
    if (key.startsWith("rule:") || key.startsWith("cond:")) {
      // Which rule, because "Pick a column." on its own sends nobody anywhere.
      const index = Number(key.split(":")[1]);
      const named = input.rules[index]?.name.trim();
      blockers.push({
        part: "rules",
        text: `Rule ${named ? `“${named}”` : index + 1}: ${message}`,
        target: TARGETS.rules,
      });
    }
  }
  if (input.pollInterval.trim() !== "" && Number(input.pollInterval) === 0) {
    blockers.push({
      part: "schedule",
      text: "Set the interval above zero, or clear it to use the default",
      target: "query-poll",
    });
  }
  return blockers;
}

/** Things worth a look that do not stop a save. */
export function computeWarnings(input: BuilderInput): Blocker[] {
  const warnings: Blocker[] = [];
  for (const [key, message] of validateCharts(input.charts)) {
    if (key.startsWith("field:")) {
      warnings.push({ part: "charts", text: message, target: TARGETS.charts });
    }
  }
  return warnings;
}

export function scheduleSentence(pollInterval: string): string {
  const raw = pollInterval.trim();
  if (raw === "") return "Uses the engine's default interval";
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return "Needs an interval above zero";
  return `Runs at most once every ${describeDuration(ms)}`;
}

export function computeOutline(input: BuilderInput): PartStatus[] {
  const hasSql = input.sql.trim() !== "";
  const hasName = input.name.trim() !== "";
  const blockers = computeBlockers(input);
  const warnings = computeWarnings(input);
  const part = (id: PartId, state: PartState, note: string): PartStatus => ({
    id,
    label: LABELS[id],
    state,
    note,
  });

  const query = !hasSql
    ? part("query", "todo", "Write the SQL")
    : !hasName
      ? part("query", "attention", "Needs a name")
      : part("query", "done", "Ready");

  const results = !hasSql
    ? part("results", "todo", "After the SQL")
    : input.previewFailed
      ? part("results", "attention", "Preview failed")
      : !input.hasPreview
        ? part("results", "todo", "Run a preview")
        : input.previewStale
          ? part("results", "attention", "Out of date")
          : part(
              "results",
              "done",
              input.previewRows === null ? "Previewed" : plural(input.previewRows, "row"),
            );

  const chartBlockers = blockers.filter((blocker) => blocker.part === "charts");
  const chartWarnings = warnings.filter((warning) => warning.part === "charts");
  const charts =
    input.charts.length === 0
      ? part("charts", "attention", "Add a chart")
      : input.columns.length === 0
        ? part("charts", "todo", "Needs a preview first")
        : chartBlockers.length > 0
          ? part("charts", "attention", chartBlockers[0].text)
          : chartWarnings.length > 0
            ? part("charts", "attention", chartWarnings[0].text)
            : part("charts", "done", plural(input.charts.length, "chart"));

  const ruleBlockers = blockers.filter((blocker) => blocker.part === "rules");
  const rules =
    input.rules.length === 0
      ? part("rules", "optional", "Optional")
      : ruleBlockers.length > 0
        ? part("rules", "attention", ruleBlockers[0].text)
        : part("rules", "done", plural(input.rules.length, "rule"));

  const scheduleBlocked = blockers.some((blocker) => blocker.part === "schedule");
  const schedule = scheduleBlocked
    ? part("schedule", "attention", "Needs an interval above zero")
    : part("schedule", "done", input.pollInterval.trim() === "" ? "Default" : "Set");

  return [query, results, charts, rules, schedule];
}

/* ------------------------------------------------------------------ charts */

export interface ChartSuggestion {
  chart_type: ChartType;
  x_field: string;
  y_field: string;
  series_field: string;
  /** One sentence, for the person to judge it by. */
  reason: string;
}

const TIME_NAME = /(^|[_\s])(time|date|day|hour|minute|bucket|month|week|year|timestamp|at|period)([_\s]|$)/i;

function isNumeric(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string" || value.trim() === "") return false;
  // A leading zero ("011", "00") marks a code, a bank or a response code, not a
  // quantity: it is a label to group by, whatever digits it is made of.
  if (/^0\d/.test(value.trim())) return false;
  return Number.isFinite(Number(value.replace(/,/g, "")));
}

function looksLikeTime(name: string, sample: unknown[]): boolean {
  if (TIME_NAME.test(name)) return true;
  return sample.length > 0 && sample.every((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value));
}

/**
 * A reasonable first chart for what the query returned.
 *
 * A guess offered, never applied behind the person's back: it only reads the
 * first rows, and "time then a number" or "a label then a number" covers most
 * of what is written here. Returns null when nothing sensible can be said, which
 * leaves the table every query starts with.
 */
export function suggestChart(columns: string[], rows: unknown[][]): ChartSuggestion | null {
  if (columns.length === 0 || rows.length === 0) return null;
  const sample = rows.slice(0, 50);
  const column = (index: number) => sample.map((row) => row[index]).filter((value) => value !== null && value !== undefined);
  const numeric = columns.map((_, index) => {
    const values = column(index);
    return values.length > 0 && values.filter(isNumeric).length / values.length >= 0.8;
  });

  if (rows.length === 1 && numeric.some(Boolean)) {
    const y = columns[numeric.findIndex(Boolean)];
    return {
      chart_type: "number",
      x_field: "",
      y_field: y,
      series_field: "",
      reason: "One row with a number reads best as a single figure.",
    };
  }

  const labelIndexes = columns.map((_, index) => index).filter((index) => !numeric[index]);
  const numberIndexes = columns.map((_, index) => index).filter((index) => numeric[index]);
  if (labelIndexes.length === 0 || numberIndexes.length === 0) return null;

  const timeIndex = labelIndexes.find((index) => looksLikeTime(columns[index], column(index)));
  const x = timeIndex ?? labelIndexes[0];
  const seriesIndex = labelIndexes.find((index) => index !== x);
  const y = numberIndexes[0];
  const base = { x_field: columns[x], y_field: columns[y] };

  if (timeIndex !== undefined) {
    return {
      chart_type: "line",
      ...base,
      series_field: seriesIndex !== undefined ? columns[seriesIndex] : "",
      reason:
        seriesIndex !== undefined
          ? `${columns[x]} over time, one line for each ${columns[seriesIndex]}.`
          : `${columns[y]} over ${columns[x]} is a trend, so a line.`,
    };
  }
  if (seriesIndex !== undefined) {
    return {
      chart_type: "stacked_bar",
      ...base,
      series_field: columns[seriesIndex],
      reason: `${columns[y]} by ${columns[x]}, split by ${columns[seriesIndex]}.`,
    };
  }
  return {
    chart_type: "bar",
    ...base,
    series_field: "",
    reason: `${columns[y]} for each ${columns[x]}.`,
  };
}

/** True when a chart is still the untouched table every query starts with. */
export function isPristineChart(chart: QueryChartInput): boolean {
  return chart.chart_type === "table" && !chart.x_field && !chart.y_field && !chart.series_field;
}
