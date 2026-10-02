"use client";

/**
 * Writes the rules that decide which rows get flagged.
 *
 * The column choices come from the preview the editor has already fetched, so
 * an analyst picks a real column name instead of typing one and finding out it
 * was wrong after saving. Before a preview has run the field falls back to free
 * text, because a rule is legitimately written before the query has ever been
 * executed, and refusing to let someone type is worse than letting them.
 *
 * A rule ANDs its conditions; a row is flagged when any enabled rule matches.
 * The wording in the UI says exactly that, because "all"/"any" is the one thing
 * about this feature a user can get wrong without any error to tell them.
 *
 * ## How it is laid out
 *
 * Every rule used to be open all the time, each condition as three full-width
 * fields, so four rules ran past 1500px and said nothing until each field had
 * been read. Now a rule is one line: its severity, its name, a switch, and the
 * sentence it stands for ("amount is at least 300 and outcome equals declined",
 * from `describeRule`). Opening a rule shows its editor; only one is open at a
 * time, so the screen holds one thing being changed and a list of the rest.
 * What is written to the engine, and every validation rule, is unchanged.
 */

import {
  BINARY_OPERATORS,
  FLAG_SEVERITIES,
  LIST_OPERATORS,
  NULLARY_OPERATORS,
  OPERATOR_LABELS,
  type FlagCondition,
  type FlagOperator,
  type FlagRule,
  type FlagSeverity,
} from "@/contracts/api";
import Link from "next/link";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Field, Input, Panel, Select } from "@/components/ui";
import { RuleHeadline } from "@/components/RuleSummary";
import { useLists } from "@/lib/ListsContext";

/** Offered in this order: the comparisons people reach for first come first. */
const OPERATORS = Object.keys(OPERATOR_LABELS) as FlagOperator[];

export function takesNoValue(operator: FlagOperator): boolean {
  return NULLARY_OPERATORS.includes(operator);
}

export function takesTwoValues(operator: FlagOperator): boolean {
  return BINARY_OPERATORS.includes(operator);
}

/** "Is in list" and "is not in list": the value is a named list, not typed. */
export function takesList(operator: FlagOperator): boolean {
  return LIST_OPERATORS.includes(operator);
}

/**
 * A new condition, with no column chosen.
 *
 * Deliberately not seeded with the first result column. Doing that put a real
 * column name in the field before the analyst had picked anything, so a rule
 * built by setting only the comparison and the value silently tested whichever
 * column happened to come first. It evaluated cleanly and matched nothing, with
 * no error anywhere to say the column was the problem. An empty field fails the
 * editor's own validation instead, which is the point.
 */
export function emptyCondition(column = ""): FlagCondition {
  return { column_name: column, operator: "gt", value: "" };
}

export function emptyRule(index: number, column = ""): FlagRule {
  return {
    name: `Rule ${index + 1}`,
    severity: "medium",
    enabled: true,
    conditions: [emptyCondition(column)],
  };
}

/**
 * Everything wrong with a rule set, as messages keyed by position.
 *
 * Deliberately mirrors what the engine's schema enforces, so the editor can say
 * so before a round trip rather than surfacing a 422 with no location. The
 * engine remains the authority; this is only the fast path.
 */
export function validateRules(rules: FlagRule[]): Map<string, string> {
  const problems = new Map<string, string>();
  const seen = new Map<string, number>();

  rules.forEach((rule, ruleIndex) => {
    const name = rule.name.trim();
    if (!name) {
      problems.set(`rule:${ruleIndex}`, "A rule needs a name.");
    } else {
      const key = name.toLowerCase();
      const first = seen.get(key);
      if (first !== undefined) {
        problems.set(`rule:${ruleIndex}`, `Another rule is already called "${name}".`);
      } else {
        seen.set(key, ruleIndex);
      }
    }

    if (rule.conditions.length === 0) {
      problems.set(`rule:${ruleIndex}`, "A rule needs at least one condition.");
    }

    rule.conditions.forEach((condition, conditionIndex) => {
      const key = `cond:${ruleIndex}:${conditionIndex}`;
      if (!condition.column_name.trim()) {
        problems.set(key, "Pick a column.");
        return;
      }
      if (takesNoValue(condition.operator)) return;
      if (takesList(condition.operator)) {
        if (!condition.list_id) problems.set(key, "Pick a list.");
        return;
      }
      if (!condition.value?.trim()) {
        problems.set(key, "This comparison needs a value.");
        return;
      }
      if (takesTwoValues(condition.operator) && !condition.value2?.trim()) {
        problems.set(key, "Between needs both bounds.");
      }
    });
  });

  return problems;
}

