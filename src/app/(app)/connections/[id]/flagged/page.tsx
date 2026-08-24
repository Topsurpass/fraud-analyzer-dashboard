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

import { use, useCallback, useState } from "react";
import {
	ApiError,
	getConnectionFlagged,
	refreshConnectionFlagged,
} from "@/services/api-client";
import type { FlaggedQuery, FlagSeverity, RuleHit } from "@/contracts/api";
import { useConnections } from "@/services/connections/ConnectionsContext";
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

function RuleLegend({ rules }: { rules: RuleHit[] }) {
	if (rules.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-2">
			{[...rules]
				.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
				.map((rule) => (
					<span key={rule.id} className="flex items-center gap-1 text-[11px]">
						<SeverityPill severity={rule.severity} />
						<span className="text-ink">{rule.name}</span>
						<span className="tnum text-muted">{formatInteger(rule.matched)}</span>
					</span>
				))}
		</div>
	);
}

function Section({ section }: { section: FlaggedQuery }) {
	const ruleById = new Map(section.rules.map((rule) => [rule.id, rule]));

	return (
		<Panel
			title={section.query_name}
			actions={
				<LinkButton href={`/queries/${section.query_id}`}>Edit rules</LinkButton>
			}
		>
			<div className="space-y-2 p-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<RuleLegend rules={section.rules} />
					<span className="text-[10px] text-muted">
						{section.executed_at
							? `as of ${new Date(section.executed_at).toLocaleString()}`
							: "not run yet"}
					</span>
				</div>

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
						Nothing matched on the last run.
					</p>
				) : (
					<div className="overflow-auto">
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
								{section.rows.map((row) => {
									const hits = row.rule_ids
										.map((id) => ruleById.get(id))
										.filter((rule): rule is RuleHit => rule !== undefined);
									return (
										<tr key={row.index}>
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
					body="A flag rule is a named set of conditions on a saved query. Rows that match are collected here. Without rules the dashboard falls back to guessing which rows look anomalous."
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
						{sections.length} {sections.length === 1 ? "query" : "queries"}.
					</p>

					{sections.map((section) => (
						<Section key={section.query_id} section={section} />
					))}
				</div>
			)}
		</PageBody>
	);
}
