"use client";

/**
 * Every flagged row on one connection, grouped by the query that produced it.
 *
 * This view reads the engine's cache and runs nothing, so opening it costs the
 * target database nothing. That is also why each section states when it last
 * ran: rows here are as fresh as the last run of their query, not as fresh as
 * this page load, and pretending otherwise would be the whole point of the
 * feature quietly lying.
 */

import { use, useCallback, useMemo, useState } from "react";
import {
	ApiError,
	deleteFlaggedRows,
	dismissFlaggedRows,
	getConnectionFlagged,
	putFlagRules,
	refreshConnectionFlagged,
	restoreFlaggedRows,
} from "@/services/api-client";
import type { FlaggedQuery, FlagSeverity, RuleHit } from "@/contracts/api";
import { useConnections } from "@/services/connections/ConnectionsContext";
import { useFlagged } from "@/services/flagged/FlaggedContext";
import { useResource } from "@/lib/useResource";
import { PageBody } from "@/components/PageBody";
import { Button, EmptyState, ErrorState, LinkButton, Panel } from "@/components/ui";
import { formatCell, formatInteger } from "@/services/format";

const SEVERITY_RANK: Record<FlagSeverity, number> = { low: 0, medium: 1, high: 2 };

/** Highest severity first, so the worst thing on the page is at the top. */
export function bySeverityThenCount(a: FlaggedQuery, b: FlaggedQuery): number {
	const worst = (section: FlaggedQuery) =>
		section.rules.reduce(
			(rank, rule) =>
				rule.matched > 0 ? Math.max(rank, SEVERITY_RANK[rule.severity]) : rank,
			-1,
		);
	const difference = worst(b) - worst(a);
	return difference !== 0 ? difference : b.flagged_count - a.flagged_count;
}

function SeverityPill({ severity }: { severity: FlagSeverity }) {
	// Never --signal-alert: the design brief reserves that for data marks, and
	// a pill is chrome. Weight and border carry the ranking instead of colour,
	// which also keeps it legible to anyone who cannot separate the hues.
	const weight =
		severity === "high"
			? "border-alert/60 font-semibold text-ink"
			: severity === "medium"
				? "border-line font-medium text-ink"
				: "border-line/60 text-muted";
	return (
		<span
			className={`border px-1.5 py-0.5 text-[10px] tracking-wide uppercase ${weight}`}
		>
			{severity}
		</span>
	);
}

/**
 * The rules that caught things here, and the filter for them.
 *
 * The legend already listed every rule with its count, so making it clickable
 * adds filtering without adding a control: "which of these caught it" is the
 * question the legend was already answering, and now it can also narrow to the
 * answer. A rule that caught nothing is not offered - filtering to an empty
 * table is not a thing anyone wants to click.
 */
function RuleLegend({
	rules,
	active,
	onPick,
}: {
	rules: RuleHit[];
	active: string | null;
	onPick: (ruleId: string | null) => void;
}) {
	if (rules.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{active ? (
				<button
					type="button"
					onClick={() => onPick(null)}
					className="rounded-[var(--radius-full)] border border-line px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-line-strong hover:text-ink"
				>
					Show all
				</button>
			) : null}
			{[...rules]
				.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
				.map((rule) => {
					const selected = active === rule.id;
					const empty = rule.matched === 0;
					return (
						<button
							key={rule.id}
							type="button"
							disabled={empty}
							aria-pressed={selected}
							// Without this the accessible name is the button's contents -
							// "high Large 1" - which tells a screen reader what it says
							// rather than what it does.
							aria-label={
								empty
									? `${rule.name} caught nothing here`
									: selected
										? `Stop filtering by ${rule.name}`
										: `Show only what ${rule.name} caught`
							}
							title={
								empty
									? `${rule.name} caught nothing here`
									: `Show only what ${rule.name} caught`
							}
							onClick={() => onPick(selected ? null : rule.id)}
							className={`flex items-center gap-1 rounded-[var(--radius-full)] border px-2 py-0.5 text-[11px] transition-colors ${
								selected
									? "border-accent/50 bg-accent/12 text-ink"
									: empty
										? "border-line/60 text-muted/60"
										: "border-line text-secondary hover:border-line-strong hover:text-ink"
							}`}
						>
							<SeverityPill severity={rule.severity} />
							<span className="truncate">{rule.name}</span>
							<span className="tnum">{formatInteger(rule.matched)}</span>
						</button>
					);
				})}
		</div>
	);
}

