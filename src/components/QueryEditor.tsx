"use client";

import { useMemo, useState } from "react";
import type {
  ChartType,
  PreviewResponse,
  SavedQueryCreate,
  SavedQueryRead,
} from "@/contracts/api";
import { CHART_TYPES } from "@/contracts/api";
import { ApiError, previewQuery } from "@/services/api-client";
import { formatDuration, formatInteger } from "@/services/format";
import { Button, Field, Input, Panel, Select, Textarea } from "./ui";
import { TableView } from "./charts/TableView";
import { buildTable } from "@/services/charts/shape";

/**
 * Write SQL, see what it returns, then say how to draw it.
 *
 * Preview before save is the whole point of this screen: the engine derives its
 * chart spec from column names, so choosing an axis before knowing the columns
 * is guesswork. The field pickers stay empty until a preview has run.
 */

export interface QueryEditorValues extends SavedQueryCreate {
  chart_type: ChartType;
}

const NEEDS_X: ChartType[] = ["line", "bar", "pie"];
const NEEDS_Y: ChartType[] = ["line", "bar", "pie", "number"];

export function QueryEditor({
  connectionId,
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
  footer,
}: {
  connectionId: string;
  initial?: SavedQueryRead | null;
  submitLabel: string;
  busy: boolean;
  error?: ApiError | null;
  onSubmit: (values: QueryEditorValues) => void;
  onCancel?: () => void;
  footer?: React.ReactNode;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sql, setSql] = useState(initial?.sql_text ?? "");
  const [chartType, setChartType] = useState<ChartType>(initial?.chart_type ?? "table");
  const [xField, setXField] = useState(initial?.x_field ?? "");
  const [yField, setYField] = useState(initial?.y_field ?? "");
  const [seriesField, setSeriesField] = useState(initial?.series_field ?? "");
  const [rowLimit, setRowLimit] = useState(
    initial?.row_limit != null ? String(initial.row_limit) : "",
  );
  const [pollInterval, setPollInterval] = useState(
    initial?.poll_interval_ms != null ? String(initial.poll_interval_ms) : "",
  );
  const [touched, setTouched] = useState(false);

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<ApiError | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Columns come from the preview when there is one; otherwise from whatever
  // the saved query was already configured with, so editing does not blank it.
  const columns = useMemo(() => {
    if (preview) return preview.columns;
    return [initial?.x_field, initial?.y_field, initial?.series_field].filter(
      (value): value is string => Boolean(value),
    );
  }, [preview, initial]);

  const nameError = touched && !name.trim() ? "A name is required." : null;
  const sqlError = touched && !sql.trim() ? "Some SQL is required." : null;

  const runPreview = async () => {
    if (!sql.trim()) {
      setTouched(true);
      return;
    }
    setPreviewing(true);
    setPreviewError(null);
    try {
      const result = await previewQuery(connectionId, { sql_text: sql });
      setPreview(result);
      // Offer sensible axes the moment the columns are known.
      if (!xField && result.columns.length > 0) setXField(result.columns[0]);
      if (!yField && result.columns.length > 1) setYField(result.columns[1]);
      else if (!yField && result.columns.length === 1) setYField(result.columns[0]);
    } catch (cause) {
      setPreview(null);
      setPreviewError(
        cause instanceof ApiError
          ? cause
          : new ApiError({ kind: "network", message: "Preview failed", url: "" }),
      );
    } finally {
      setPreviewing(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!name.trim() || !sql.trim()) return;

    onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      sql_text: sql,
      chart_type: chartType,
      x_field: NEEDS_X.includes(chartType) && xField ? xField : null,
      y_field: NEEDS_Y.includes(chartType) && yField ? yField : null,
      series_field: chartType === "line" || chartType === "bar" ? seriesField || null : null,
      row_limit: rowLimit.trim() ? Number(rowLimit) : null,
      poll_interval_ms: pollInterval.trim() ? Number(pollInterval) : null,
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-3">
        <Panel
          title="SQL"
          actions={
            <Button type="button" onClick={runPreview} disabled={previewing || busy}>
              {previewing ? "Running…" : "Preview"}
            </Button>
          }
        >
          <div className="space-y-3 p-3">
            <Field label="Name" htmlFor="query-name" error={nameError}>
              <Input
                id="query-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Flagged volume"
              />
            </Field>

            <Field label="Description" htmlFor="query-desc" hint="Shown under the card title.">
              <Input
                id="query-desc"
                value={description ?? ""}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Flagged transactions per 5-minute bucket."
              />
            </Field>

            <Field
              label="Read-only SQL"
              htmlFor="query-sql"
              error={sqlError}
              hint="The engine rejects anything that writes."
            >
              <Textarea
                id="query-sql"
                value={sql}
                onChange={(event) => setSql(event.target.value)}
                rows={12}
                spellCheck={false}
                className="tnum resize-y leading-relaxed"
                placeholder={"SELECT country, COUNT(*) AS declines\nFROM transactions\nWHERE status = 'declined'\nGROUP BY country\nORDER BY declines DESC"}
              />
            </Field>
          </div>
        </Panel>

        <PreviewPanel
          preview={preview}
          error={previewError}
          previewing={previewing}
        />
      </div>

      <div className="space-y-3">
        <Panel title="Chart">
          <div className="space-y-3 p-3">
            <Field label="Type" htmlFor="query-chart">
              <Select
                id="query-chart"
                value={chartType}
                onChange={(event) => setChartType(event.target.value as ChartType)}
              >
                {CHART_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>

            {NEEDS_X.includes(chartType) ? (
              <FieldPicker
                label={chartType === "pie" ? "Category field" : "X field"}
                id="query-x"
                value={xField ?? ""}
                columns={columns}
                onChange={setXField}
              />
            ) : null}

            {NEEDS_Y.includes(chartType) ? (
              <FieldPicker
                label="Value field"
                id="query-y"
                value={yField ?? ""}
                columns={columns}
                onChange={setYField}
              />
            ) : null}

            {chartType === "line" || chartType === "bar" ? (
              <FieldPicker
                label="Series field"
                id="query-series"
                value={seriesField ?? ""}
                columns={columns}
                onChange={setSeriesField}
                optional
                hint="Splits the chart into one line or bar group per distinct value."
              />
            ) : null}

            {columns.length === 0 ? (
              <p className="text-[11px] text-muted">
                Run a preview to choose fields from the real column names.
              </p>
            ) : null}
          </div>
        </Panel>

        <Panel title="Execution">
          <div className="space-y-3 p-3">
            <Field
              label="Row limit"
              htmlFor="query-rows"
              hint="Blank uses the engine default."
            >
              <Input
                id="query-rows"
                value={rowLimit}
                inputMode="numeric"
                onChange={(event) => setRowLimit(event.target.value.replace(/[^\d]/g, ""))}
                placeholder="1000"
                className="tnum"
              />
            </Field>

            <Field
              label="Poll interval (ms)"
              htmlFor="query-poll"
              hint="How often the card re-checks. Blank uses the engine default."
            >
              <Input
                id="query-poll"
                value={pollInterval}
                inputMode="numeric"
                onChange={(event) => setPollInterval(event.target.value.replace(/[^\d]/g, ""))}
                placeholder="5000"
                className="tnum"
              />
            </Field>
          </div>
        </Panel>

        {error ? (
          <p className="border border-change/40 bg-change/5 px-3 py-2 text-[12px] text-change">
            {error.displayMessage}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button type="submit" tone="primary" disabled={busy}>
            {busy ? "Saving…" : submitLabel}
          </Button>
          {onCancel ? (
            <Button type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          ) : null}
        </div>

        {footer}
      </div>
    </form>
  );
}

function FieldPicker({
  label,
  id,
  value,
  columns,
  onChange,
  optional,
  hint,
}: {
  label: string;
  id: string;
  value: string;
  columns: string[];
  onChange: (value: string) => void;
  optional?: boolean;
  hint?: string;
}) {
  // A configured field that is no longer in the result set must still be
  // listed, or opening the editor would silently drop it on save.
  const options = value && !columns.includes(value) ? [value, ...columns] : columns;

  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{optional ? "None" : "Not set"}</option>
        {options.map((column) => (
          <option key={column} value={column}>
            {column}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function PreviewPanel({
  preview,
  error,
  previewing,
}: {
  preview: PreviewResponse | null;
  error: ApiError | null;
  previewing: boolean;
}) {
  const table = useMemo(() => {
    if (!preview) return null;
    return buildTable({
      columns: preview.columns,
      rows: preview.rows,
      chart: { type: "table", x_field: null, y_field: null, series_field: null, warnings: [] },
    });
  }, [preview]);

  return (
    <Panel
      title="Preview"
      actions={
        preview ? (
          <span className="tnum text-[11px] text-muted">
            {formatInteger(preview.row_count)} rows · {formatDuration(preview.duration_ms)}
            {preview.truncated ? " · truncated" : ""}
          </span>
        ) : null
      }
    >
      {error ? (
        <div className="p-3">
          <p className="text-[12px] text-change">{error.displayMessage}</p>
          {error.errorCode ? (
            <p className="tnum mt-1 text-[10px] tracking-wide text-muted uppercase">
              {error.errorCode}
            </p>
          ) : null}
        </div>
      ) : previewing ? (
        <div className="skeleton-sweep space-y-2 p-3">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="h-2.5 bg-line" style={{ width: `${92 - index * 9}%` }} />
          ))}
        </div>
      ) : !table ? (
        <p className="p-3 text-[12px] text-muted">
          Run a preview to see the columns and rows this SQL returns.
        </p>
      ) : (
        <div className="max-h-80">
          <TableView data={table} title="Preview" />
        </div>
      )}
    </Panel>
  );
}
