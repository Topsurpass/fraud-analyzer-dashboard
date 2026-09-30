"use client";

import Link from "next/link";
import { useConnections } from "@/services/connections/ConnectionsContext";
import { useDashboards } from "@/services/dashboards";
import { PageBody } from "@/components/PageBody";
import { StatusDot } from "@/components/StatusDot";
import { EmptyState, ErrorState, LinkButton } from "@/components/ui";
import { FlaggedBadge } from "@/components/FlaggedBadge";
import { useFlagged } from "@/services/flagged/FlaggedContext";
import { formatDateTime, formatInteger, formatRelative } from "@/services/format";
import { useNow } from "@/lib/useNow";
import { useAuth } from "@/services/auth/AuthContext";
import { ownerLabel } from "@/services/dashboards";

/**
 * The front door: is the estate healthy, and is anything waiting for review?
 *
 * Four numbers answer that at a glance, the review queue sits beside the
 * connections it came from, and the boards are one click below. The stat
 * cards are about the estate (databases answering, findings waiting), not
 * about the data inside it - that is what the dashboards are for.
 */
export default function OverviewPage() {
	const { connections, initial, error, reload } = useConnections();
	const { dashboards, initial: dashboardsLoading } = useDashboards();
	const flagged = useFlagged();
	const now = useNow(5000);
	const { can, user } = useAuth();
	// Adding a connection is an administrator's act. Absent rather than
	// disabled, matching the sidebar: an analyst never gains this, so a
	// permanently dead primary button is only a reminder of something they
	// cannot do.
	const mayAddConnection = can("connections.create");

	const live = connections.filter((connection) => connection.status === "ok").length;
	const failed = connections.filter((connection) => connection.status === "failed").length;

	// Connections with findings waiting, worst first.
	const needsReview = connections
		.map((connection) => ({
			connection,
			count: flagged.countForConnection(connection.id),
			severity: flagged.severityForConnection(connection.id),
		}))
		.filter((entry) => entry.count > 0)
		.sort((a, b) => b.count - a.count);

	const firstName = user?.full_name.split(/\s+/)[0];

	return (
		<PageBody
			crumbs={[{ label: "Overview" }]}
			actions={
				mayAddConnection ? (
					<LinkButton href="/connections/new" tone="primary">
						<PlusGlyph /> New connection
					</LinkButton>
				) : null
			}
		>
			<div className="mb-7">
				<h1 className="t-display">{firstName ? `Welcome back, ${firstName}` : "Overview"}</h1>
				<p className="mt-1.5 text-[14px] text-muted">
					Here is what your fraud monitoring is doing right now.
				</p>
			</div>

			{error ? (
				<ErrorState
					title="Could not load connections"
					message={error.displayMessage}
					onRetry={reload}
				/>
			) : initial ? (
				<ul className="skeleton-sweep grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
					{[0, 1, 2, 3].map((index) => (
						<li key={index} className="h-32 rounded-[var(--radius-lg)] border border-line bg-surface" />
					))}
				</ul>
			) : connections.length === 0 ? (
				<EmptyState
					title="No connections yet"
					body={
						mayAddConnection
							? "A connection points the engine at a database. Saved queries and dashboards hang off it."
							: "A connection points the engine at a database. An administrator adds them; once one exists, your queries and dashboards hang off it."
					}
					action={
						mayAddConnection ? (
							<LinkButton href="/connections/new" tone="primary">
								Add the first connection
							</LinkButton>
						) : null
					}
				/>
			) : (
				<div className="flex flex-col gap-8">
					<dl className="grid grid-cols-2 gap-3 sm:gap-5 xl:grid-cols-4">
						<Stat
							label="Connections answering"
							value={`${live}/${connections.length}`}
							caption={live === connections.length ? "All databases reachable" : `${connections.length - live} not answering`}
							tone={live === connections.length ? "good" : "neutral"}
							glyph="db"
						/>
						<Stat
							label="Failing connections"
							value={String(failed)}
							caption={failed === 0 ? "Nothing failing" : "Last test did not pass"}
							tone={failed === 0 ? "neutral" : "warn"}
							glyph="alert"
						/>
						<Stat
							label="Flagged for review"
							value={formatInteger(flagged.total)}
							caption={
								flagged.total === 0
									? "Queue is clear"
									: `Across ${needsReview.length} ${needsReview.length === 1 ? "connection" : "connections"}`
							}
							tone={flagged.total === 0 ? "neutral" : "risk"}
							glyph="flag"
						/>
						<Stat
							label="Dashboards"
							value={dashboardsLoading ? "--" : String(dashboards.length)}
							caption="Live boards you can open"
							tone="neutral"
							glyph="grid"
						/>
					</dl>

					<div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
						<section>
							<SectionHead title="Connections" count={connections.length} />
							<ul className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">
								{connections.map((connection) => (
									<li key={connection.id}>
										<ConnectionCard connection={connection} now={now} />
									</li>
								))}
							</ul>
						</section>

						<section>
							<SectionHead title="Needs review" count={needsReview.length} />
							<NeedsReview entries={needsReview} />
						</section>
					</div>

					<section>
						<SectionHead
							title="Dashboards"
							count={dashboardsLoading ? null : dashboards.length}
							action={{ href: "/dashboards/new", label: "New dashboard" }}
						/>
						{dashboardsLoading ? (
							<ul className="skeleton-sweep grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
								{[0, 1].map((index) => (
									<li
										key={index}
										className="h-20 rounded-[var(--radius-lg)] border border-line bg-surface"
									/>
								))}
							</ul>
						) : dashboards.length === 0 ? (
							<p className="rounded-[var(--radius-lg)] border border-dashed border-line-strong px-5 py-6 text-[13px] text-muted">
								A dashboard groups saved queries from any connection onto one grid.{" "}
								<Link href="/dashboards/new" className="font-medium text-accent hover:underline">
									Build one
								</Link>
								.
							</p>
						) : (
							<ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
								{dashboards.map((dashboard) => {
									const count = dashboard.chart_ids.length;
									const owner = ownerLabel(dashboard, user?.id ?? null);
									return (
										<li key={dashboard.id}>
											<Link
												href={`/dashboards/${dashboard.id}`}
												className="group flex items-center gap-3.5 rounded-[var(--radius-lg)] border border-line bg-surface p-4 shadow-sm transition-all duration-[var(--tween-fast)] hover:-translate-y-px hover:border-line-strong hover:shadow"
											>
												<span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-accent-soft text-accent">
													<Glyph kind="grid" />
												</span>
												<span className="min-w-0 flex-1">
													<span className="block truncate text-[14px] font-semibold">
														{dashboard.name}
													</span>
													<span className="tnum block truncate text-[12.5px] text-muted">
														{count} {count === 1 ? "card" : "cards"}
														{owner ? ` · ${owner}` : ""}
													</span>
												</span>
												<span
													aria-hidden="true"
													className="text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
												>
													→
												</span>
											</Link>
										</li>
									);
								})}
							</ul>
						)}
					</section>
				</div>
			)}
		</PageBody>
	);
}