/**
 * Findings shown per page.
 *
 * The queue is a work list, not a report: a page is what someone can actually
 * work through before losing their place. Rendering the whole thing was both
 * slow and useless - nobody reviews finding 400 by scrolling past 399 others -
 * and an unbounded section pushed every other query on the connection off the
 * screen entirely.
 */
const PAGE_SIZE = 25;

/** Height of the scrolling body, so one section cannot swallow the page. */
const BODY_MAX_HEIGHT = "26rem";

function Section({
	section,
	onChanged,
}: {
	section: FlaggedQuery;
	onChanged: () => void;
}) {
	// Rebuilt on every render otherwise, and this runs while a poll is updating
	// the badges above it.
	const ruleById = useMemo(
		() => new Map(section.rules.map((rule) => [rule.id, rule])),
		[section.rules],
	);

	// Filter first, then page: paging a filtered list is the only order that
	// lets "show me what Large transfer caught" mean anything.
	const [ruleFilter, setRuleFilter] = useState<string | null>(null);
	const [page, setPage] = useState(0);

	const filtered = useMemo(
		() =>
			ruleFilter
				? section.rows.filter((row) => row.rule_ids.includes(ruleFilter))
				: section.rows,
		[section.rows, ruleFilter],
	);

	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	// Dismissing the last row of the last page would otherwise leave the reader
	// staring at an empty table with no way back.
	const safePage = Math.min(page, pageCount - 1);
	const shown = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const [confirmingRules, setConfirmingRules] = useState(false);
	// The badges elsewhere read a summary of this same queue, so anything that
	// changes it has to refresh them or the rail keeps claiming work that is
	// already done.
	const flaggedSummary = useFlagged();

	// Every action here is a write followed by a reload, and every one of them
	// can fail the same way, so they share one wrapper rather than three copies
	// of the same try/catch with three slightly different error messages.
	const run = async (what: string, action: () => Promise<unknown>) => {
		setBusy(true);
		setProblem(null);
		try {
			await action();
			onChanged();
			flaggedSummary.reload();
		} catch (cause) {
			setProblem(
				cause instanceof ApiError ? cause.displayMessage : `Could not ${what}.`,
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Panel
			title={section.query_name}
			actions={
				<div className="flex flex-wrap items-center gap-2">
					{section.dismissed_count > 0 ? (
						<Button
							type="button"
							disabled={busy}
							title="Stop suppressing these rows. Dismissing deleted them, so they reappear when this query next runs."
							onClick={() =>
								run("restore these rows", () => restoreFlaggedRows(section.query_id))
							}
						>
							Restore {section.dismissed_count}
						</Button>
					) : null}

					{section.rows.length > 0 ? (
						<>
							<Button
								type="button"
								disabled={busy}
								onClick={() =>
									run("dismiss these rows", () =>
										dismissFlaggedRows(
											section.query_id,
											section.rows.map((row) => row.fingerprint),
										),
									)
								}
							>
								Dismiss all {section.rows.length}
							</Button>
							{/* Deliberately not the same as dismissing. Dismissing is a
							    decision and is remembered; clearing only empties the
							    queue, and anything still matching returns on the next
							    run. Useful right after changing a rule. */}
							<Button
								type="button"
								disabled={busy}
								title="Empty this queue without marking the rows reviewed. Anything still matching comes back on the next run."
								onClick={() =>
									run("clear this queue", () => deleteFlaggedRows(section.query_id))
								}
							>
								Clear
							</Button>
						</>
					) : null}

					{confirmingRules ? (
						<>
							<Button
								type="button"
								tone="danger"
								disabled={busy}
								onClick={() =>
									run("delete these rules", async () => {
										await putFlagRules(section.query_id, { rules: [] });
										setConfirmingRules(false);
									})
								}
							>
								Delete {section.rules.length}{" "}
								{section.rules.length === 1 ? "rule" : "rules"}
							</Button>
							<Button type="button" disabled={busy} onClick={() => setConfirmingRules(false)}>
								Keep
							</Button>
						</>
					) : (
						<Button type="button" disabled={busy} onClick={() => setConfirmingRules(true)}>
							Delete rules
						</Button>
					)}

					<LinkButton href={`/queries/${section.query_id}`}>Edit rules</LinkButton>
				</div>
			}
		>
			<div className="space-y-2 p-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<RuleLegend
						rules={section.rules}
						active={ruleFilter}
						onPick={(ruleId) => {
							setRuleFilter(ruleId);
							setPage(0);
						}}
					/>
					<span className="text-[10px] text-muted">
						{section.executed_at
							? `as of ${new Date(section.executed_at).toLocaleString()}`
							: "not run yet"}
					</span>
				</div>

				{problem ? (
					<p className="border border-change/40 bg-change/5 px-3 py-2 text-[11px] text-change">
						{problem}
					</p>
				) : null}

				{section.error_code ? (
					<p className="border border-change/40 bg-change/5 px-3 py-2 text-[11px] text-change">
						This query failed to run: {section.error_message ?? section.error_code}.
						The rows below, if any, are from the last successful run.
					</p>
				) : null}

				{section.warnings.map((warning) => (
					<p key={warning} className="text-[11px] text-muted">
						{warning}
					</p>
				))}

				{section.stale && section.flagged_count === 0 ? (
					<p className="border border-dashed border-line px-3 py-4 text-[11px] text-muted">
						No cached result for this query, so nothing has been checked against its
						rules yet. Refresh to run it.
					</p>
				) : section.flagged_count === 0 ? (
					<p className="border border-dashed border-line px-3 py-4 text-[11px] text-muted">
						{section.dismissed_count > 0
							? `All ${section.dismissed_count} flagged ${
								section.dismissed_count === 1 ? "row has" : "rows have"
							} been reviewed and dismissed.`
							: "Nothing matched on the last run."}
					</p>
				) : (
					<>
					<div className="overflow-auto" style={{ maxHeight: BODY_MAX_HEIGHT }}>
						<table className="w-full border-collapse text-[12px]">
							<caption className="sr-only">
								{section.flagged_count} flagged rows from {section.query_name}
							</caption>
							<thead className="sticky top-0 z-10 bg-sunken">
								<tr>
									<th
										scope="col"
										className="border-b border-line px-2.5 py-1.5 text-left text-[10px] font-medium tracking-wide text-muted uppercase"
									>
										Caught by
									</th>
									<th scope="col" className="border-b border-line px-2.5 py-1.5">
										<span className="sr-only">Dismiss</span>
									</th>
									{section.columns.map((column) => (
										<th
											key={column}
											scope="col"
											className="border-b border-line px-2.5 py-1.5 text-left text-[10px] font-medium tracking-wide whitespace-nowrap text-muted uppercase"
										>
											{column}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{shown.map((row) => {
									const hits = row.rule_ids
										.map((id) => ruleById.get(id))
										.filter((rule): rule is RuleHit => rule !== undefined);
									return (
										<tr
											key={row.fingerprint}
											className="transition-colors hover:bg-raised/50"
										>
											<td className="border-b border-line/60 px-2.5 py-1.5 align-top">
												<div className="flex flex-wrap items-center gap-1">
													{hits.map((rule) => (
														<span key={rule.id} className="flex items-center gap-1">
															<SeverityPill severity={rule.severity} />
															<span className="text-[11px] text-ink">{rule.name}</span>
														</span>
													))}
												</div>
											</td>
											<td className="border-b border-line/60 px-2.5 py-1.5 align-top">
												<Button
													type="button"
													disabled={busy}
													aria-label={`Dismiss flagged row ${row.index + 1}`}
													onClick={() =>
														run("dismiss this row", () =>
															dismissFlaggedRows(section.query_id, [row.fingerprint]),
														)
													}
												>
													Dismiss
												</Button>
											</td>
											{row.values.map((cell, cellIndex) => (
												<td
													key={cellIndex}
													className={`tnum border-b border-line/60 px-2.5 py-1.5 whitespace-nowrap ${
														cell === null ? "text-muted italic" : "text-ink"
													}`}
												>
													{formatCell(cell)}
												</td>
											))}
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>

					{/* Paged rather than endlessly scrolled: a queue is a work list,
							and a page is what someone can get through before losing their
							place. The body scrolls within its own height so one busy query
							cannot push every other section off the screen. */}
					<div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2 text-[11.5px] text-muted">
						<span>
							{ruleFilter ? "Matching this rule: " : ""}
							<span className="tnum text-ink">{formatInteger(filtered.length)}</span>{" "}
							{filtered.length === 1 ? "finding" : "findings"}
							{pageCount > 1 ? (
								<>
									{" · showing "}
									<span className="tnum text-ink">
										{safePage * PAGE_SIZE + 1}-
										{safePage * PAGE_SIZE + shown.length}
									</span>
								</>
							) : null}
						</span>

						{pageCount > 1 ? (
							<div className="ml-auto flex items-center gap-1.5">
								<Button
									type="button"
									disabled={safePage === 0}
									aria-label="Previous page of findings"
									onClick={() => setPage(safePage - 1)}
								>
									Previous
								</Button>
								<span className="tnum px-1">
									{safePage + 1} / {pageCount}
								</span>
								<Button
									type="button"
									disabled={safePage >= pageCount - 1}
									aria-label="Next page of findings"
									onClick={() => setPage(safePage + 1)}
								>
									Next
								</Button>
							</div>
						) : null}
					</div>
					</>
				)}
			</div>
		</Panel>
	);
}

export default function FlaggedPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = use(params);
	const { connections } = useConnections();
	const connectionName = connections.find((entry) => entry.id === id)?.name ?? "Connection";

	const load = useCallback(
		(signal: AbortSignal) => getConnectionFlagged(id, { signal }),
		[id],
	);
	const flagged = useResource(load);

	const [refreshing, setRefreshing] = useState(false);
	const [refreshError, setRefreshError] = useState<ApiError | null>(null);

	const refresh = async () => {
		setRefreshing(true);
		setRefreshError(null);
		try {
			await refreshConnectionFlagged(id);
			flagged.reload();
		} catch (cause) {
			setRefreshError(
				cause instanceof ApiError
					? cause
					: new ApiError({ kind: "network", message: "Refresh failed", url: "" }),
			);
		} finally {
			setRefreshing(false);
		}
	};

	const data = flagged.data;
	const sections = [...(data?.queries ?? [])].sort(bySeverityThenCount);

	return (
		<PageBody
			crumbs={[
				{ label: "Connections", href: "/" },
				{ label: connectionName, href: `/connections/${id}` },
				{ label: "Flagged" },
			]}
			actions={
				<Button type="button" onClick={refresh} disabled={refreshing || flagged.initial}>
					{refreshing ? "Refreshing…" : "Refresh"}
				</Button>
			}
		>
			{flagged.error ? (
				<ErrorState
					title="Could not load flagged rows"
					message={flagged.error.displayMessage}
					onRetry={flagged.reload}
				/>
			) : flagged.initial ? (
				<div className="skeleton-sweep h-40 border border-line bg-surface" />
			) : sections.length === 0 ? (
				<EmptyState
					title="No flag rules on this connection"
					body="A flag rule is a named set of conditions on a saved query. Rows that match are collected here. Until a query has rules, nothing on it is flagged: the dashboard never guesses which rows look anomalous."
					action={
						<LinkButton href={`/connections/${id}`} tone="primary">
							Pick a query to add rules to
						</LinkButton>
					}
				/>
			) : (
				<div className="space-y-3">
					{refreshError ? (
						<p className="border border-change/40 bg-change/5 px-3 py-2 text-[11px] text-change">
							{refreshError.displayMessage}
						</p>
					) : null}

					{data?.refresh_truncated ? (
						<p className="border border-line px-3 py-2 text-[11px] text-muted">
							Only the first queries on this connection were re-run. The engine caps
							one refresh so a single click cannot fire every saved query at your
							database at once.
						</p>
					) : null}

					<p className="text-[11px] text-muted">
						<span className="tnum text-ink">{formatInteger(data?.flagged_count ?? 0)}</span>{" "}
						flagged {data?.flagged_count === 1 ? "row" : "rows"} across{" "}
						{sections.length} {sections.length === 1 ? "query" : "queries"}
						{data?.dismissed_count
							? `, with ${data.dismissed_count} dismissed`
							: ""}
						.
					</p>

					{sections.map((section) => (
						<Section
							key={section.query_id}
							section={section}
							onChanged={flagged.reload}
						/>
					))}
				</div>
			)}
		</PageBody>
	);
}
