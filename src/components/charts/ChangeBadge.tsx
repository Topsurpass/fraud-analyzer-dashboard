import type { ChangeVerdict } from "@/services/charts/severity";
import { changeLabel } from "@/services/charts/severity";

/**
 * The one way this app says "this moved enough to look at".
 *
 * Three rules it exists to enforce in a single place, because the moment two
 * charts each grow their own version they drift:
 *
 * **It is never colour alone.** A glyph and a signed percentage carry the
 * finding, so the badge survives colour blindness, a greyscale print and a
 * forced-colours mode. Colour is the third encoding, not the first.
 *
 * **It is amber, never red.** `--signal-alert` means one specific thing in this
 * app - a flag rule matched this row - and the whole flagging feature depends
 * on that staying true. A large percentage change is not a rule match; it is
 * movement, which is what `--signal-change` already means on the card's pulse
 * line. Reusing red here would quietly turn "a rule caught this" into "either a
 * rule caught this or a number moved a lot", and no amount of documentation
 * recovers a colour once it means two things.
 *
 * **Under the threshold it is quiet.** A chart where every row wears a badge
 * has told the reader nothing, so an ordinary movement renders as muted text
 * with no chip at all.
 */

export interface ChangeBadgeProps {
  verdict: ChangeVerdict;
  /** What moved, for the screen-reader sentence. Keep it short. */
  subject?: string;
  className?: string;
}

/** Direction as a shape, so the glyph alone answers "which way". */
function glyph(verdict: ChangeVerdict): string {
  if (verdict.severity === "surge") return "▲";
  if (verdict.severity === "drop") return "▼";
  return verdict.pctChange === null ? "·" : verdict.pctChange > 0 ? "↑" : "↓";
}

export function ChangeBadge({ verdict, subject, className }: ChangeBadgeProps) {
  const label = changeLabel(verdict);
  const flagged = verdict.severity !== "normal";

  // Spelled out for assistive tech: "▲ +240%" is not a sentence, and the
  // threshold is the context that makes the badge mean anything.
  const spoken = flagged
    ? `${subject ? `${subject}: ` : ""}${
        verdict.severity === "surge" ? "surge" : "drop"
      } of ${label}, past the ${verdict.threshold}% threshold`
    : `${subject ? `${subject}: ` : ""}${label}`;

  if (!flagged) {
    return (
      <span className={`tnum text-[10px] text-muted ${className ?? ""}`}>
        <span aria-hidden="true">{glyph(verdict)} </span>
        <span aria-hidden="true">{label}</span>
        <span className="sr-only">{spoken}</span>
      </span>
    );
  }

  return (
    <span
      className={`tnum inline-flex shrink-0 items-center gap-0.5 rounded-[3px] px-1 py-px text-[10px] font-medium leading-tight ${className ?? ""}`}
      style={{
        backgroundColor: "var(--signal-change-dim)",
        color: "var(--signal-change)",
        // A border as well as a fill: in forced-colours mode backgrounds are
        // replaced wholesale and a fill-only chip disappears entirely.
        border: "1px solid var(--signal-change)",
      }}
      title={`Past the ${verdict.threshold}% threshold`}
    >
      <span aria-hidden="true">{glyph(verdict)}</span>
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
