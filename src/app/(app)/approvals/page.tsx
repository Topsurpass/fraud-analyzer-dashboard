"use client";

/**
 * Charts that analysts have asked to share, waiting for an administrator.
 *
 * Nothing an analyst does publishes a chart to the team: it lands here, and an
 * administrator decides. Each request opens the same read-only definition an
 * ordinary viewer gets, so the SQL is read before it is shown to everyone, which
 * is the reason approval exists. Approving publishes; rejecting sends it back to
 * the author with the reason, and they can ask again after changing it.
 *
 * The queue is the provider's, not this page's, so the count in the rail and the
 * line in the bell fall the moment a decision lands, with no reload.
 */

import { useState } from "react";
import {
	ApiError,
	approvePublishRequest,
	rejectPublishRequest,
} from "@/services/api-client";
import type { PublishRequestRead } from "@/contracts/api";
import { CHART_LABELS } from "@/components/CardMenu";
import { DefinitionDialog } from "@/components/DefinitionDialog";
import { PageBody } from "@/components/PageBody";
import { Button, EmptyState, ErrorState, LinkButton, Panel, Textarea } from "@/components/ui";
import { useNow } from "@/lib/useNow";
import { useAuth } from "@/services/auth/AuthContext";
import { isAdmin } from "@/services/auth/permissions";
import { formatRelative } from "@/services/format";
import { usePublishRequests } from "@/services/publishing/PublishRequestsContext";

const CRUMBS = [{ label: "Approvals" }];

/** What the last decision did, said on the page and not in the row it removed. */
interface Notice {
	tone: "ok" | "problem";
	text: string;
}

export default function ApprovalsPage() {
	const { user } = useAuth();
	const queue = usePublishRequests();
	const [reviewing, setReviewing] = useState<string | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);

	// A decision removes its row, so anything said about it has to live above
	// the list: a message inside the row would vanish with it, which is exactly
	// when somebody who lost a race (the engine says it was already decided)
	// needs to read it.
	const decided = (result: Notice) => {
		setNotice(result);
		queue.reload();
	};

	// Reachable by URL for anyone, so say plainly what this is rather than
	// showing an empty list that looks like "nothing is waiting". The engine
	// refuses the queue to a non-administrator regardless; this is what the
	// person reads meanwhile.
	if (!isAdmin(user)) {
		return (
			<PageBody crumbs={CRUMBS}>
				<EmptyState
					title="Administrators only"
					body="Charts you ask to publish are approved here by an administrator. You will see the decision on the chart itself."
					action={<LinkButton href="/">Back to the overview</LinkButton>}
				/>
			</PageBody>
		);
	}

	return (
		<PageBody crumbs={CRUMBS}>
			<p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-muted">
				An analyst asked to share each of these charts with everyone signed in. Read the query
				first: once approved, anyone can see the chart, its alerts and the SQL behind it.
			</p>

			{notice ? (
				<p
					role={notice.tone === "problem" ? "alert" : "status"}
					className={`mb-3 rounded-[var(--radius-sm)] border px-3 py-2 text-[12.5px] ${
						notice.tone === "problem"
							? "border-change/40 bg-change/5 text-change"
							: "border-line bg-sunken text-secondary"
					}`}
				>
					{notice.text}
				</p>
			) : null}

			{queue.error && queue.requests.length === 0 ? (
				<ErrorState
					title="Could not load the requests"
					message={queue.error.displayMessage}
					onRetry={queue.reload}
				/>
			) : queue.initial ? (
				<div className="skeleton-sweep h-40 rounded-[var(--radius-lg)] border border-line bg-surface" />
			) : queue.requests.length === 0 ? (
				<EmptyState
					title="Nothing is waiting"
					body="When an analyst asks to publish a chart, the request appears here and in the bell."
				/>
			) : (
				<ul className="space-y-3" aria-label="Publish requests">
					{queue.requests.map((request) => (
						<RequestRow
							key={request.chart.id}
							request={request}
							onReview={() => setReviewing(request.chart.id)}
							onDecided={decided}
						/>
					))}
				</ul>
			)}

			<DefinitionDialog chartId={reviewing} onClose={() => setReviewing(null)} />
		</PageBody>
	);
}

