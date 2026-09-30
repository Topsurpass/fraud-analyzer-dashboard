import type { FlagOutcome, FlagSeverity } from "@/contracts/api";
import { formatInteger } from "@/services/format";

/**
 * The rules behind a card's flagged marks, in one row under its title.
 *
 * The marks on a chart say *where* something was flagged; this says *why*. It
 * works for every chart type because it reads the run's own outcome rather than
 * the shaped data, so a number card or a heatmap names its rules the same way a
 * bar chart does. Only rules that matched something are shown: a rule that
 * caught nothing is not news on a card.
 *
 * Severity is a word as well as a tint, so the ranking survives colour
 * blindness.
 */
const TONE: Record<FlagSeverity, string> = {
  high: "border-alert/30 bg-alert/10 text-alert",
  medium: "border-change/30 bg-change/10 text-change",
  low: "border-line bg-raised text-secondary",
};

const ORDER: Record<FlagSeverity, number> = { high: 0, medium: 1, low: 2 };

export function FlagStrip({ flags }: { flags: FlagOutcome | undefined }) {
  const hits = (flags?.rules ?? [])
    .filter((rule) => rule.matched > 0)
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.matched - a.matched);

  if (hits.length === 0) return null;

  return (
    <ul aria-label="Flag rules that matched" className="flex flex-wrap items-center gap-1.5 px-5 pb-2">
      {hits.map((rule) => (
        <li
          key={rule.id}
          className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium ${TONE[rule.severity]}`}
          title={`${rule.name}: ${formatInteger(rule.matched)} ${rule.matched === 1 ? "row" : "rows"}, ${rule.severity} severity`}
        >
          <svg width={11} height={11} viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0">
            <path
              d="M3 11V1.5M3 2h6.2l-1.4 2.4L9.2 6.8H3"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="truncate">{rule.name}</span>
          <span className="tnum shrink-0 opacity-80">{formatInteger(rule.matched)}</span>
          <span className="sr-only">
            {rule.matched === 1 ? " row" : " rows"}, {rule.severity} severity
          </span>
        </li>
      ))}
    </ul>
  );
}