/**
 * What would be written for a rule, in one comparable shape. A rule loaded from
 * the engine has `null` where the editor holds `""`, and that is not an edit.
 */
function canonical(rule: FlagRule | undefined): string {
  if (!rule) return "";
  return JSON.stringify([
    rule.name,
    rule.severity,
    rule.enabled,
    rule.conditions.map((c) => [
      c.column_name,
      c.operator,
      c.value ?? "",
      c.value2 ?? "",
      c.list_id ?? "",
    ]),
  ]);
}

export interface FlagRuleEditorProps {
  rules: FlagRule[];
  onChange: (rules: FlagRule[]) => void;
  /** Result columns from the last preview. Empty before one has run. */
  columns: string[];
  /** Per-rule match counts from a preview, keyed by the rule's index. */
  matchCounts?: Map<number, number> | null;
  disabled?: boolean;
  /**
   * The rules as last saved. With it the editor says which rules are new or
   * edited and whether anything is unsaved; without it, it says nothing about
   * that rather than guessing.
   */
  savedRules?: FlagRule[] | null;
}

/** Where focus goes after the next render, because the thing it was on moved. */
type FocusTarget =
  | { kind: "name"; rule: number; select: boolean }
  | { kind: "header"; rule: number }
  | { kind: "column"; rule: number; condition: number }
  | { kind: "add-rule" };

