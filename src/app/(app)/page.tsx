"use client";

import Link from "next/link";
import { useConnections } from "@/services/connections/ConnectionsContext";
import { useDashboards } from "@/services/dashboards";
import { PageBody } from "@/components/PageBody";
import { StatusDot } from "@/components/StatusDot";
import { EmptyState, ErrorState, LinkButton } from "@/components/ui";
import { FlaggedBadge } from "@/components/FlaggedBadge";
import { useFlagged } from "@/services/flagged/FlaggedContext";
import { formatDateTime, formatRelative } from "@/services/format";
import { useNow } from "@/lib/useNow";

/**
 * The front door.
 *
 * It answers one question before anything else: is the panel wired up? A status
 * line across the top says how many databases are answering and how many boards
 * are built, then the connections themselves, then the boards. Deliberately not
 * a wall of headline metrics - the numbers that matter here are small integers
 * about the rig, not KPIs, and blowing them up would be borrowing a dashboard
 * convention this app spent the rest of its design avoiding.
 */
export default function OverviewPage() {
	const { connections, initial, error, reload } = useConnections();
	const { dashboards, initial: dashboardsLoading } = useDashboards();
	const now = useNow(5000);

	const live = connections.filter((connection) => connection.status === "ok").length;
	const failed = connections.filter((connection) => connection.status === "failed").length;

	return (
		<PageBody
			crumbs={[{ label: "Connections" }]}
			actions={
				<LinkButton href="/connections/new" tone="primary">
					New connection
				</LinkButton>
			}
		>
			{error ? (
				<ErrorState
					title="Could not load connections"
					message={error.displayMessage}
					onRetry={reload}
				/>
			) : initial ? (
				<ul className="skeleton-sweep grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{[0, 1, 2].map((index) => (
						<li key={index} className="h-28 border border-line bg-surface" />
					))}
				</ul>
			) : connections.length === 0 ? (
				<EmptyState
					title="No connections yet"
					body="A connection points the engine at a database. Saved queries and dashboards hang off it."
					action={
						<LinkButton href="/connections/new" tone="primary">
							Add the first connection
						</LinkButton>
					}
				/>
			) : (
				<div className="flex flex-col gap-5">
					<StatusLine
						live={live}
						failed={failed}
						total={connections.length}
						boards={dashboardsLoading ? null : dashboards.length}
					/>

					<section>
						<SectionHead title="Connections" count={connections.length} />
						<ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
							{connections.map((connection) => (
								<li key={connection.id}>
									<ConnectionCard connection={connection} now={now} />
								</li>
							))}
						</ul>
					</section>

					<section>
						<SectionHead
							title="Dashboards"
							count={dashboardsLoading ? null : dashboards.length}
							action={{ href: "/dashboards/new", label: "New dashboard" }}
						/>
						{dashboardsLoading ? (
							<ul className="skeleton-sweep grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
								{[0, 1].map((index) => (
									<li
										key={index}
										className="h-16 border border-line bg-surface"
									/>
								))}
							</ul>
						) : dashboards.length === 0 ? (
							<p className="border border-dashed border-line px-3 py-4 text-[12px] text-muted">
								A dashboard groups saved queries from any connection onto one grid.{" "}
								<Link href="/dashboards/new" className="text-live hover:underline">
									Build one
								</Link>
								.
							</p>
						) : (
							<ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
								{dashboards.map((dashboard) => (
									<li key={dashboard.id}>
										<Link
											href={`/dashboards/${dashboard.id}`}
											className="flex items-center gap-2 border border-line bg-surface px-3 py-2.5 transition-colors hover:border-line-strong"
										>
											<span className="truncate text-[13px]">
												{dashboard.name}
											</span>
											<span className="tnum ml-auto shrink-0 text-[10px] text-muted">
												{dashboard.query_ids.length}{" "}
												{dashboard.query_ids.length === 1
													? "card"
													: "cards"}
											</span>
										</Link>
									</li>
								))}
							</ul>
						)}
					</section>
				</div>
			)}
		</PageBody>
	);
}

