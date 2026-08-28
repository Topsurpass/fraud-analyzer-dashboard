"use client";

import { useCallback, useMemo, useState } from "react";
import { PageBody } from "@/components/PageBody";
import { RequireCapability } from "@/components/auth/RequireCapability";
import { RecordTable, ResultCount, type RecordColumn } from "@/components/admin/RecordTable";
import { describeAuditEntry, matchesAuditQuery } from "@/components/admin/auditNarrative";
import { Button, EmptyState, ErrorState, Input, Panel, Select } from "@/components/ui";
import {
	AUDIT_ACTIONS,
	AUDIT_ACTION_LABELS,
	type AuditAction,
	type AuditEntryRead,
} from "@/contracts/api";
import { listAuditLog } from "@/services/api-client";
import { authErrorMessage } from "@/services/auth/messages";
import { useResource } from "@/lib/useResource";
import { useNow } from "@/lib/useNow";
import { formatDateTime, formatRelative } from "@/services/format";

const CRUMBS = [{ label: "Administration" }, { label: "Audit log" }];

export default function AuditLogPage() {
	return (
		<RequireCapability capability="auditLog.view" crumbs={CRUMBS}>
			<AuditLogScreen />
		</RequireCapability>
	);
}

function AuditLogScreen() {
	const load = useCallback((signal: AbortSignal) => listAuditLog({ signal }), []);
	const { data, error, initial, loading, reload } = useResource(load);
	const now = useNow(30_000);

	const [text, setText] = useState("");
	const [action, setAction] = useState<AuditAction | "all">("all");

	const entries = useMemo(() => data ?? [], [data]);
	const shown = useMemo(
		() =>
			entries.filter(
				(entry) =>
					(action === "all" || entry.action === action) && matchesAuditQuery(entry, text),
			),
		[entries, action, text],
	);

	const columns = useMemo<RecordColumn<AuditEntryRead>[]>(
		() => [
			{
				key: "when",
				header: "When",
				width: "150px",
				cell: (entry) => (
					<span className="tnum text-[11.5px] text-secondary" title={formatDateTime(entry.created_at)}>
						{formatRelative(entry.created_at, now)}
					</span>
				),
			},
			{
				key: "actor",
				header: "Who",
				width: "minmax(0,1fr)",
				cell: (entry) => (
					<span className="truncate text-secondary" title={entry.actor_email}>
						{entry.actor_email}
					</span>
				),
			},
			{
				key: "what",
				header: "What happened",
				/* Wide, and the only place the subject appears. A separate
				   "Account" column repeated the email this sentence already
				   names, which in a table this dense is noise rather than
				   redundancy worth having. Searching still matches on it - see
				   `matchesAuditQuery`. */
				width: "minmax(0,3fr)",
				cell: (entry) => (
					<span className="truncate text-ink" title={describeAuditEntry(entry)}>
						{describeAuditEntry(entry)}
					</span>
				),
			},
		],
		[now],
	);

	return (
		<PageBody
			crumbs={CRUMBS}
			actions={
				<Button onClick={reload} disabled={loading}>
					{loading ? "Refreshing…" : "Refresh"}
				</Button>
			}
		>
			<div className="mx-auto flex flex-col gap-4">
				<p className="text-[12.5px] leading-relaxed text-muted">
					Every administrative change, newest first. Append-only: entries are never edited
					or removed, and credentials never appear in one.
				</p>

				{/* `initial` is false the moment the first load settles, failure
				    included, so it cannot stand in for "nothing to show yet".
				    What decides is whether there is data on screen: a failed
				    reload keeps the table and reports itself inline, a failed
				    first load has nothing to keep. */}
				{error && data === null ? (
					<ErrorState
						title="Could not load the audit log"
						message={authErrorMessage(error)}
						onRetry={reload}
					/>
				) : (
					<Panel
						title="Audit log"
						actions={
							<>
								<Input
									type="search"
									value={text}
									onChange={(event) => setText(event.target.value)}
									placeholder="Search people or actions"
									aria-label="Search the audit log"
									className="w-[210px]"
								/>
								<Select
									value={action}
									onChange={(event) => setAction(event.target.value as AuditAction | "all")}
									aria-label="Filter by action"
									className="w-[170px]"
								>
									<option value="all">Every action</option>
									{AUDIT_ACTIONS.map((option) => (
										<option key={option} value={option}>
											{AUDIT_ACTION_LABELS[option]}
										</option>
									))}
								</Select>
							</>
						}
					>
						{initial ? (
							<div className="skeleton-sweep space-y-2 p-4">
								{[0, 1, 2, 3, 4].map((row) => (
									<div key={row} className="h-6 bg-line" />
								))}
							</div>
						) : (
							/* The one table in this app whose row count only ever goes up,
							   so it is capped in height and windowed rather than laid out
							   in full - see RecordTable. */
							<div className="flex max-h-[62vh] flex-col overflow-hidden">
								<RecordTable
									rows={shown}
									columns={columns}
									rowKey={(entry) => entry.id}
									caption="Administrative changes, newest first"
									empty={
										entries.length === 0 ? (
											<EmptyState
												title="Nothing recorded yet"
												body="Opening an account, changing a role or resetting a password writes an entry here."
											/>
										) : (
											<EmptyState
												title="No entries match"
												body="Try a different search, or set the action filter back to every action."
												action={
													<Button
														onClick={() => {
															setText("");
															setAction("all");
														}}
													>
														Clear filters
													</Button>
												}
											/>
										)
									}
								/>
							</div>
						)}

						<div className="border-t border-line px-3.5 py-2">
							<ResultCount shown={shown.length} total={entries.length} noun="entry" plural="entries" />
						</div>
					</Panel>
				)}
			</div>
		</PageBody>
	);
}
