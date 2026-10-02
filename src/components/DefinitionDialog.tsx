"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChartDefinitionRead, ChartType, FlagSeverity } from "@/contracts/api";
import { OPERATOR_LABELS } from "@/contracts/api";
import { ApiError, getChartDefinition } from "@/services/api-client";
import { describeDuration, formatInteger } from "@/services/format";
import { useResource } from "@/lib/useResource";
import { CHART_LABELS } from "./CardMenu";
import { Modal } from "./Modal";
import { Button } from "./ui";

/**
 * The query and settings behind a published chart, to read and copy.
 *
 * Whoever sees a published chart can ask how it was made, so they can build
 * their own. That is all this is for, and it is deliberately incapable of more:
 * the only controls are Copy and Close. There is no field to type in, so there
 * is nothing here that could be mistaken for an editor, and the engine has no
 * endpoint that would accept an edit from this reader anyway. The author's way
 * to change a chart is the query page, which this dialog never links to for
 * anybody else.
 *
 * The same dialog is the administrators' review screen on `/approvals`: an
 * administrator reads the SQL before publishing it to everyone.
 *
 * The engine decides what is in the answer, and never includes the connection's
 * host or credentials, so nothing is hidden here and nothing needs to be.
 */
export function DefinitionDialog({
  chartId,
  onClose,
}: {
  /** The chart to show, or null while the dialog is shut. */
  chartId: string | null;
  onClose: () => void;
}) {
  return (
    <Modal open={chartId !== null} onClose={onClose} title="How this chart is made">
      {chartId !== null ? <DefinitionBody key={chartId} chartId={chartId} onClose={onClose} /> : null}
    </Modal>
  );
}

function DefinitionBody({ chartId, onClose }: { chartId: string; onClose: () => void }) {
  const load = useCallback((signal: AbortSignal) => getChartDefinition(chartId, { signal }), [chartId]);
  const definition = useResource(load);

  if (definition.error && !definition.data) {
    return (
      <div className="space-y-4 p-6">
        <p role="alert" className="text-[13px] leading-relaxed text-secondary">
          <span className="block text-[14px] font-semibold text-ink">Could not load this definition</span>
          {definition.error instanceof ApiError && definition.error.status === 404
            ? "It is no longer published, or it never was."
            : definition.error.displayMessage}
        </p>
        <div className="flex gap-2">
          <Button onClick={definition.reload}>Retry</Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    );
  }

  if (!definition.data) {
    return <div className="skeleton-sweep m-6 h-72 rounded-[var(--radius)] bg-raised" />;
  }

  return <DefinitionView data={definition.data} onClose={onClose} />;
}

/** The mapping's field names, as the person who built the chart would name them. */
function mappingRows(type: ChartType, chart: ChartDefinitionRead["chart"]): [string, string][] {
  const rows: [string, string | null][] = [
    ["Category or time (x)", chart.x_field],
    [type === "biaxial_bar" ? "Left axis (y)" : "Value (y)", chart.y_field],
    [
      type === "biaxial_bar" ? "Right axis" : type === "stacked_bar" ? "Stacked by" : "Split by",
      chart.series_field,
    ],
  ];
  return rows.filter((row): row is [string, string] => row[1] !== null && row[1] !== "");
}

function conditionText(condition: ChartDefinitionRead["rules"][number]["conditions"][number]): string {
  const operator = OPERATOR_LABELS[condition.operator] ?? condition.operator;
  if (condition.list_name) return `${condition.column_name} ${operator} “${condition.list_name}”`;
  const operands = [condition.value, condition.value2].filter(
    (operand): operand is string => operand !== null && operand !== "",
  );
  return [condition.column_name, operator, operands.join(" and ")].filter(Boolean).join(" ");
}

const SEVERITY_WEIGHT: Record<FlagSeverity, string> = {
  high: "border-alert/60 font-semibold text-ink",
  medium: "border-line font-medium text-ink",
  low: "border-line/60 text-muted",
};

