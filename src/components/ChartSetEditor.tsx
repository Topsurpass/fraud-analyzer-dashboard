"use client";

import { useState } from "react";
import type { ChartType, QueryChartInput } from "@/contracts/api";
import { CHART_TYPES } from "@/contracts/api";
import { Button, Field, Input, Panel, Select } from "@/components/ui";
import { FieldPicker } from "@/components/FieldPicker";

/**
 * Every way one query's result can be drawn.
 *
 * Chart configuration used to live on the query, so showing the same data as a
 * line, a bar and a table meant saving the query three times - and the engine
 * then ran identical SQL three times on every poll, because its result cache is
 * keyed by query. Adding a chart here costs nothing at the database: they all
 * render from the one result the query already fetched.
 *
 * Charts are matched by name when the set is saved, so renaming one reads as
 * removing it and adding another. That is the honest interpretation - a
 * dashboard placing "Trend" cannot know that the thing now called "Volume" is
 * the same intent - and the editor says so rather than letting someone discover
 * it when a board empties.
 */

const NEEDS_X: ChartType[] = ["line", "bar", "pie", "compare", "heatmap"];
const NEEDS_Y: ChartType[] = ["line", "bar", "pie", "number", "compare", "heatmap"];

/**
 * Charts whose category axis is required rather than an optional split.
 * A heatmap with no category is a single row, which is a line chart drawn
 * badly - so the editor asks for one instead of rendering a stripe.
 */
const REQUIRES_SERIES: ChartType[] = ["heatmap"];

export function needsX(type: ChartType): boolean {
  return NEEDS_X.includes(type);
}

export function needsY(type: ChartType): boolean {
  return NEEDS_Y.includes(type);
}

export function needsSeries(type: ChartType): boolean {
  return type === "line" || type === "bar" || REQUIRES_SERIES.includes(type);
}

/** Whether leaving the series field empty makes the chart undrawable. */
export function seriesIsRequired(type: ChartType): boolean {
  return REQUIRES_SERIES.includes(type);
}

/** What the x axis actually means, per chart type. */
export function xFieldLabel(type: ChartType): string {
  if (type === "pie") return "Category field";
  if (type === "compare") return "Time bucket field";
  if (type === "heatmap") return "Bucket field (columns)";
  return "X field";
}

export function yFieldLabel(type: ChartType): string {
  if (type === "pie") return "Value field";
  if (type === "compare" || type === "heatmap") return "Measure field";
  return "Y field";
}

export function seriesFieldLabel(type: ChartType): string {
  return type === "heatmap" ? "Category field (rows)" : "Series field";
}

export function emptyChart(index: number, type: ChartType = "table"): QueryChartInput {
  return {
    name: `Chart ${index + 1}`,
    chart_type: type,
    x_field: "",
    y_field: "",
    series_field: "",
  };
}

/**
 * Everything wrong with a chart set, keyed by position.
 *
 * Mirrors what the engine enforces so the editor can say it before a round
 * trip. The engine remains the authority; this is the fast path.
 */
export function validateCharts(charts: QueryChartInput[]): Map<string, string> {
  const problems = new Map<string, string>();
  const seen = new Map<string, number>();

  charts.forEach((chart, index) => {
    const name = chart.name.trim();
    if (!name) {
      problems.set(`chart:${index}`, "A chart needs a name.");
    } else {
      const key = name.toLowerCase();
      if (seen.has(key)) {
        problems.set(`chart:${index}`, `Another chart is already called "${name}".`);
      } else {
        seen.set(key, index);
      }
    }

    // A chart missing a required field still saves and still renders - the
    // engine reports it as a warning on the run rather than refusing - so this
    // is a nudge, not a block.
    if (needsX(chart.chart_type) && !chart.x_field?.trim()) {
      problems.set(`field:${index}`, `A ${chart.chart_type} chart needs an X field.`);
    } else if (needsY(chart.chart_type) && !chart.y_field?.trim()) {
      problems.set(`field:${index}`, `A ${chart.chart_type} chart needs a Y field.`);
    }
  });

  return problems;
}

export interface ChartSetEditorProps {
  charts: QueryChartInput[];
  onChange: (charts: QueryChartInput[]) => void;
  /** Result columns from the last preview. Empty before one has run. */
  columns: string[];
  disabled?: boolean;
  /** Names the chart set already saved, so renames can be called out. */
  savedNames?: string[];
}