type StatTone = "good" | "warn" | "risk" | "neutral";

const STAT_TILE: Record<StatTone, string> = {
	good: "bg-live/12 text-live",
	warn: "bg-change/12 text-change",
	risk: "bg-alert/10 text-alert",
	neutral: "bg-accent-soft text-accent",
};

/** One headline number: an icon tile, the figure, and one line of context. */
function Stat({
	label,
	value,
	caption,
	tone,
	glyph,
}: {
	label: string;
	value: string;
	caption: string;
	tone: StatTone;
	glyph: GlyphKind;
}) {
	return (
		<div className="rise rounded-[var(--radius-lg)] border border-line bg-surface p-4 shadow-sm sm:p-5">
			<div className="flex items-center gap-3">
				<span className={`hidden size-10 shrink-0 place-items-center rounded-[var(--radius-sm)] sm:grid ${STAT_TILE[tone]}`}>
					<Glyph kind={glyph} />
				</span>
				<dt className="min-w-0 text-[13px] leading-snug font-medium text-muted">{label}</dt>
			</div>
			<dd className="mt-4">
				<span className="tnum-display block text-[28px] leading-none font-semibold sm:text-[34px]">{value}</span>
				<span className="mt-2 block text-[12.5px] text-muted">{caption}</span>
			</dd>
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
		<div className="mb-4 flex items-center gap-2.5">
			<h2 className="t-section text-[16px]">{title}</h2>
			{count !== null ? (
				<span className="tnum rounded-full bg-raised px-2 py-0.5 text-[12px] font-medium text-muted">
					{count}
				</span>
			) : null}
			{action ? (
				<Link
					href={action.href}
					className="ml-auto rounded-md px-2 py-1 text-[13px] font-medium text-accent transition-colors hover:bg-accent-soft"
				>
					+ {action.label}
				</Link>
			) : null}
		</div>
	);
}

const SEVERITY_WORD = { high: "High", medium: "Medium", low: "Low" } as const;

/** Severity as a word plus a tint: high reads as risk, medium as caution. */
const SEVERITY_CHIP = {
	high: "bg-alert/10 text-alert",
	medium: "bg-change/12 text-change",
	low: "bg-raised text-secondary",
} as const;

/**
 * The review queue by connection, biggest first. Each row is a link into that
 * connection's flagged view, because a count is only useful if the next step
 * is one click away.
 */