export function FlagRuleEditor({
  rules,
  onChange,
  columns,
  matchCounts,
  disabled = false,
  savedRules,
}: FlagRuleEditorProps) {
  const problems = validateRules(rules);
  const lists = useLists();
  const baseId = useId();
  // Clearing every rule at once is worth a second press. Removing one rule is
  // obvious to undo by retyping it; removing eight is not, and the button sits
  // next to "Add rule" where a misclick is cheap to make.
  const [confirmingClear, setConfirmingClear] = useState(false);

  /*
   * The one rule being edited, or none. Index-based because a rule has no id of
   * its own until it is saved. Out of range (the parent replaced the rules)
   * reads as none, so a stale index never opens the wrong rule.
   */
  const [open, setOpen] = useState<number | null>(null);
  const openIndex = open !== null && open < rules.length ? open : null;

  const listNames = useMemo(
    () => new Map(lists.lists.map((list) => [list.id, list.name] as const)),
    [lists.lists],
  );

  /*
   * A list made in another tab, or by someone else since sign-in, is not in
   * the shell's copy. Before calling a referenced list "removed", ask the
   * engine once. A layout effect, so the reload has started (and the option
   * reads "Loading…") before the first paint rather than flashing "removed".
   */
  const askedForLists = useRef(false);
  const someListMissing = rules.some((rule) =>
    rule.conditions.some(
      (condition) =>
        takesList(condition.operator) &&
        condition.list_id &&
        !lists.lists.some((list) => list.id === condition.list_id),
    ),
  );
  const { reload: reloadLists } = lists;
  useLayoutEffect(() => {
    if (askedForLists.current || lists.initial || lists.error || !someListMissing) return;
    askedForLists.current = true;
    reloadLists();
  }, [lists.initial, lists.error, someListMissing, reloadLists]);

  // Set once "Manage lists" is followed, which is when a refresh has a point.
  const [managedLists, setManagedLists] = useState(false);

  /*
   * Focus follows the work. Opening a rule lands on its name, adding a
   * condition on its new column, and closing or removing something puts focus on
   * a control that still exists, because a focused element that unmounts drops
   * focus to the page and a keyboard user loses their place.
   */
  const pendingFocus = useRef<FocusTarget | null>(null);
  // Plain maps held in state so they are stable and never read while rendering;
  // they are only written by the ref callbacks below and read when focus moves.
  const [headers] = useState(() => new Map<number, HTMLElement>());
  const [names] = useState(() => new Map<number, HTMLInputElement>());
  const [columnControls] = useState(() => new Map<string, HTMLElement>());
  const addRule = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target.kind === "name") {
      const input = names.get(target.rule);
      input?.focus();
      // Selected only for a rule that was just made, whose "Rule 3" is there to
      // be typed over. Opening an existing rule must not leave its name one
      // keystroke from being replaced.
      if (target.select) input?.select();
    } else if (target.kind === "header") {
      headers.get(target.rule)?.focus();
    } else if (target.kind === "column") {
      columnControls.get(`${target.rule}:${target.condition}`)?.focus();
    } else {
      addRule.current?.focus();
    }
  });

  const patchRule = (index: number, patch: Partial<FlagRule>) => {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  const patchCondition = (
    ruleIndex: number,
    conditionIndex: number,
    patch: Partial<FlagCondition>,
  ) => {
    patchRule(ruleIndex, {
      conditions: rules[ruleIndex].conditions.map((condition, i) =>
        i === conditionIndex ? { ...condition, ...patch } : condition,
      ),
    });
  };

  const changeOperator = (
    ruleIndex: number,
    conditionIndex: number,
    operator: FlagOperator,
  ) => {
    // Clear values the new operator does not read, so a switch to "is empty"
    // and back cannot leave a stale bound behind that nothing displayed.
    const patch: Partial<FlagCondition> = { operator };
    if (takesList(operator)) {
      // A list operator reads only the list. Typed values would be
      // discarded by the engine, and leaving them in state would bring
      // them back if the analyst switched away again.
      patch.value = "";
      patch.value2 = "";
    } else {
      // The reverse: a list the analyst can no longer see must not ride
      // along on a comparison that ignores it.
      patch.list_id = null;
    }
    if (takesNoValue(operator)) {
      patch.value = "";
      patch.value2 = "";
    } else if (!takesTwoValues(operator)) {
      patch.value2 = "";
    }
    patchCondition(ruleIndex, conditionIndex, patch);
  };

  const toggleOpen = (index: number) => {
    if (openIndex === index) {
      setOpen(null);
      return;
    }
    pendingFocus.current = { kind: "name", rule: index, select: false };
    setOpen(index);
  };

  const removeRule = (index: number) => {
    const next = rules.filter((_, i) => i !== index);
    onChange(next);
    // Focus the rule that moved up into this place, else the one before it, else
    // the button that makes a new one.
    pendingFocus.current =
      next.length === 0
        ? { kind: "add-rule" }
        : { kind: "header", rule: Math.min(index, next.length - 1) };
    setOpen(null);
  };

  const dirty = savedRules
    ? rules.length !== savedRules.length ||
      rules.some((rule, index) => canonical(rule) !== canonical(savedRules[index]))
    : false;

  return (
    <Panel
      title="Flag rules"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 rounded-full border border-change/40 bg-change/8 px-2 py-0.5 text-[11.5px] font-medium text-change"
            >
              <span aria-hidden="true" className="size-1.5 rounded-full bg-change" />
              Unsaved changes
            </span>
          ) : null}
          {rules.length > 0 ? (
            confirmingClear ? (
              <>
                <Button
                  type="button"
                  tone="danger"
                  disabled={disabled}
                  onClick={() => {
                    onChange([]);
                    setConfirmingClear(false);
                    setOpen(null);
                    pendingFocus.current = { kind: "add-rule" };
                  }}
                >
                  Remove all {rules.length}
                </Button>
                <Button
                  type="button"
                  disabled={disabled}
                  onClick={() => setConfirmingClear(false)}
                >
                  Keep
                </Button>
              </>
            ) : (
              <Button
                type="button"
                disabled={disabled}
                onClick={() => setConfirmingClear(true)}
              >
                Remove all
              </Button>
            )
          ) : null}
          <Button
            ref={addRule}
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange([...rules, emptyRule(rules.length)]);
              // A new rule opens, because the next thing anyone does is name it.
              setOpen(rules.length);
              pendingFocus.current = { kind: "name", rule: rules.length, select: true };
            }}
          >
            Add rule
          </Button>
        </div>
      }
    >
      <div className="space-y-3 p-3">
        <p className="text-[12.5px] leading-relaxed text-text-secondary">
          A row is flagged when <strong>any</strong> rule matches it. A rule matches
          when <strong>all</strong> of its conditions hold. Rules run over the rows the
          query returns, so they see at most the row limit.
        </p>

        {rules.length === 0 ? (
          <div className="space-y-3 rounded-[var(--radius-sm)] border border-dashed border-line px-4 py-5">
            <p className="text-[12.5px] text-text-secondary">
              No rules yet, so nothing on this query will be flagged. The dashboard
              does not guess: a row is marked only when a rule here says so.
            </p>
            <p className="text-[12.5px] leading-relaxed text-muted">
              A rule is a plain statement about a row, for example{" "}
              <span className="font-medium text-ink">
                amount is at least 500000 and response_code equals 00
              </span>
              . Give it a name and a severity and it will mark matching rows on the chart.
            </p>
            <Button
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange([emptyRule(0)]);
                setOpen(0);
                pendingFocus.current = { kind: "name", rule: 0, select: true };
              }}
            >
              Add your first rule
            </Button>
          </div>
        ) : null}

        {rules.length > 0 ? (
          <ul className="space-y-2" aria-label="Flag rules">
            {rules.map((rule, ruleIndex) => {
              const isOpen = openIndex === ruleIndex;
              const panelId = `${baseId}-rule-${ruleIndex}`;
              const sentenceId = `${panelId}-sentence`;
              const ruleProblem = problems.get(`rule:${ruleIndex}`);
              const conditionProblems = rule.conditions.flatMap((_, conditionIndex) => {
                const problem = problems.get(`cond:${ruleIndex}:${conditionIndex}`);
                return problem ? [problem] : [];
              });
              const firstProblem = ruleProblem ?? conditionProblems[0];
              const matched = matchCounts?.get(ruleIndex);
              const saved = savedRules ? savedRules[ruleIndex] : undefined;
              const status =
                savedRules === undefined || savedRules === null
                  ? null
                  : saved === undefined
                    ? "New"
                    : canonical(rule) !== canonical(saved)
                      ? "Edited"
                      : null;
              const label = rule.name.trim() || `rule ${ruleIndex + 1}`;

              return (
                <li
                  key={ruleIndex}
                  className={`rounded-[var(--radius)] border bg-surface transition-colors ${
                    isOpen ? "border-line-strong shadow-sm" : "border-line"
                  } ${rule.enabled ? "" : "bg-sunken/60"}`}
                >
                  <div className="flex items-start gap-2 p-2.5">
                    <button
                      type="button"
                      ref={(node) => track(headers, ruleIndex, node)}
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? panelId : undefined}
                      aria-describedby={sentenceId}
                      aria-label={`${isOpen ? "Close" : "Edit"} rule ${label}`}
                      onClick={() => toggleOpen(ruleIndex)}
                      className={`group flex min-w-0 flex-1 items-start gap-2 rounded-[var(--radius-sm)] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                        rule.enabled ? "" : "opacity-60"
                      }`}
                    >
                      <Chevron open={isOpen} />
                      <RuleHeadline
                        rule={rule}
                        listNames={listNames}
                        sentenceId={sentenceId}
                        clamp={!isOpen}
                        trailing={
                          <>
                            {rule.enabled ? null : (
                              <span className="text-[11.5px] text-muted">switched off</span>
                            )}
                            {status ? (
                              <span className="rounded-full bg-change/10 px-1.5 py-px text-[11px] font-medium text-change">
                                {status}
                              </span>
                            ) : null}
                            {matched !== undefined ? (
                              <span className="tnum text-[11.5px] text-muted">{matched} in preview</span>
                            ) : null}
                            {firstProblem && !isOpen ? (
                              <span className="text-[11.5px] font-medium text-change">Needs attention</span>
                            ) : null}
                          </>
                        }
                      />
                    </button>

                    <Switch
                      checked={rule.enabled}
                      disabled={disabled}
                      label={`Rule ${label} is ${rule.enabled ? "on" : "off"}`}
                      onChange={(enabled) => patchRule(ruleIndex, { enabled })}
                    />
                  </div>

                  {!isOpen && firstProblem ? (
                    <p className="-mt-1 px-2.5 pb-2.5 pl-[2.1rem] text-[12px] text-change">{firstProblem}</p>
                  ) : null}

                  {isOpen ? (
                    <div id={panelId} className="space-y-4 border-t border-line p-3">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                        <Field
                          label="Rule name"
                          htmlFor={`rule-name-${ruleIndex}`}
                          error={rule.conditions.length === 0 ? null : (ruleProblem ?? null)}
                        >
                          <Input
                            id={`rule-name-${ruleIndex}`}
                            ref={(node) => track(names, ruleIndex, node)}
                            value={rule.name}
                            disabled={disabled}
                            onChange={(event) => patchRule(ruleIndex, { name: event.target.value })}
                            placeholder="Large transfer"
                          />
                        </Field>

                        <Field label="Severity" htmlFor={`rule-severity-${ruleIndex}`}>
                          <Select
                            id={`rule-severity-${ruleIndex}`}
                            value={rule.severity}
                            disabled={disabled}
                            onChange={(event) =>
                              patchRule(ruleIndex, { severity: event.target.value as FlagSeverity })
                            }
                          >
                            {FLAG_SEVERITIES.map((severity) => (
                              <option key={severity} value={severity}>
                                {severity}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>

                      <div className="space-y-2">
                        <p className="text-[12.5px] font-medium text-ink">
                          Flag a row when{" "}
                          {rule.conditions.length > 1 ? (
                            <span className="text-secondary">all of these hold:</span>
                          ) : (
                            <span className="text-secondary">this holds:</span>
                          )}
                        </p>

                        {rule.conditions.length === 0 && ruleProblem ? (
                          <p className="text-[12px] text-change">{ruleProblem}</p>
                        ) : null}

                        <ul className="space-y-0">
                          {rule.conditions.map((condition, conditionIndex) => {
                            const problem = problems.get(`cond:${ruleIndex}:${conditionIndex}`);
                            // Read out with the control it is about, so a screen reader hears
                            // "Pick a list." on the picker and not just a paragraph below.
                            const problemId = `cond-problem-${ruleIndex}-${conditionIndex}`;
                            const describedBy = problem ? problemId : undefined;
                            // A missing column is said under the column; anything else
                            // (a value, a bound, a list) under the value. On a phone the
                            // three fields stack, and a message after all of them would
                            // sit a screen away from the field it is about.
                            const columnMissing = !condition.column_name.trim();
                            const problemNode = problem ? (
                              <p id={problemId} className="mt-1 text-[12px] text-change">
                                {problem}
                              </p>
                            ) : null;
                            const columnRef = (node: HTMLElement | null) =>
                              track(columnControls, `${ruleIndex}:${conditionIndex}`, node);
                            return (
                              <li key={conditionIndex}>
                                {conditionIndex > 0 ? <AndDivider /> : null}
                                <div className="grid gap-2 sm:grid-cols-[minmax(8rem,1.1fr)_minmax(8rem,1fr)_minmax(10rem,1.7fr)] sm:items-start">
                                  <div className="min-w-0">
                                  {columns.length > 0 ? (
                                    <Select
                                      ref={columnRef}
                                      aria-label="Column"
                                      aria-describedby={describedBy}
                                      value={condition.column_name}
                                      disabled={disabled}
                                      onChange={(event) =>
                                        patchCondition(ruleIndex, conditionIndex, {
                                          column_name: event.target.value,
                                        })
                                      }
                                    >
                                      <option value="">Pick a column…</option>
                                      {/* A rule written before a SELECT change can name a
                                          column the preview no longer returns. Keeping it
                                          as an option means editing the rule does not
                                          silently rewrite it to something else. */}
                                      {!condition.column_name || columns.includes(condition.column_name)
                                        ? null
                                        : (
                                          <option value={condition.column_name}>
                                            {condition.column_name} (not in result)
                                          </option>
                                        )}
                                      {columns.map((column) => (
                                        <option key={column} value={column}>
                                          {column}
                                        </option>
                                      ))}
                                    </Select>
                                  ) : (
                                    <Input
                                      ref={columnRef}
                                      aria-label="Column"
                                      aria-describedby={describedBy}
                                      value={condition.column_name}
                                      disabled={disabled}
                                      onChange={(event) =>
                                        patchCondition(ruleIndex, conditionIndex, {
                                          column_name: event.target.value,
                                        })
                                      }
                                      placeholder="column"
                                    />
                                  )}

                                    {columnMissing ? problemNode : null}
                                  </div>

                                  <Select
                                    aria-label="Comparison"
                                    value={condition.operator}
                                    disabled={disabled}
                                    onChange={(event) =>
                                      changeOperator(
                                        ruleIndex,
                                        conditionIndex,
                                        event.target.value as FlagOperator,
                                      )
                                    }
                                  >
                                    {OPERATORS.map((operator) => (
                                      <option key={operator} value={operator}>
                                        {OPERATOR_LABELS[operator]}
                                      </option>
                                    ))}
                                  </Select>

                                  <div className="min-w-0">
                                    <div className="flex min-w-0 items-start gap-2">
                                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-nowrap">
                                        {takesList(condition.operator) ? (
                                          <Select
                                            aria-label="List"
                                            aria-describedby={describedBy}
                                            value={condition.list_id ?? ""}
                                            disabled={disabled}
                                            onChange={(event) =>
                                              patchCondition(ruleIndex, conditionIndex, {
                                                list_id: event.target.value || null,
                                              })
                                            }
                                          >
                                            <option value="">Pick a list…</option>
                                            {/* A rule can name a list this session has not loaded
                                                (still loading, or gone). Keeping it as an option
                                                means editing the rule does not silently rewrite
                                                it to "no list". */}
                                            {!condition.list_id ||
                                            lists.lists.some((list) => list.id === condition.list_id) ? null : (
                                              <option value={condition.list_id}>
                                                {lists.error
                                                  ? "Not loaded"
                                                  : lists.initial || lists.loading
                                                    ? "Loading…"
                                                    : "Unknown list (removed)"}
                                              </option>
                                            )}
                                            {lists.lists.map((list) => (
                                              <option key={list.id} value={list.id}>
                                                {list.name} ({list.item_count})
                                              </option>
                                            ))}
                                          </Select>
                                        ) : takesNoValue(condition.operator) ? (
                                          <span className="py-2 text-[12.5px] text-muted">Needs no value</span>
                                        ) : (
                                          <>
                                            <Input
                                              aria-label="Value"
                                              aria-describedby={describedBy}
                                              value={condition.value ?? ""}
                                              disabled={disabled}
                                              onChange={(event) =>
                                                patchCondition(ruleIndex, conditionIndex, {
                                                  value: event.target.value,
                                                })
                                              }
                                              placeholder={
                                                condition.operator === "in" || condition.operator === "not_in"
                                                  ? "NG, GH, KE"
                                                  : "500"
                                              }
                                            />
                                            {takesTwoValues(condition.operator) ? (
                                              <>
                                                <span className="text-[12px] text-muted">and</span>
                                                <Input
                                                  aria-label="Upper bound"
                                                  value={condition.value2 ?? ""}
                                                  disabled={disabled}
                                                  onChange={(event) =>
                                                    patchCondition(ruleIndex, conditionIndex, {
                                                      value2: event.target.value,
                                                    })
                                                  }
                                                  placeholder="900"
                                                />
                                              </>
                                            ) : null}
                                          </>
                                        )}
                                      </div>

                                      {rule.conditions.length > 1 ? (
                                        <Button
                                          type="button"
                                          tone="ghost"
                                          disabled={disabled}
                                          className="shrink-0 !px-3 !text-[18px] !leading-none"
                                          onClick={() => {
                                            patchRule(ruleIndex, {
                                              conditions: rule.conditions.filter(
                                                (_, i) => i !== conditionIndex,
                                              ),
                                            });
                                            pendingFocus.current = {
                                              kind: "column",
                                              rule: ruleIndex,
                                              condition: Math.max(0, conditionIndex - 1),
                                            };
                                          }}
                                          aria-label={`Remove condition ${conditionIndex + 1}`}
                                          title="Remove this condition"
                                        >
                                          <span aria-hidden="true">×</span>
                                        </Button>
                                      ) : null}
                                    </div>
                                    {columnMissing ? null : problemNode}
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>

                      {rule.conditions.some((condition) => takesList(condition.operator)) ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {/* A new tab, because this editor holds unsaved SQL, rules and
                              charts that leaving the page would throw away. Once per
                              rule, not once per list condition. */}
                          <Link
                            href="/lists"
                            target="_blank"
                            rel="noopener"
                            title="Opens in a new tab so this rule is not lost"
                            onClick={() => setManagedLists(true)}
                            className="text-[12.5px] font-medium text-accent hover:underline"
                          >
                            Manage lists (new tab)
                          </Link>
                          {/* Only useful once the other tab may have changed something. */}
                          {managedLists && !lists.error ? (
                            <Button type="button" tone="ghost" onClick={lists.reload}>
                              Refresh lists
                            </Button>
                          ) : null}
                          {lists.error ? (
                            <span role="alert" className="text-[12.5px] text-change">
                              Could not load lists: {lists.error.displayMessage}{" "}
                              <button
                                type="button"
                                onClick={lists.reload}
                                className="font-medium underline"
                              >
                                Retry
                              </button>
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                        <Button
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            patchRule(ruleIndex, {
                              conditions: [...rule.conditions, emptyCondition()],
                            });
                            pendingFocus.current = {
                              kind: "column",
                              rule: ruleIndex,
                              condition: rule.conditions.length,
                            };
                          }}
                        >
                          Add condition
                        </Button>
                        <span className="ml-auto flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            tone="danger"
                            disabled={disabled}
                            onClick={() => removeRule(ruleIndex)}
                            aria-label={`Remove rule ${rule.name || ruleIndex + 1}`}
                          >
                            Remove rule
                          </Button>
                          <Button
                            type="button"
                            onClick={() => {
                              pendingFocus.current = { kind: "header", rule: ruleIndex };
                              setOpen(null);
                            }}
                          >
                            Done
                          </Button>
                        </span>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}

/** Remember an element while it is mounted, forget it when it goes. */
function track<K, T>(map: Map<K, T>, key: K, node: T | null) {
  if (node) map.set(key, node);
  else map.delete(key);
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      aria-hidden="true"
      className={`mt-[3px] shrink-0 text-muted transition-transform duration-[var(--tween-fast)] group-hover:text-ink ${
        open ? "rotate-90" : ""
      }`}
    >
      <path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "and", centred on a hairline, between two conditions of one rule. */
function AndDivider() {
  return (
    <div className="my-2 flex items-center gap-2 text-[11px] font-medium tracking-wide text-muted uppercase">
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      and
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
    </div>
  );
}

/**
 * An on/off switch. A button with `role="switch"`, so it is one tab stop, works
 * with Space and Enter, and is announced as on or off, which a bare checkbox
 * squeezed into a rule's header would not make as clear.
 */
function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={checked ? "On: this rule flags rows. Click to switch it off." : "Off: this rule is ignored. Click to switch it on."}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-[var(--tween-fast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "border-accent bg-accent" : "border-line-strong bg-raised"
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-3.5 rounded-full bg-white shadow-sm transition-transform duration-[var(--tween-fast)] ${
          checked ? "translate-x-[1.1rem]" : "translate-x-[0.2rem]"
        }`}
      />
    </button>
  );
}
