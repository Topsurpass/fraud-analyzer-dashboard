import type { PublishRejection, PublishStatus, QueryChart } from "@/contracts/api";

/**
 * What the publish control on a chart should say and do.
 *
 * The workflow has three states and two kinds of person, and a menu item that
 * has to be right for every pairing is the kind of thing that ends up as a
 * nest of ternaries in a component. It is one function here so a test can walk
 * every pairing, and so the sentence an analyst reads ("Request publishing")
 * and the sentence an administrator reads ("Publish to the team") cannot drift
 * from what the engine will actually do on that click.
 *
 * Only the engine decides what is allowed. This is what stops the interface
 * offering an action whose result would surprise: an analyst who clicked
 * "Publish" and got a request would reasonably think it had gone live.
 */

type ChartPublication = Pick<QueryChart, "is_public"> &
	Partial<Pick<QueryChart, "publish_status" | "publish_rejection">>;

/**
 * The chart's state, read from `publish_status` when the engine sends it and
 * from `is_public` when it does not (an engine older than the workflow, which
 * could only ever be private or published).
 */
export function publishStatusOf(chart: ChartPublication): PublishStatus {
	if (chart.publish_status) return chart.publish_status;
	return chart.is_public ? "published" : "private";
}

export type PublishActionKind =
	/** Admin: publishes at once. */
	| "publish"
	/** Author who is not an admin: asks an administrator. */
	| "request"
	/** Author: takes a waiting request back. */
	| "withdraw"
	/** Takes a published chart down. */
	| "unpublish"
	/** Admin looking at someone's waiting request: go and decide it. */
	| "review";

export interface PublishAction {
	kind: PublishActionKind;
	label: string;
	/** Shown while the request is in flight. Absent for a plain link. */
	busyLabel?: string;
	/** The consequence, as a tooltip, because it is the part nobody guesses. */
	hint: string;
}

export function publishActionFor(chart: ChartPublication, admin: boolean): PublishAction {
	const status = publishStatusOf(chart);

	if (status === "published") {
		return {
			kind: "unpublish",
			label: "Unpublish (unfreezes the query)",
			busyLabel: "Unpublishing…",
			hint: "Takes the chart down for everyone else and lets the query be edited again.",
		};
	}

	if (status === "pending") {
		return admin
			? {
					kind: "review",
					label: "Review publish request",
					hint: "Opens the queue where a request is approved or rejected.",
				}
			: {
					kind: "withdraw",
					label: "Withdraw publish request (unfreezes the query)",
					busyLabel: "Withdrawing…",
					hint: "Cancels the request. Nobody else has seen the chart, and the query can be edited again.",
				};
	}

	if (admin) {
		return {
			kind: "publish",
			label: "Publish to the team (freezes the query)",
			busyLabel: "Publishing…",
			hint: "Everyone signed in can see it at once, and the query cannot be edited while it is published.",
		};
	}

	return {
		kind: "request",
		label: chart.publish_rejection
			? "Request publishing again"
			: "Request publishing (an administrator approves it)",
		busyLabel: "Asking…",
		hint: "An administrator decides whether it is shared. The query is frozen while the request waits.",
	};
}

/**
 * A rejection, as the sentence the author reads on the card. Null when the
 * chart has no rejection to report.
 */
export function rejectionNote(
	rejection: PublishRejection | null | undefined,
): { headline: string; reason: string | null } | null {
	if (!rejection) return null;
	return {
		headline: `Not published: ${rejection.rejected_by_name} declined the request.`,
		reason: rejection.reason && rejection.reason.trim() ? rejection.reason.trim() : null,
	};
}
