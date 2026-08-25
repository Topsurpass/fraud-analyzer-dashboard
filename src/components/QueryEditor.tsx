"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  QueryChartInput,
  PreviewResponse,
  SavedQueryCreate,
  SavedQueryRead,
  FlagRule,
} from "@/contracts/api";
import { ApiError, previewQuery } from "@/services/api-client";
import { formatDuration, formatInteger } from "@/services/format";
import { Button, Field, Input, Panel, Textarea } from "./ui";
import { TableView } from "./charts/TableView";
import { buildTable } from "@/services/charts/shape";
import { SchemaBrowser } from "./SchemaBrowser";
import { FlagRuleEditor } from "./FlagRuleEditor";
import {
  ChartSetEditor,
  emptyChart,
  needsSeries,
  needsX,
  needsY,
} from "./ChartSetEditor";

/**
 * Write SQL, see what it returns, then say how to draw it.
 *
 * Preview before save is the whole point of this screen: the engine derives its
 * chart spec from column names, so choosing an axis before knowing the columns
 * is guesswork. The field pickers stay empty until a preview has run.
 */

export interface QueryEditorValues extends SavedQueryCreate {
  /**
   * Saved separately from the query itself: the engine stores rules under
   * PUT /queries/{id}/flag-rules, and on create the query has no id until the
   * POST returns. The caller sequences the two.
   */
  flag_rules: FlagRule[];
  /**
   * Saved separately from the query itself, like the rules: the engine stores
   * them under PUT /queries/{id}/charts, and on create the query has no id
   * until the POST returns. The caller sequences the two.
   */
  charts: QueryChartInput[];
}


export function QueryEditor({
  connectionId,
  initial,
  initialRules,
  initialCharts,
  submitLabel,
  busyLabel = "Saving…",
  busy,
  error,
  onSubmit,
  onCancel,
  footer,
}: {
  connectionId: string;
  initial?: SavedQueryRead | null;
  initialRules?: FlagRule[];
  initialCharts?: QueryChartInput[];
  submitLabel: string;
  /** Shown while `busy`. Lets the caller say "saved, opening…" once the write
   *  has landed but the navigation has not, which is otherwise indistinguishable
   *  from still saving. */
  busyLabel?: string;
  busy: boolean;
  error?: ApiError | null;
  onSubmit: (values: QueryEditorValues) => void;
  onCancel?: () => void;
  footer?: React.ReactNode;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sql, setSql] = useState(initial?.sql_text ?? "");
  const [charts, setCharts] = useState<QueryChartInput[]>(
    initialCharts ?? [emptyChart(0)],
  );
  const [rowLimit, setRowLimit] = useState(
    initial?.row_limit != null ? String(initial.row_limit) : "",
  );
  const [pollInterval, setPollInterval] = useState(
    initial?.poll_interval_ms != null ? String(initial.poll_interval_ms) : "",
  );
  const [rules, setRules] = useState<FlagRule[]>(initialRules ?? []);
  const [touched, setTouched] = useState(false);

  const sqlRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Write a table or column name into the SQL at the caret, rather than
   * appending it. Appending would be useless the moment the analyst is editing
   * the middle of a statement, which is most of the time.
   */
  const insertAtCaret = useCallback((text: string) => {
    const field = sqlRef.current;
    if (!field) {
      setSql((previous) => previous + text);
      return;
    }
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    setSql(field.value.slice(0, start) + text + field.value.slice(end));
    // The value lands on the next render, so move the caret after it.
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + text.length, start + text.length);
    });
  }, []);

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<ApiError | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Columns come from the preview when there is one; otherwise from whatever
  // the saved query was already configured with, so editing does not blank it.
  const columns = useMemo(() => {
    if (preview) return preview.columns;
    // Whatever the saved charts already name, so opening the editor before
    // running a preview does not blank a configured field.
    const named = charts.flatMap((chart) => [
      chart.x_field,
      chart.y_field,
      chart.series_field,
    ]);
    return [...new Set(named.filter((value): value is string => Boolean(value)))];
  }, [preview, charts]);

  const previewMatchCounts = useMemo(() => {
    if (!preview?.flags?.rules.length) return null;
    // Preview reports unsaved rules under their index in the submitted array.
    return new Map(
      preview.flags.rules.map((hit) => [Number(hit.id), hit.matched] as const),
    );
  }, [preview]);

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
      const result = await previewQuery(connectionId, {
        sql_text: sql,
        flag_rules: rules,
      });
      setPreview(result);
      // Offer sensible axes the moment the columns are known.
      // Offer sensible axes to any chart that has none yet, the moment the
      // real column names are known. Charts the analyst has already configured
      // are left alone.
      setCharts((current) =>
        current.map((chart) => {
          const next = { ...chart };
          if (needsX(chart.chart_type) && !next.x_field && result.columns.length > 0) {
            next.x_field = result.columns[0];
          }
          if (needsY(chart.chart_type) && !next.y_field) {
            next.y_field = result.columns[1] ?? result.columns[0] ?? "";
          }
          return next;
        }),
      );
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
      charts: charts.map((chart) => ({
        name: chart.name.trim(),
        chart_type: chart.chart_type,
        x_field: needsX(chart.chart_type) ? chart.x_field || null : null,
        y_field: needsY(chart.chart_type) ? chart.y_field || null : null,
        series_field: needsSeries(chart.chart_type) ? chart.series_field || null : null,
      })),
      row_limit: rowLimit.trim() ? Number(rowLimit) : null,
      poll_interval_ms: pollInterval.trim() ? Number(pollInterval) : null,
      flag_rules: rules,
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
                ref={sqlRef}
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

        <FlagRuleEditor
          rules={rules}
          onChange={setRules}
          columns={columns}
          matchCounts={previewMatchCounts}
          disabled={busy}
        />
      </div>

      <div className="space-y-3">
        <SchemaBrowser connectionId={connectionId} onInsert={insertAtCaret} />

        <ChartSetEditor
          charts={charts}
          onChange={setCharts}
          columns={columns}
          disabled={busy}
          savedNames={initialCharts?.map((chart) => chart.name)}
        />

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
            {busy ? busyLabel : submitLabel}
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
      chart: {
        id: "preview",
        name: "Preview",
        type: "table",
        x_field: null,
        y_field: null,
        series_field: null,
        warnings: [],
      },
    });
  }, [preview]);

  return (
    <Panel
      title="Preview"
      actions={
        preview ? (
          <span className="tnum text-[11px] text-muted">
            {formatInteger(preview.row_count)} rows · {formatDuration(preview.duration_ms)}
            {/* A preview is capped far below the saved row limit, so a full
                preview says so rather than letting the number read as the size
                of the result. The limit on the query itself is untouched. */}
            {preview.truncated ? " · preview capped, the saved row limit still applies" : ""}
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
        /*
         * `max-h-80` on its own was the bug: it capped the panel's own box but
         * clipped nothing, so a 100-row preview painted straight down over the
         * Flag rules panel underneath it. The cap needs a flex column and
         * `overflow-hidden` to mean anything - that pair is what shrinks
         * TableView to the cap and lets its internal `flex-1 overflow-auto`
         * resolve against a real height and scroll. It is a max, not a height,
         * so a three-row preview is still three rows tall.
         */
        <div className="flex max-h-80 flex-col overflow-hidden">
          <TableView data={table} title="Preview" />
        </div>
      )}
    </Panel>
  );
}
