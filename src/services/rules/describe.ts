import type { FlagOperator } from "@/contracts/api";

/**
 * What a flag rule says, in a sentence.
 *
 * A rule is a column, a comparison and a value, repeated and ANDed. Read as
 * three form fields per condition it is accurate and hard to take in: a rule
 * with three conditions fills a screen and says nothing until you have read
 * every field. This turns the same data into the line a person would say out
 * loud ("amount is at least 300 and outcome is declined"), so a list of rules
 * can be read at a glance and the editor only opens for the one being changed.
 *
 * It is the single source of that wording. The editor's collapsed line, the
 * read-only definition a viewer sees, and the tests all go through it, so the
 * same rule never reads two different ways on two screens.
 *
 * Pure on purpose: no React, no lookups. A condition names a list by id; the
 * caller says how to turn that id into a name (`listNames`), and when nothing
 * can, the sentence says "a list" and never prints the id, which means nothing
 * to anyone.
 */

/** The longest a single typed value is shown before it is cut. */
export const MAX_VALUE_LENGTH = 40;
/** How many members of an "is one of" list are named before "and N more". */
export const MAX_LISTED_MEMBERS = 5;

/** What the sentence needs to know about one condition. */
export interface DescribableCondition {
  column_name: string;
  operator: FlagOperator;
  value?: string | null;
  value2?: string | null;
  list_id?: string | null;
  /** Set by the engine on a read; the name of the list `list_id` points at. */
  list_name?: string | null;
}

export interface DescribableRule {
  conditions: readonly DescribableCondition[];
}

/** An id to a name. A map or a function; either may know nothing about an id. */
export type ListNames = ReadonlyMap<string, string> | ((id: string) => string | undefined);

export interface DescribeOptions {
  listNames?: ListNames;
  maxValueLength?: number;
}

/**
 * One piece of a sentence, so a screen can set the column and the values apart
 * from the words between them without parsing a string.
 *
 * `placeholder` marks a part that is missing (no column picked, no value typed):
 * a half-written rule still reads as a sentence, with the gap visible.
 */
export interface Part {
  kind: "column" | "words" | "value";
  text: string;
  placeholder?: boolean;
}

/** The words that follow the column, for every operator. */
export const OPERATOR_WORDS: Record<FlagOperator, string> = {
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  eq: "equals",
  neq: "does not equal",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  in: "is one of",
  not_in: "is not one of",
  in_list: "is in",
  not_in_list: "is not in",
  is_null: "is empty",
  is_not_null: "is not empty",
  between: "is between",
};

const NO_COLUMN = "(no column)";
const NO_VALUE = "(no value)";
const ELLIPSIS = "…";

/** Collapse runs of whitespace (a value pasted with a line break) and trim. */
function tidy(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Cut to `max` characters, marking the cut. Never splits an empty string. */
function clip(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}${ELLIPSIS}`;
}

function listName(condition: DescribableCondition, names: ListNames | undefined): string | null {
  if (condition.list_name) return condition.list_name;
  if (!condition.list_id || !names) return null;
  const found = typeof names === "function" ? names(condition.list_id) : names.get(condition.list_id);
  return found || null;
}

/**
 * The members of an "is one of" value, as the engine reads it: split on commas,
 * trimmed, empties dropped. Shown up to a handful, then "and N more", so seven
 * country codes do not turn one line into three.
 */
function members(raw: string, max: number): string {
  const items = raw
    .split(",")
    .map((item) => tidy(item))
    .filter(Boolean);
  if (items.length === 0) return "";
  const shown = items.slice(0, MAX_LISTED_MEMBERS).map((item) => clip(item, max));
  const rest = items.length - shown.length;
  if (rest <= 0) {
    return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} or ${shown[shown.length - 1]}` : shown[0];
  }
  return `${shown.join(", ")} and ${rest} more`;
}

/** One condition as parts: the column, the words, and the value(s). */
export function describeConditionParts(
  condition: DescribableCondition,
  options: DescribeOptions = {},
): Part[] {
  const max = options.maxValueLength ?? MAX_VALUE_LENGTH;
  const column = tidy(condition.column_name);
  const parts: Part[] = [
    column ? { kind: "column", text: column } : { kind: "column", text: NO_COLUMN, placeholder: true },
    { kind: "words", text: OPERATOR_WORDS[condition.operator] ?? String(condition.operator) },
  ];

  const operator = condition.operator;
  const first = tidy(condition.value);
  const second = tidy(condition.value2);

  if (operator === "is_null" || operator === "is_not_null") return parts;

  if (operator === "in_list" || operator === "not_in_list") {
    const name = listName(condition, options.listNames);
    if (name) {
      parts.push({ kind: "words", text: "the list" }, { kind: "value", text: `“${clip(tidy(name), max)}”` });
    } else if (condition.list_id) {
      // A list that exists but whose name is not known here (still loading, or
      // removed): say so without printing an id.
      parts.push({ kind: "value", text: "a list" });
    } else {
      parts.push({ kind: "value", text: "(no list)", placeholder: true });
    }
    return parts;
  }

  if (operator === "between") {
    parts.push(
      first ? { kind: "value", text: clip(first, max) } : { kind: "value", text: NO_VALUE, placeholder: true },
      { kind: "words", text: "and" },
      second ? { kind: "value", text: clip(second, max) } : { kind: "value", text: NO_VALUE, placeholder: true },
    );
    return parts;
  }

  if (operator === "in" || operator === "not_in") {
    const text = members(condition.value ?? "", max);
    parts.push(text ? { kind: "value", text } : { kind: "value", text: NO_VALUE, placeholder: true });
    return parts;
  }

  parts.push(first ? { kind: "value", text: clip(first, max) } : { kind: "value", text: NO_VALUE, placeholder: true });
  return parts;
}

/** One condition as a sentence fragment: `amount is at least 300`. */
export function describeCondition(condition: DescribableCondition, options: DescribeOptions = {}): string {
  return describeConditionParts(condition, options)
    .map((part) => part.text)
    .join(" ");
}

/** A rule's conditions as parts, with an `and` between them. */
export function describeRuleParts(rule: DescribableRule, options: DescribeOptions = {}): Part[] {
  if (rule.conditions.length === 0) return [{ kind: "words", text: "has no conditions yet", placeholder: true }];
  return rule.conditions.flatMap((condition, index) => {
    const parts = describeConditionParts(condition, options);
    return index === 0 ? parts : [{ kind: "words" as const, text: "and" }, ...parts];
  });
}

/**
 * A rule as a sentence: `amount is at least 300 and outcome is declined`.
 * Conditions are ANDed, as the engine evaluates them; a row is flagged when any
 * enabled rule matches, which is stated once on the screen and not per rule.
 */
export function describeRule(rule: DescribableRule, options: DescribeOptions = {}): string {
  return describeRuleParts(rule, options)
    .map((part) => part.text)
    .join(" ");
}