function RequestRow({
	request,
	onReview,
	onDecided,
}: {
	request: PublishRequestRead;
	onReview: () => void;
	onDecided: (result: Notice) => void;
}) {
	const now = useNow(30_000);
	const [busy, setBusy] = useState<null | "approve" | "reject">(null);
	const [rejecting, setRejecting] = useState(false);
	const [reason, setReason] = useState("");
	const [problem, setProblem] = useState<string | null>(null);

	const { chart } = request;

	const decide = async (kind: "approve" | "reject") => {
		setBusy(kind);
		setProblem(null);
		try {
			if (kind === "approve") await approvePublishRequest(chart.id);
			else await rejectPublishRequest(chart.id, reason);
			onDecided({
				tone: "ok",
				text:
					kind === "approve"
						? `Approved “${chart.name}”. Everyone signed in can see it now.`
						: `Rejected “${chart.name}”. It is private again and ${request.requested_by.full_name} can see why.`,
			});
		} catch (cause) {
			// Somebody else may have decided it first (a 409). What is on screen
			// is then stale, so the page re-reads, and the explanation goes on
			// the page because this row is about to leave it.
			if (cause instanceof ApiError && cause.status === 409) {
				onDecided({ tone: "problem", text: cause.displayMessage });
			} else {
				setProblem(
					cause instanceof ApiError ? cause.displayMessage : `Could not ${kind} this request.`,
				);
			}
		} finally {
			setBusy(null);
		}
	};

	return (
		<li>
			<Panel
				title={chart.name}
				actions={
					<span className="text-[12px] text-muted">
						{CHART_LABELS[chart.chart_type] ?? chart.chart_type}
					</span>
				}
			>
				<div className="space-y-3 px-5 py-4">
					<p className="text-[13px] text-secondary">
						<span className="font-medium text-ink">{request.requested_by.full_name}</span>{" "}
						<span className="text-muted">({request.requested_by.email})</span> asked{" "}
						{formatRelative(request.requested_at, now)} to publish this chart from the query{" "}
						<span className="font-medium text-ink">{request.query_name}</span> on{" "}
						{request.connection_name}.
					</p>

					{problem ? (
						<p
							role="alert"
							className="rounded-[var(--radius-sm)] border border-change/40 bg-change/5 px-3 py-2 text-[12.5px] text-change"
						>
							{problem}
						</p>
					) : null}

					{rejecting ? (
						<div className="space-y-2">
							<label
								htmlFor={`reason-${chart.id}`}
								className="block text-[12.5px] font-medium text-ink"
							>
								Reason{" "}
								<span className="font-normal text-muted">
									(optional, the author will see it)
								</span>
							</label>
							<Textarea
								id={`reason-${chart.id}`}
								value={reason}
								maxLength={500}
								rows={3}
								onChange={(event) => setReason(event.target.value)}
								disabled={busy !== null}
								data-autofocus
							/>
							<div className="flex flex-wrap gap-2">
								<Button
									type="button"
									tone="danger"
									disabled={busy !== null}
									onClick={() => decide("reject")}
								>
									{busy === "reject" ? "Rejecting…" : "Send rejection"}
								</Button>
								<Button type="button" disabled={busy !== null} onClick={() => setRejecting(false)}>
									Cancel
								</Button>
							</div>
						</div>
					) : (
						<div className="flex flex-wrap gap-2">
							<Button type="button" onClick={onReview} disabled={busy !== null}>
								View definition
							</Button>
							<Button
								type="button"
								tone="primary"
								disabled={busy !== null}
								onClick={() => decide("approve")}
							>
								{busy === "approve" ? "Approving…" : "Approve"}
							</Button>
							<Button type="button" disabled={busy !== null} onClick={() => setRejecting(true)}>
								Reject
							</Button>
						</div>
					)}
				</div>
			</Panel>
		</li>
	);
}