function DefinitionView({ data, onClose }: { data: ChartDefinitionRead; onClose: () => void }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = async () => {
    let next: "copied" | "failed" = "copied";
    try {
      await navigator.clipboard.writeText(data.query.sql_text);
    } catch {
      // Clipboard access can be refused (an insecure origin, a denied
      // permission). The SQL is on screen and selectable, so say so.
      next = "failed";
    }
    setCopied(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied("idle"), 2500);
  };

  const { query, chart, rules } = data;
  const mapping = mappingRows(chart.chart_type, chart);

  return (
    <div className="space-y-5 px-6 py-5">
      <p
        role="note"
        className="rounded-[var(--radius-sm)] border border-line bg-sunken px-3 py-2 text-[12.5px] leading-relaxed text-secondary"
      >
        {data.read_only ? (
          <>
            <span className="font-medium text-ink">Read-only.</span> This belongs to{" "}
            {data.owner_name ?? "its author"}. You can copy the query to build your own; you cannot
            change this one.
          </>
        ) : (
          <>
            <span className="font-medium text-ink">Read-only view.</span>{" "}
            {data.owner_name ? `This belongs to ${data.owner_name}. ` : ""}Change the query from its
            own page.
          </>
        )}
      </p>

      <section aria-label="Query" className="space-y-2">
        <div className="flex items-baseline gap-2">
          <h3 className="t-section">{query.name}</h3>
          {data.connection_name ? (
            <span className="text-[12px] text-muted">on {data.connection_name}</span>
          ) : null}
        </div>
        {query.description ? <p className="text-[13px] text-secondary">{query.description}</p> : null}

        <div className="relative">
          <pre
            tabIndex={0}
            aria-label="SQL"
            className="max-h-72 overflow-auto rounded-[var(--radius-sm)] border border-line bg-sunken p-3 pr-20 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink"
          >
            {query.sql_text}
          </pre>
          <Button type="button" onClick={copy} className="absolute top-2 right-2">
            {copied === "copied" ? "Copied" : copied === "failed" ? "Select and copy" : "Copy"}
          </Button>
        </div>
      </section>

      <section aria-label="Schedule">
        <dl className="grid gap-x-8 gap-y-1 text-[13px] sm:grid-cols-2">
          <Fact label="Runs every">
            {query.poll_interval_ms ? describeDuration(query.poll_interval_ms) : "the engine default"}
          </Fact>
          <Fact label="Row limit">
            {query.row_limit ? formatInteger(query.row_limit) : "the engine default"}
          </Fact>
        </dl>
      </section>

      <section aria-label="Chart" className="space-y-1.5">
        <h3 className="t-section">Chart</h3>
        <dl className="grid gap-x-8 gap-y-1 text-[13px] sm:grid-cols-2">
          <Fact label="Name">{chart.name}</Fact>
          <Fact label="Drawn as">{CHART_LABELS[chart.chart_type] ?? chart.chart_type}</Fact>
          {mapping.map(([label, field]) => (
            <Fact key={label} label={label}>
              <code className="font-mono text-[12.5px]">{field}</code>
            </Fact>
          ))}
          {chart.surge_threshold_pct !== null ? (
            <Fact label="Flags a movement of">{chart.surge_threshold_pct}% or more</Fact>
          ) : null}
        </dl>
      </section>

      <section aria-label="Flag rules" className="space-y-1.5">
        <h3 className="t-section">Flag rules</h3>
        {rules.length === 0 ? (
          <p className="text-[13px] text-muted">This query has no flag rules.</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li key={rule.id} className="rounded-[var(--radius-sm)] border border-line px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-ink">{rule.name}</span>
                  <span
                    className={`border px-1.5 py-0.5 text-[11.5px] tracking-wide uppercase ${SEVERITY_WEIGHT[rule.severity]}`}
                  >
                    {rule.severity}
                  </span>
                  {rule.enabled ? null : <span className="text-[11.5px] text-muted">switched off</span>}
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-secondary">
                  Flags a row when{" "}
                  {rule.conditions.length === 0
                    ? "(no conditions)"
                    : rule.conditions.map(conditionText).join(", and ")}
                  .
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex justify-end border-t border-line pt-4">
        <Button type="button" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-ink">{children}</dd>
    </div>
  );
}