/**
 * The rig's status line: monospace readings separated by hairlines, the way a
 * hardware front panel reports itself. It is one row tall on purpose - this is
 * the state of the instrument, not the subject of the page.
 */
function StatusLine({
	live,
	failed,
	total,
	boards,
}: {
	live: number;
	failed: number;
	total: number;
	boards: number | null;
}) {
	return (
		<dl className="flex flex-wrap items-stretch gap-x-6 gap-y-2 border-y border-line py-2.5">
			<Reading
				label="Answering"
				value={`${live}/${total}`}
				tone={live === total ? "live" : "muted"}
			/>
			{failed > 0 ? <Reading label="Failing" value={String(failed)} tone="change" /> : null}
			<Reading label="Dashboards" value={boards === null ? "--" : String(boards)} />
		</dl>
	);
}

function Reading({
	label,
	value,
	tone = "muted",
}: {
	label: string;
	value: string;
	tone?: "live" | "change" | "muted";
}) {
	const color = tone === "live" ? "text-live" : tone === "change" ? "text-change" : "text-ink";
	return (
		<div className="flex items-baseline gap-2">
			<dt className="t-eyebrow">{label}</dt>
			<dd className={`tnum text-[13px] ${color}`}>{value}</dd>
		</div>
	);
}

function SectionHead({
	title,
	count,
	action,
}: {
	title: string;
	count: number | null;
	action?: { href: string; label: string };
}) {
	return (
		<div className="mb-2 flex items-center gap-2">
			<h2 className="t-eyebrow">{title}</h2>
			{count !== null ? (
				<span className="tnum text-[10px] text-muted/60">{count}</span>
			) : null}
			{action ? (
				<Link
					href={action.href}
					className="ml-auto text-[11px] text-muted transition-colors hover:text-live"
				>
					+ {action.label}
				</Link>
			) : null}
		</div>
	);
}

function ConnectionCard({
	connection,
	now,
}: {
	connection: ReturnType<typeof useConnections>["connections"][number];
	now: number;
}) {
	const flagged = useFlagged();
	const target =
		connection.db_type === "sqlite"
			? (connection.sqlite_path ?? "--")
			: `${connection.host ?? "--"}:${connection.port ?? "--"}/${connection.database ?? "--"}`;

	return (
		<Link
			href={`/connections/${connection.id}`}
			className="group block h-full overflow-hidden rounded-[var(--radius)] border border-line bg-surface shadow-sm transition-all duration-[var(--tween-fast)] hover:-translate-y-px hover:border-line-strong hover:shadow"
		>
			{/* The status hairline repeats the dot as an edge, so a failing
          connection is visible before any of its text is read. */}
			<span
				aria-hidden="true"
				className="block h-px w-full"
				style={{
					background:
						connection.status === "ok"
							? "var(--signal-live)"
							: connection.status === "failed"
								? "var(--signal-change)"
								: "var(--border)",
				}}
			/>
			<span className="block p-3.5">
				<span className="flex items-center gap-2">
					<StatusDot status={connection.status} />
					<span className="t-card truncate">{connection.name}</span>
					{/* Findings waiting on this connection. The point of the card is
						    to be scannable, so this sits with the name rather than in the
						    detail line below it. */}
					<FlaggedBadge
						count={flagged.countForConnection(connection.id)}
						severity={flagged.severityForConnection(connection.id)}
					/>
					<span className="tnum ml-auto shrink-0 text-[9px] tracking-wider text-muted uppercase">
						{connection.db_type}
					</span>
				</span>

				<span className="tnum mt-2.5 block truncate text-[11.5px] text-muted" title={target}>
					{target}
				</span>

				<span
					className="tnum mt-1 block text-[10px] text-muted/70"
					title={formatDateTime(connection.last_tested_at)}
				>
					tested {formatRelative(connection.last_tested_at, now)}
				</span>

				{connection.status === "failed" && connection.last_test_error ? (
					<span className="mt-2 block border-l-2 border-change pl-2 text-[10px] text-change">
						<span className="line-clamp-2">{connection.last_test_error}</span>
					</span>
				) : null}
			</span>
		</Link>
	);
}
