import type { QueryChart } from "@/contracts/api";

/**
 * The mark that says a chart is visible to the whole team.
 *
 * Deliberately quiet. Most charts are private, so the badge is the exception
 * rather than the rule, and a loud treatment on the exception makes a board of
 * mostly-private cards look alarming. It is also deliberately NOT in either
 * signal colour: `--signal-alert` means a flag rule matched a row and
 * `--signal-change` means a measure moved past its threshold. "Other people can
 * see this" is neither of those, and borrowing one of them would blunt both.
 *
 * The tooltip carries the consequence rather than restating the state, because
 * the state is already obvious from the word and the consequence is not: a
 * published chart's query is frozen.
 */
export function PublishedBadge({
  chart,
  className,
}: {
  chart: Pick<QueryChart, "is_public">;
  className?: string;
}) {
  if (!chart.is_public) return null;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-[3px] border border-line-strong px-1 py-px text-[10px] font-medium leading-tight text-muted ${className ?? ""}`}
      title="Everyone signed in can see this chart. Its query is frozen while it is published."
    >
      {/*
       * A filled dot rather than an icon font or an SVG: it reads at 10px,
       * costs nothing, and cannot fail to load.
       */}
      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-current" />
      Published
      <span className="sr-only">
        . Visible to everyone signed in, and its query is frozen while published.
      </span>
    </span>
  );
}
