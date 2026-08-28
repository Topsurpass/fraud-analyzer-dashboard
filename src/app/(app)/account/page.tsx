"use client";

import { useRouter } from "next/navigation";
import { PageBody } from "@/components/PageBody";
import { Button, LinkButton, Panel } from "@/components/ui";
import { initialsFor } from "@/components/auth/AccountChip";
import { ROLE_HINTS, ROLE_LABELS } from "@/contracts/api";
import { useAuth } from "@/services/auth/AuthContext";
import { useNow } from "@/lib/useNow";
import { formatDateTime, formatRelative } from "@/services/format";
import { ROLE_CAPABILITIES } from "@/services/auth/permissions";

const CRUMBS = [{ label: "Account" }];

/**
 * Your own account.
 *
 * The reason this exists beyond "change your password" is the capability list
 * at the bottom. "This needs an administrator account" is a message people meet
 * at the moment they are blocked, when they are trying to do something else;
 * this is the one screen where the answer to "what does my role actually let me
 * do" is written down in full, before it is needed.
 */
export default function AccountPage() {
	const { user, signOut, busy } = useAuth();
	const router = useRouter();
	const now = useNow(30_000);

	if (!user) return null;

	const capabilities = ROLE_CAPABILITIES[user.role];

	return (
		<PageBody crumbs={CRUMBS}>
			<div className="mx-auto flex  flex-col gap-4">
				<Panel>
					<div className="flex flex-wrap items-center gap-4 p-4">
						<span
							aria-hidden="true"
							className={`tnum flex size-12 shrink-0 items-center justify-center rounded-full bg-sunken text-[15px] font-medium text-secondary ${
								user.role === "admin" ? "ring-1 ring-accent/50" : "ring-1 ring-line"
							}`}
						>
							{initialsFor(user.full_name, user.email)}
						</span>

						<div className="min-w-0">
							<h1 className="t-page truncate text-ink">{user.full_name}</h1>
							<p className="truncate text-[12.5px] text-muted">{user.email}</p>
						</div>

						<div className="ml-auto flex shrink-0 items-center gap-2">
							<LinkButton href="/change-password">Change password</LinkButton>
							<Button
								tone="danger"
								disabled={busy}
								onClick={() => void signOut().then(() => router.replace("/login"))}
							>
								{busy ? "Signing out…" : "Sign out"}
							</Button>
						</div>
					</div>

					<dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line px-4 py-3.5 sm:grid-cols-3">
						<Detail term="Role" value={ROLE_LABELS[user.role]} />
						<Detail
							term="Last signed in"
							value={formatRelative(user.last_login_at, now)}
							title={user.last_login_at ? formatDateTime(user.last_login_at) : "Never"}
						/>
						<Detail
							term="Account opened"
							value={formatDateTime(user.created_at)}
							title={user.created_at}
						/>
					</dl>
				</Panel>

				<Panel title={`What ${ROLE_LABELS[user.role]} can do`}>
					<p className="border-b border-line px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted">
						{ROLE_HINTS[user.role]}
					</p>
					<ul className="divide-y divide-line/60">
						{capabilities.map((capability) => (
							<li
								key={capability}
								className="flex items-center gap-2.5 px-3.5 py-2 text-[12.5px] text-secondary"
							>
								<Tick />
								{CAPABILITY_SENTENCES[capability]}
							</li>
						))}
					</ul>
					{user.role === "analyst" ? (
						<p className="border-t border-line px-3.5 py-2.5 text-[11.5px] leading-relaxed text-muted">
							Adding, editing or pausing a connection, and managing accounts, need an
							administrator. Your saved queries and dashboards are yours: an
							administrator can see them, another analyst cannot.
						</p>
					) : null}
				</Panel>
			</div>
		</PageBody>
	);
}

/**
 * One sentence per capability, in the second person.
 *
 * Keyed off the same union the permission table uses, so a capability added
 * there without a sentence here is a type error rather than a blank row.
 */
const CAPABILITY_SENTENCES: Record<(typeof ROLE_CAPABILITIES)["admin"][number], string> = {
	"connections.view": "See every database connection",
	"connections.create": "Add a new database connection",
	"connections.edit": "Change a connection's settings and credentials",
	"connections.delete": "Delete a connection and everything saved against it",
	"connections.test": "Test whether a connection still answers",
	"connections.pause": "Pause and resume a connection",
	"queries.write": "Write, save and delete queries",
	"queries.run": "Run queries and poll them live",
	"flagRules.write": "Write flag rules and work the flagged queue",
	"dashboards.write": "Build dashboards out of saved queries",
	"users.manage": "Open, deactivate and re-role accounts",
	"auditLog.view": "Read the audit log",
};

function Detail({ term, value, title }: { term: string; value: string; title?: string }) {
	return (
		<div className="min-w-0">
			<dt className="t-eyebrow">{term}</dt>
			<dd className="tnum mt-0.5 truncate text-[12.5px] text-secondary" title={title}>
				{value}
			</dd>
		</div>
	);
}

function Tick() {
	return (
		<svg viewBox="0 0 12 12" width={11} height={11} aria-hidden="true" className="shrink-0 text-live">
			<path d="M2.5 6.5 L5 9 L9.5 3.5" fill="none" stroke="currentColor" strokeWidth={1.4} />
		</svg>
	);
}