function NeedsReview({
	entries,
}: {
	entries: {
		connection: ReturnType<typeof useConnections>["connections"][number];
		count: number;
		severity: ReturnType<ReturnType<typeof useFlagged>["severityForConnection"]>;
	}[];
}) {
	if (entries.length === 0) {
		return (
			<div className="flex flex-col items-center rounded-[var(--radius-lg)] border border-line bg-surface px-6 py-10 text-center shadow-sm">
				<span className="grid size-11 place-items-center rounded-full bg-live/12 text-live">
					<svg width={20} height={20} viewBox="0 0 20 20" fill="none" aria-hidden="true">
						<path d="m5 10.5 3.2 3.2L15 6.8" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</span>
				<p className="t-section mt-3">Queue is clear</p>
				<p className="mt-1 text-[13px] text-muted">No rule has flagged anything waiting for review.</p>
			</div>
		);
	}

	const max = Math.max(...entries.map((entry) => entry.count));
	return (
		<ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-sm">
			{entries.map(({ connection, count, severity }) => (
				<li key={connection.id}>
					<Link
						href={`/connections/${connection.id}/flagged`}
						className="block px-5 py-4 transition-colors hover:bg-raised/60"
					>
						<span className="flex items-center gap-2">
							<span className="truncate text-[14px] font-semibold">{connection.name}</span>
							{severity ? (
								<span className={`rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold ${SEVERITY_CHIP[severity]}`}>
									{SEVERITY_WORD[severity]}
								</span>
							) : null}
							<span className="tnum ml-auto text-[14px] font-semibold text-alert">
								{formatInteger(count)}
							</span>
						</span>
						<span className="mt-3 block h-1 overflow-hidden rounded-full bg-raised" aria-hidden="true">
							<span
								className="block h-full rounded-full bg-alert"
								style={{ width: `${Math.max(6, (count / max) * 100)}%` }}
							/>
						</span>
					</Link>
				</li>
			))}
		</ul>
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
			className="group block h-full rounded-[var(--radius-lg)] border border-line bg-surface p-5 shadow-sm transition-all duration-[var(--tween-fast)] hover:-translate-y-px hover:border-line-strong hover:shadow"
		>
			<span className="flex items-center gap-2.5">
				<StatusDot status={connection.status} />
				<span className="t-card truncate text-[15px]">{connection.name}</span>
				{/* Findings waiting on this connection. The point of the card is
				    to be scannable, so this sits with the name rather than in the
				    detail line below it. */}
				<FlaggedBadge
					count={flagged.countForConnection(connection.id)}
					severity={flagged.severityForConnection(connection.id)}
				/>
				<span className="ml-auto shrink-0 rounded-md bg-raised px-2 py-0.5 text-[11.5px] font-medium text-muted">
					{connection.db_type}
				</span>
			</span>

			<span className="mono mt-3.5 block truncate text-[12.5px] text-secondary" title={target}>
				{target}
			</span>

			<span
				className="mt-1.5 block text-[12.5px] text-muted"
				title={formatDateTime(connection.last_tested_at)}
			>
				Tested {formatRelative(connection.last_tested_at, now)}
			</span>

			{connection.status === "failed" && connection.last_test_error ? (
				<span className="mt-3 block rounded-[var(--radius-sm)] bg-change/10 px-3 py-2 text-[12px] text-change">
					<span className="line-clamp-2">{connection.last_test_error}</span>
				</span>
			) : null}
		</Link>
	);
}

type GlyphKind = "db" | "alert" | "flag" | "grid";

function PlusGlyph() {
	return (
		<svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true">
			<path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
		</svg>
	);
}

function Glyph({ kind }: { kind: GlyphKind }) {
	return (
		<svg
			width={20}
			height={20}
			viewBox="0 0 20 20"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.6}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{kind === "db" ? (
				<>
					<ellipse cx={10} cy={5} rx={6} ry={2.5} />
					<path d="M4 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" />
				</>
			) : kind === "alert" ? (
				<>
					<path d="M10 3 2.5 16h15L10 3Z" />
					<path d="M10 8.5v3.2M10 14v.1" />
				</>
			) : kind === "flag" ? (
				<>
					<path d="M5 17V3.5M5 4h9l-1.8 3.2L14 10.5H5" />
				</>
			) : (
				<>
					<rect x={3} y={3} width={5.5} height={7} rx={1.5} />
					<rect x={11.5} y={3} width={5.5} height={4} rx={1.5} />
					<rect x={11.5} y={10} width={5.5} height={7} rx={1.5} />
					<rect x={3} y={13} width={5.5} height={4} rx={1.5} />
				</>
			)}
		</svg>
	);
}
