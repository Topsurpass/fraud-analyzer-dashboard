"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FlagRule,
  PreviewResponse,
  QueryChartInput,
  SavedQueryCreate,
  SavedQueryRead,
} from "@/contracts/api";
import { ApiError, previewQuery } from "@/services/api-client";
import { useLists } from "@/lib/ListsContext";
import {
  TARGETS,
  computeBlockers,
  computeOutline,
  computeWarnings,
  isPristineChart,
  scheduleSentence,
  suggestChart,
  type BuilderInput,
} from "@/services/querybuilder/model";
import { Button, Field, Input, Textarea } from "./ui";
import { ChartSetEditor, emptyChart, needsSeries, needsX, needsY } from "./ChartSetEditor";
import { PollIntervalField } from "./PollIntervalField";
import { RuleHeadline } from "./RuleSummary";
import { DiscardDialog, TablesDialog } from "./querybuilder/dialogs";
import { RulesDialog } from "./querybuilder/RulesDialog";
import { ResultsBody, ResultsDock, ResultsSummary, useShortcutLabel } from "./querybuilder/results";
import { SaveBar } from "./querybuilder/savebar";
import { Outline, StepCard, jumpTo, revealIfHidden } from "./querybuilder/steps";

/**
 * Write a query, check what it returns, then say how to draw it and how often to run it.
 *
 * Five numbered parts in the order the work happens, an outline that says where each
 * stands and what is next, the results kept in reach, rules written in a workspace of
 * their own that shows what they catch, and a bar that lists what is stopping the save.
 * The chart pickers wait for a preview because the engine derives a chart from column
 * names; the page now says so, and offers the preview from where the pickers would be.
 *
 * `QueryEditorValues` and the props are unchanged: `connections/:id/queries/new` and
 * `queries/:id` use this one component and hand it the same things as before.
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

/** What the editor is holding, as one string, so "has anything changed" is one comparison. */
function snapshotOf(values: {
  name: string;
  description: string;
  sql: string;
  charts: QueryChartInput[];
  rowLimit: string;
  pollInterval: string;
  rules: FlagRule[];
}): string {
  return JSON.stringify(values);
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
  const [charts, setCharts] = useState<QueryChartInput[]>(initialCharts ?? [emptyChart(0)]);
  const [rowLimit, setRowLimit] = useState(
    initial?.row_limit != null ? String(initial.row_limit) : "",
  );
  const [pollInterval, setPollInterval] = useState(
    initial?.poll_interval_ms != null ? String(initial.poll_interval_ms) : "",
  );
  const [rules, setRules] = useState<FlagRule[]>(initialRules ?? []);
  const [touched, setTouched] = useState(false);

  // What it started as, to tell "nothing typed yet" from "something to lose".
  const [baseline] = useState(() =>
    snapshotOf({
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      sql: initial?.sql_text ?? "",
      charts: initialCharts ?? [emptyChart(0)],
      rowLimit: initial?.row_limit != null ? String(initial.row_limit) : "",
      pollInterval: initial?.poll_interval_ms != null ? String(initial.poll_interval_ms) : "",
      rules: initialRules ?? [],
    }),
  );
  const dirty = snapshotOf({ name, description, sql, charts, rowLimit, pollInterval, rules }) !== baseline;

  // A reload or a closed tab with work in it asks first. (In-app navigation is
  // guarded by Cancel; the browser offers no hook for the rail's links.)
  useEffect(() => {
    if (!dirty || busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  const sqlRef = useRef<HTMLTextAreaElement>(null);
  const shortcut = useShortcutLabel();

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
      field.setSelectionRange(start + text.length, start + text.length);
    });
  }, []);

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewedSql, setPreviewedSql] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<ApiError | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // The chart type chosen for the person on the first preview, kept so it can be undone.
  const [autoPick, setAutoPick] = useState<{ before: QueryChartInput; type: QueryChartInput["chart_type"]; reason: string } | null>(null);
  const stale = preview !== null && previewedSql !== sql;
  // The first result of the session is shown to the person; later ones refresh in place.
  const hadPreview = useRef(false);

  // Columns come from the preview when there is one; otherwise from whatever
  // the saved query was already configured with, so editing does not blank it.
  const columns = useMemo(() => {
    if (preview) return preview.columns;
    const named = charts.flatMap((chart) => [chart.x_field, chart.y_field, chart.series_field]);
    return [...new Set(named.filter((value): value is string => Boolean(value)))];
  }, [preview, charts]);

  const previewMatchCounts = useMemo(() => {
    if (!preview?.flags?.rules.length) return null;
    // Preview reports unsaved rules under their index in the submitted array.
    return new Map(preview.flags.rules.map((hit) => [Number(hit.id), hit.matched] as const));
  }, [preview]);

  const runPreview = useCallback(
    async (rulesToUse: FlagRule[] = rules) => {
      if (!sql.trim()) {
        setTouched(true);
        jumpTo("query-sql");
        return;
      }
      setPreviewing(true);
      setPreviewError(null);
      try {
        const result = await previewQuery(connectionId, { sql_text: sql, flag_rules: rulesToUse });
        setPreview(result);
        setPreviewedSql(sql);
        if (!hadPreview.current) {
          hadPreview.current = true;
          // After the card has the rows in it, so its height is the real one.
          requestAnimationFrame(() => revealIfHidden(TARGETS.results));
          // A new chart starts as a plain table, which has no pickers, so the page looked
          // as if nothing had changed. Give the untouched first chart the type that suits
          // the data, and say so (with a way back) instead of leaving it for the person to find.
          if (charts.length === 1 && isPristineChart(charts[0])) {
            const pick = suggestChart(result.columns, result.rows);
            if (pick && pick.chart_type !== "table") {
              setAutoPick({ before: charts[0], type: pick.chart_type, reason: pick.reason });
              setCharts([
                {
                  ...charts[0],
                  chart_type: pick.chart_type,
                  x_field: pick.x_field,
                  y_field: pick.y_field,
                  series_field: pick.series_field,
                },
              ]);
              return;
            }
          }
        }
        // Offer sensible axes to any chart that has none yet, the moment the real
        // column names are known. Charts the analyst has already configured are
        // left alone.
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
        setPreviewedSql(null);
        setPreviewError(
          cause instanceof ApiError
            ? cause
            : new ApiError({ kind: "network", message: "Preview failed", url: "" }),
        );
      } finally {
        setPreviewing(false);
      }
    },
    [connectionId, rules, sql, charts],
  );

  // The note stays only while the chart is still the one that was chosen.
  const pickNote =
    autoPick && charts.length === 1 && charts[0].chart_type === autoPick.type ? autoPick : null;

  const input: BuilderInput = {
    name,
    sql,
    hasPreview: preview !== null,
    previewStale: stale,
    previewFailed: previewError !== null,
    previewRows: preview?.row_count ?? null,
    charts,
    columns,
    rules,
    pollInterval,
  };
  const parts = computeOutline(input);
  const blockers = computeBlockers(input);
  const warnings = computeWarnings(input);
  const partState = (id: (typeof parts)[number]["id"]) => parts.find((part) => part.id === id)!.state;

  const nameError = touched && !name.trim() ? "A name is required." : null;
  const sqlError = touched && !sql.trim() ? "Some SQL is required." : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (blockers.length > 0) {
      // Say where the problem is, instead of leaving a button that did nothing.
      jumpTo(blockers[0].target);
      return;
    }

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

  /* The results card on the page, and the dock that stands in for it off screen. */
  const [resultsOnScreen, setResultsOnScreen] = useState(true);
  useEffect(() => {
    const card = document.getElementById(TARGETS.results);
    if (!card || typeof IntersectionObserver === "undefined") return;
    // "On screen" means a fifth of it at least: its header peeking out from behind the
    // bar is not a result a person can read, and the dock should step in then.
    const observer = new IntersectionObserver(([entry]) => setResultsOnScreen(entry.intersectionRatio >= 0.2), {
      // The sticky outline and bar cover the top and bottom of the scroll area.
      rootMargin: "-64px 0px -96px 0px",
      threshold: [0, 0.1, 0.2, 0.35, 0.5, 1],
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  const [dockOpen, setDockOpen] = useState(false);
  const showDock = !resultsOnScreen && (preview !== null || previewing || previewError !== null);

  const [tablesOpen, setTablesOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const cancel = () => (dirty ? setDiscardOpen(true) : onCancel?.());

  const lists = useLists();
  const listNames = useMemo(
    () => new Map(lists.lists.map((list) => [list.id, list.name] as const)),
    [lists.lists],
  );

  const resultsState = {
    preview,
    error: previewError,
    previewing,
    stale,
    hasSql: sql.trim() !== "",
  };

  const runButtonLabel = (
    <>
      Run preview <span className="tnum ml-1.5 hidden opacity-70 sm:inline">{shortcut}</span>
    </>
  );

  return (
    <form onSubmit={submit} noValidate>
      <Outline
        parts={parts}
        onJump={jumpTo}
        actions={
          <Button
            type="button"
            tone="primary"
            onClick={() => void runPreview()}
            disabled={previewing || busy}
            aria-label="Run preview"
            title={`Run the SQL and show what it returns (${shortcut})`}
          >
            {previewing ? "Running…" : runButtonLabel}
          </Button>
        }
      />

      {/* Steps 1 and 2 run the full width and 3 to 5 sit side by side below them, so the
          numbers read in order on a wide screen as well as a narrow one. */}
      <div className="space-y-5">
        <div className="min-w-0 space-y-5">
          <StepCard
            id={TARGETS.query}
            step={1}
            title="Write the query"
            purpose="Name it, then write the SQL. The engine rejects anything that writes, so it is safe to try things."
            state={partState("query")}
          >
            <div className="space-y-4 p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Name" htmlFor="query-name" error={nameError}>
                  <Input
                    id="query-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Flagged volume"
                    className="scroll-mt-28"
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
              </div>

              <Field label="Read-only SQL" htmlFor="query-sql" error={sqlError}>
                <Textarea
                  id="query-sql"
                  ref={sqlRef}
                  value={sql}
                  onChange={(event) => setSql(event.target.value)}
                  onKeyDown={(event) => {
                    // The shortcut every SQL tool has: run it without leaving the keys.
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void runPreview();
                    }
                  }}
                  rows={11}
                  spellCheck={false}
                  className="tnum resize-y leading-relaxed max-sm:h-40"
                  placeholder={"SELECT country, COUNT(*) AS declines\nFROM transactions\nWHERE status = 'declined'\nGROUP BY country\nORDER BY declines DESC"}
                />
              </Field>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  tone="primary"
                  onClick={() => void runPreview()}
                  disabled={previewing || busy}
                >
                  {previewing ? "Running…" : runButtonLabel}
                </Button>
                <Button type="button" onClick={() => setTablesOpen(true)}>
                  Browse tables
                </Button>
                <p className="min-w-0 flex-1 basis-56 text-[12.5px] leading-snug text-muted">
                  {preview === null
                    ? "Run it to see the columns and rows. Charts and rules are built from them."
                    : stale
                      ? "You changed the SQL since the last run. Run it again to refresh the results."
                      : "Up to date. Change the SQL and run it again whenever you like."}
                </p>
              </div>
            </div>
          </StepCard>

          <StepCard
            id={TARGETS.results}
            step={2}
            title="Check the result"
            purpose="What the query returns right now. Charts and rules use these columns, so look here first."
            state={partState("results")}
            actions={preview ? <ResultsSummary preview={preview} /> : null}
          >
            <ResultsBody state={resultsState} onRun={() => void runPreview()} />
          </StepCard>
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-2">
        <div className="min-w-0 space-y-5">
          <StepCard
            id={TARGETS.charts}
            step={3}
            title="Choose how it is drawn"
            purpose="Every chart draws this same result. The query runs once, however many you add."
            state={partState("charts")}
          >
            {columns.length === 0 ? (
              <div className="space-y-3 p-5">
                <p className="text-[13px] leading-relaxed text-secondary">
                  Charts are built from your columns, and the columns come from a preview. Run one
                  and the pickers fill in, with a suggested chart.
                </p>
                <Button
                  type="button"
                  tone="primary"
                  onClick={() => void runPreview()}
                  disabled={previewing || busy || !sql.trim()}
                >
                  {previewing ? "Running…" : "Run preview to get your columns"}
                </Button>
                {!sql.trim() ? (
                  <p className="text-[12.5px] text-muted">Write the SQL in step 1 first.</p>
                ) : null}
              </div>
            ) : (
              <>
                {pickNote ? (
                  <div
                    role="status"
                    className="m-4 mb-0 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius)] border border-accent/30 bg-accent-soft px-3.5 py-2.5"
                  >
                    <p className="min-w-0 flex-1 basis-48 text-[12.5px] leading-snug text-ink">
                      <span className="font-semibold">We chose a {pickNote.type.replace("_", " ")} chart.</span>{" "}
                      {pickNote.reason} Change the type below if you want something else.
                    </p>
                    <Button
                      type="button"
                      onClick={() => {
                        setCharts([pickNote.before]);
                        setAutoPick(null);
                      }}
                    >
                      Back to a table
                    </Button>
                  </div>
                ) : null}
                <ChartSetEditor
                  bare
                  charts={charts}
                  onChange={setCharts}
                  columns={columns}
                  disabled={busy}
                  savedNames={initialCharts?.map((chart) => chart.name)}
                />
              </>
            )}
          </StepCard>
        </div>

        <div className="min-w-0 space-y-5">
          <StepCard
            id={TARGETS.rules}
            step={4}
            title="Flag what needs a look"
            purpose="Optional. Rules mark the rows worth attention, such as an amount over a limit, and raise alerts."
            state={partState("rules")}
            actions={
              rules.length > 0 ? (
                <Button type="button" onClick={() => setRulesOpen(true)} disabled={busy}>
                  Edit rules
                </Button>
              ) : null
            }
          >
            {rules.length === 0 ? (
              <div className="space-y-3 p-5">
                <p className="text-[13px] leading-relaxed text-secondary">
                  No rules yet. A rule is a sentence such as “amount is at least 500000”; rows that
                  match are marked on the chart and in the alerts.
                </p>
                <Button type="button" onClick={() => setRulesOpen(true)} disabled={busy}>
                  Add a rule
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {rules.map((rule, index) => {
                  const matched = previewMatchCounts?.get(index);
                  return (
                    <li key={index} className={`px-5 py-3 ${rule.enabled ? "" : "opacity-60"}`}>
                      <RuleHeadline
                        rule={rule}
                        listNames={listNames}
                        trailing={
                          <>
                            {!rule.enabled ? <span className="text-[11.5px] text-muted">switched off</span> : null}
                            {matched !== undefined ? (
                              <span className={`tnum text-[11.5px] ${matched > 0 ? "font-medium text-alert" : "text-muted"}`}>
                                {matched === 0 ? "catches none" : `catches ${matched}`}
                              </span>
                            ) : null}
                          </>
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </StepCard>

          <StepCard
            id={TARGETS.schedule}
            step={5}
            title="Set how often it runs"
            purpose={scheduleSentence(pollInterval)}
            state={partState("schedule")}
          >
            <div className="space-y-4 p-5">
              <Field label="Row limit" htmlFor="query-rows" hint="Blank uses the engine default.">
                <Input
                  id="query-rows"
                  value={rowLimit}
                  inputMode="numeric"
                  onChange={(event) => setRowLimit(event.target.value.replace(/[^\d]/g, ""))}
                  placeholder="1000"
                  className="tnum"
                />
              </Field>
              <PollIntervalField value={pollInterval} onChange={setPollInterval} readout={false} />
            </div>
          </StepCard>

          {footer}
        </div>
        </div>
      </div>

      <SaveBar
        blockers={blockers}
        warnings={warnings}
        dirty={dirty}
        busy={busy}
        busyLabel={busyLabel}
        submitLabel={submitLabel}
        error={error}
        onJump={jumpTo}
        onCancel={onCancel ? cancel : undefined}
        dock={
          showDock ? (
            <ResultsDock
              state={resultsState}
              open={dockOpen}
              onToggle={() => setDockOpen((value) => !value)}
              onRun={() => void runPreview()}
              onShowCard={() => {
                setDockOpen(false);
                jumpTo(TARGETS.results);
              }}
            />
          ) : null
        }
      />

      <TablesDialog
        open={tablesOpen}
        onClose={() => setTablesOpen(false)}
        connectionId={connectionId}
        onInsert={insertAtCaret}
      />
      <RulesDialog
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        rules={rules}
        savedRules={initialRules ?? []}
        columns={columns}
        connectionId={connectionId}
        sql={sql}
        onSave={(next) => {
          setRules(next);
          // Refresh the results so the rows the new rules catch are marked on the page.
          if (preview) void runPreview(next);
        }}
      />
      <DiscardDialog
        open={discardOpen}
        onKeep={() => setDiscardOpen(false)}
        onDiscard={() => {
          setDiscardOpen(false);
          onCancel?.();
        }}
      />
    </form>
  );
}