export function ChartSetEditor({
  charts,
  onChange,
  columns,
  disabled = false,
  savedNames,
}: ChartSetEditorProps) {
  const problems = validateCharts(charts);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const patch = (index: number, changes: Partial<QueryChartInput>) => {
    onChange(charts.map((chart, i) => (i === index ? { ...chart, ...changes } : chart)));
  };

  const changeType = (index: number, chart_type: ChartType) => {
    // Clear fields the new type does not read, so switching to a table and
    // back cannot leave a stale series behind that nothing displayed.
    const changes: Partial<QueryChartInput> = { chart_type };
    if (!needsX(chart_type)) changes.x_field = "";
    if (!needsY(chart_type)) changes.y_field = "";
    if (!needsSeries(chart_type)) changes.series_field = "";
    patch(index, changes);
  };

  const renamed =
    savedNames && savedNames.length > 0
      ? charts.filter(
          (chart) =>
            chart.name.trim() && !savedNames.includes(chart.name.trim()),
        ).length > 0 && charts.length === savedNames.length
      : false;

  return (
    <Panel
      title="Charts"
      actions={
        <div className="flex items-center gap-2">
          {charts.length > 0 ? (
            confirmingClear ? (
              <>
                <Button
                  type="button"
                  tone="danger"
                  disabled={disabled}
                  onClick={() => {
                    onChange([]);
                    setConfirmingClear(false);
                  }}
                >
                  Remove all {charts.length}
                </Button>
                <Button type="button" disabled={disabled} onClick={() => setConfirmingClear(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button type="button" disabled={disabled} onClick={() => setConfirmingClear(true)}>
                Remove all
              </Button>
            )
          ) : null}
          <Button
            type="button"
            tone="primary"
            disabled={disabled}
            onClick={() => onChange([...charts, emptyChart(charts.length)])}
          >
            Add chart
          </Button>
        </div>
      }
    >
      <div className="space-y-3 p-3">
        <p className="text-[12px] leading-relaxed text-secondary">
          Every chart here draws the same result. The query runs{" "}
          <strong>once</strong> however many you add, so a trend line, a
          breakdown and the rows behind them cost one trip to your database.
        </p>

        {charts.length === 0 ? (
          <p className="rounded-[var(--radius-sm)] border border-dashed border-line px-3 py-4 text-[12px] text-muted">
            No charts yet, so this query renders nothing. Add one to draw its
            result.
          </p>
        ) : null}

        {renamed ? (
          <p className="rounded-[var(--radius-sm)] border border-change/40 bg-change/5 px-3 py-2 text-[11.5px] text-change">
            Renaming a chart replaces it. Any dashboard showing the old name
            will lose that card.
          </p>
        ) : null}

        {charts.map((chart, index) => {
          const nameProblem = problems.get(`chart:${index}`);
          const fieldProblem = problems.get(`field:${index}`);
          return (
            <div
              key={index}
              className="space-y-2 rounded-[var(--radius-sm)] border border-line bg-raised p-2.5"
            >
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[10rem] flex-1">
                  <Field
                    label="Chart name"
                    htmlFor={`chart-name-${index}`}
                    error={nameProblem ?? null}
                  >
                    <Input
                      id={`chart-name-${index}`}
                      value={chart.name}
                      disabled={disabled}
                      onChange={(event) => patch(index, { name: event.target.value })}
                      placeholder="Trend"
                    />
                  </Field>
                </div>

                <Field label="Type" htmlFor={`chart-type-${index}`}>
                  <Select
                    id={`chart-type-${index}`}
                    value={chart.chart_type}
                    disabled={disabled}
                    onChange={(event) => changeType(index, event.target.value as ChartType)}
                  >
                    {CHART_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove chart ${chart.name || index + 1}`}
                  onClick={() => onChange(charts.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </div>

              {needsX(chart.chart_type) || needsY(chart.chart_type) ? (
                <div className="flex flex-wrap gap-2">
                  {needsX(chart.chart_type) ? (
                    <div className="min-w-[8rem] flex-1">
                      <FieldPicker
                        label={xFieldLabel(chart.chart_type)}
                        id={`chart-x-${index}`}
                        value={chart.x_field ?? ""}
                        columns={columns}
                        disabled={disabled}
                        onChange={(value) => patch(index, { x_field: value })}
                      />
                    </div>
                  ) : null}
                  {needsY(chart.chart_type) ? (
                    <div className="min-w-[8rem] flex-1">
                      <FieldPicker
                        label={yFieldLabel(chart.chart_type)}
                        id={`chart-y-${index}`}
                        value={chart.y_field ?? ""}
                        columns={columns}
                        disabled={disabled}
                        onChange={(value) => patch(index, { y_field: value })}
                      />
                    </div>
                  ) : null}
                  {needsSeries(chart.chart_type) ? (
                    <div className="min-w-[8rem] flex-1">
                      <FieldPicker
                        label={seriesFieldLabel(chart.chart_type)}
                        id={`chart-series-${index}`}
                        value={chart.series_field ?? ""}
                        columns={columns}
                        disabled={disabled}
                        onChange={(value) => patch(index, { series_field: value })}
                        optional
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {fieldProblem ? (
                <p className="text-[11.5px] text-change">{fieldProblem}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
