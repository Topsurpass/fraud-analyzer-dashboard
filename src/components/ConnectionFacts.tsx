"use client";

import type { ConnectionRead } from "@/contracts/api";
import { Panel } from "@/components/ui";
import { StatusDot } from "@/components/StatusDot";
import { formatDateTime } from "@/services/format";

/**
 * What a connection is, without the means to change it.
 *
 * What an analyst sees where an administrator sees the credentials form. Not a
 * disabled copy of that form: a greyed-out password box that can never be
 * filled in is a worse answer than simply showing the facts that matter when
 * you are writing SQL against this database - which host it is, which database,
 * and whether it last answered.
 *
 * The username is here and the password is not, and neither is a decision this
 * component makes: the engine never returns a stored password to any caller,
 * at any role.
 */
export function ConnectionFacts({
	connection,
	loading,
}: {
	connection: ConnectionRead | null;
	loading: boolean;
}) {
	if (loading || !connection) {
		return (
			<Panel title="Connection">
				<div className="skeleton-sweep space-y-3 p-3">
					{[0, 1, 2, 3].map((row) => (
						<div key={row} className="h-6 bg-line" />
					))}
				</div>
			</Panel>
		);
	}

	const facts: Array<[string, string]> = [
		["Type", connection.db_type],
		...(connection.db_type === "sqlite"
			? ([["File", connection.sqlite_path ?? "-"]] as Array<[string, string]>)
			: ([
					["Host", connection.host ?? "-"],
					["Port", connection.port === null ? "-" : String(connection.port)],
					["Database", connection.database ?? "-"],
					["Username", connection.username ?? "-"],
					["TLS", connection.ssl_mode],
				] as Array<[string, string]>)),
		["Last tested", formatDateTime(connection.last_tested_at)],
	];

	return (
		<Panel title="Connection">
			<div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
				<StatusDot status={connection.status} />
				<span className="text-[12.5px] text-secondary">
					{connection.paused
						? "Paused by an administrator"
						: connection.status === "ok"
							? "Answering"
							: connection.status === "failed"
								? "Last test failed"
								: "Not tested yet"}
				</span>
			</div>

			<dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-3.5 sm:grid-cols-3">
				{facts.map(([term, value]) => (
					<div key={term} className="min-w-0">
						<dt className="t-eyebrow">{term}</dt>
						<dd className="tnum mt-0.5 truncate text-[12.5px] text-secondary" title={value}>
							{value}
						</dd>
					</div>
				))}
			</dl>

			<p className="border-t border-line px-3.5 py-2.5 text-[11.5px] leading-relaxed text-muted">
				Credentials and deletion are managed by an administrator. The schema below is what
				you write queries against.
			</p>
		</Panel>
	);
}
