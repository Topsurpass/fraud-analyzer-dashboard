"use client";

import type { FlagSeverity } from "@/contracts/api";
import { formatInteger } from "@/services/format";

/**
 * "There is something to review here, and this is how bad it is."
 *
 * Renders nothing at zero. A badge reading 0 is chrome that has to be read
 * before it can be dismissed, and the whole point is to be scannable: on a page
 * of twelve connections the eye should catch the two that need attention.
 *
 * Severity is carried by weight and border, not by hue alone. The design brief
 * reserves --signal-alert for marks in the data itself, and a badge is chrome;
 * it also keeps the ranking readable to anyone who cannot separate the colours.
 */
export function FlaggedBadge({
	count,
	severity,
	label = "flagged",
}: {
	count: number;
	severity?: FlagSeverity | null;
	label?: string;
}) {
	if (count <= 0) return null;

	const weight =
		severity === "high"
			? "border-alert/70 font-semibold text-ink"
			: severity === "medium"
				? "border-line font-medium text-ink"
				: "border-line/60 text-muted";

	return (
		<span
			className={`tnum inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] leading-none ${weight}`}
			title={`${count} ${label}${severity ? `, highest severity ${severity}` : ""}`}
		>
			<span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-alert" />
			{formatInteger(count)}
			<span className="sr-only">{` ${label}`}</span>
		</span>
	);
}
