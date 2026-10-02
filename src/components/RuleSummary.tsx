import type { ReactNode } from "react";
import type { FlagSeverity } from "@/contracts/api";
import {
  describeRule,
  describeRuleParts,
  type DescribableRule,
  type DescribeOptions,
  type ListNames,
} from "@/services/rules/describe";

/**
 * How a flag rule is shown when it is being read, not edited.
 *
 * One block, used by the editor's collapsed rule and by the read-only
 * definition a viewer or an approving administrator sees, so a rule looks the
 * same wherever it appears: a severity chip, its name, and the sentence it
 * stands for. The sentence comes from `describeRule`; nothing here words a rule
 * itself.
 */

const SEVERITY_STYLE: Record<FlagSeverity, string> = {
  // Weight and a border, never the signal colours: `--signal-alert` means a row
  // matched, and a chip on a rule is configuration, not a finding.
  high: "border-alert/60 font-semibold text-ink",
  medium: "border-line-strong font-medium text-ink",
  low: "border-line text-muted",
};

export function SeverityChip({ severity, className }: { severity: FlagSeverity; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[3px] border px-1.5 py-px text-[11px] tracking-wide uppercase ${SEVERITY_STYLE[severity]} ${className ?? ""}`}
    >
      {severity}
      <span className="sr-only"> severity</span>
    </span>
  );
}

/**
 * A rule's sentence, with the column and the values set apart from the words
 * between them. A part that is missing (no column picked yet) is italic and
 * muted, so a half-written rule reads as a sentence with a visible gap.
 */
export function RuleSentence({
  rule,
  listNames,
  className,
  id,
}: {
  rule: DescribableRule;
  listNames?: ListNames;
  className?: string;
  id?: string;
}) {
  const options: DescribeOptions = { listNames };
  const parts = describeRuleParts(rule, options);
  return (
    <span
      id={id}
      // The whole sentence, uncut, for a pointer to find when a value was long.
      title={describeRule(rule, { listNames, maxValueLength: 0 })}
      className={className}
    >
      {parts.map((part, index) => (
        <span
          key={index}
          className={
            part.placeholder
              ? "text-muted italic"
              : part.kind === "words"
                ? "text-secondary"
                : "font-medium text-ink"
          }
        >
          {index > 0 ? " " : ""}
          {part.text}
        </span>
      ))}
    </span>
  );
}

/**
 * The name line and the sentence under it. `trailing` is for small state next to
 * the name (switched off, edited, how many rows it caught).
 */
export function RuleHeadline({
  rule,
  listNames,
  trailing,
  sentenceId,
  clamp = true,
}: {
  rule: DescribableRule & { name: string; severity: FlagSeverity };
  listNames?: ListNames;
  trailing?: ReactNode;
  sentenceId?: string;
  /** Cut the sentence to two lines. Off where there is room to read it all. */
  clamp?: boolean;
}) {
  return (
    <span className="block min-w-0">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <SeverityChip severity={rule.severity} />
        <span className="min-w-0 truncate text-[13.5px] font-medium text-ink" title={rule.name}>
          {rule.name.trim() || "Untitled rule"}
        </span>
        {trailing}
      </span>
      <RuleSentence
        rule={rule}
        listNames={listNames}
        id={sentenceId}
        className={`mt-1 block text-[12.5px] leading-snug ${clamp ? "line-clamp-2" : ""}`}
      />
    </span>
  );
}
