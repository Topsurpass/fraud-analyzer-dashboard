"use client";

import { useCallback, useMemo, useState } from "react";
import { PageBody } from "@/components/PageBody";
import { RequireCapability } from "@/components/auth/RequireCapability";
import { RecordTable, ResultCount, type RecordColumn } from "@/components/admin/RecordTable";
import { TemporaryPassword } from "@/components/admin/TemporaryPassword";
import { NewUserForm } from "@/components/admin/NewUserForm";
import {
	EMPTY_USER_QUERY,
	activeAdminCount,
	filterUsers,
	isLastActiveAdmin,
	type UserQuery,
} from "@/components/admin/UserFilters";
import { Button, EmptyState, ErrorState, Input, Panel, Select } from "@/components/ui";
import { ROLE_LABELS, USER_ROLES, type UserRead, type UserRole } from "@/contracts/api";
import { listUsers, resetUserPassword, updateUser } from "@/services/api-client";
import { useAuth } from "@/services/auth/AuthContext";
import { authErrorMessage } from "@/services/auth/messages";
import { useResource } from "@/lib/useResource";
import { useNow } from "@/lib/useNow";
import { formatRelative } from "@/services/format";

const CRUMBS = [{ label: "Administration" }, { label: "People" }];

export default function AdminUsersPage() {
	return (
		<RequireCapability capability="users.manage" crumbs={CRUMBS}>
			<UsersScreen />
		</RequireCapability>
	);
}

/** What the temporary-password dialog is currently showing, if anything. */
interface Issued {
	password: string;
	forName: string;
}

function UsersScreen() {
	const { user: me, refresh: refreshMe } = useAuth();
	const load = useCallback((signal: AbortSignal) => listUsers({ signal }), []);
	const { data, error, initial, loading, reload } = useResource(load);
	const now = useNow(30_000);

	const [query, setQuery] = useState<UserQuery>(EMPTY_USER_QUERY);
	const [adding, setAdding] = useState(false);
	const [issued, setIssued] = useState<Issued | null>(null);
	/** The row a mutation is in flight on, so only its own controls go quiet. */
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	const users = useMemo(() => data ?? [], [data]);
	const shown = useMemo(() => filterUsers(users, query), [users, query]);
	const admins = activeAdminCount(users);

	const mutate = useCallback(
		async (user: UserRead, run: () => Promise<unknown>) => {
			setPendingId(user.id);
			setActionError(null);
			try {
				await run();
				reload();
				// An admin who just changed their own role or state has to see the
				// interface follow: the rail's admin section and every guard on
				// this page read from the session, not from this list.
				if (me && user.id === me.id) await refreshMe();
			} catch (cause) {
				setActionError(authErrorMessage(cause));
			} finally {
				setPendingId(null);
			}
		},
		[reload, me, refreshMe],
	);

	const columns = useMemo<RecordColumn<UserRead>[]>(
		() => [
			{
				key: "person",
				header: "Person",
				width: "minmax(0,2.2fr)",
				cell: (user) => (
					<div className="min-w-0">
						<span className="flex items-center gap-1.5">
							<span className="truncate font-medium text-ink">{user.full_name}</span>
							{me?.id === user.id ? (
								<span className="shrink-0 rounded-full border border-line px-1.5 text-[9.5px] tracking-wide text-muted uppercase">
									you
								</span>
							) : null}
						</span>
						<span className="block truncate text-[11px] text-muted">{user.email}</span>
					</div>
				),
			},
			{
				key: "role",
				header: "Role",
				width: "132px",
				cell: (user) => (
					<RolePicker
						user={user}
						disabled={pendingId === user.id}
						/* The engine refuses to demote the last administrator. Saying
						   so on the control beats saying it in a 409 afterwards. */
						lockedReason={
							isLastActiveAdmin(user, users)
								? "The only active administrator. Promote somebody else first."
								: null
						}
						onChange={(role) => void mutate(user, () => updateUser(user.id, { role }))}
					/>
				),
			},
			{
				key: "status",
				header: "Status",
				width: "116px",
				cell: (user) => <StatusCell user={user} />,
			},
			{
				key: "last",
				header: "Last signed in",
				width: "120px",
				numeric: true,
				secondary: true,
				cell: (user) => (
					<span title={user.last_login_at ?? "Never signed in"}>
						{formatRelative(user.last_login_at, now)}
					</span>
				),
			},
			{
				key: "actions",
				header: "",
				width: "196px",
				cell: (user) => (
					<div className="flex items-center justify-end gap-1.5">
						<Button
							tone="ghost"
							disabled={pendingId === user.id}
							title="Issue a new temporary password and sign this account out everywhere"
							onClick={() =>
								void mutate(user, async () => {
									const { temporary_password } = await resetUserPassword(user.id);
									setIssued({ password: temporary_password, forName: user.full_name });
								})
							}
						>
							Reset password
						</Button>
						<ActivationButton
							user={user}
							users={users}
							disabled={pendingId === user.id}
							onToggle={() =>
								void mutate(user, () =>
									updateUser(user.id, { is_active: !user.is_active }),
								)
							}
						/>
					</div>
				),
			},
		],
		[me, now, pendingId, users, mutate],
	);

	return (
		<PageBody
			crumbs={CRUMBS}
			actions={
				<Button tone="primary" onClick={() => setAdding((open) => !open)} aria-expanded={adding}>
					{adding ? "Cancel" : "Add person"}
				</Button>
			}
		>
			<div className="mx-auto flex flex-col gap-4">
				{adding ? (
					<NewUserForm
						onCancel={() => setAdding(false)}
						onCreated={(user, password) => {
							setAdding(false);
							setIssued({ password, forName: user.full_name });
							reload();
						}}
					/>
				) : null}

				{/* `initial` is false the moment the first load settles, failure
				    included, so it cannot stand in for "nothing to show yet".
				    What decides is whether there is data on screen: a failed
				    reload keeps the table and reports itself inline, a failed
				    first load has nothing to keep. */}
				{error && data === null ? (
					<ErrorState
						title="Could not load the account list"
						message={authErrorMessage(error)}
						onRetry={reload}
					/>
				) : (
					<Panel
						title="People"
						actions={
							<>
								<Input
									type="search"
									value={query.text}
									onChange={(event) =>
										setQuery((current) => ({ ...current, text: event.target.value }))
									}
									placeholder="Search name or email"
									aria-label="Search people"
									className="w-[190px]"
								/>
								<Select
									value={query.role}
									onChange={(event) =>
										setQuery((current) => ({
											...current,
											role: event.target.value as UserQuery["role"],
										}))
									}
									aria-label="Filter by role"
									className="w-[130px]"
								>
									<option value="all">Every role</option>
									{USER_ROLES.map((role) => (
										<option key={role} value={role}>
											{ROLE_LABELS[role]}
										</option>
									))}
								</Select>
								<Select
									value={query.status}
									onChange={(event) =>
										setQuery((current) => ({
											...current,
											status: event.target.value as UserQuery["status"],
										}))
									}
									aria-label="Filter by status"
									className="w-[120px]"
								>
									<option value="all">Any status</option>
									<option value="active">Active</option>
									<option value="inactive">Deactivated</option>
								</Select>
							</>
						}
					>
						{actionError ? (
							<p
								role="alert"
								className="border-b border-line bg-alert/10 px-3.5 py-2 text-[12px] text-ink"
							>
								{actionError}
							</p>
						) : null}

						{initial ? (
							<div className="skeleton-sweep space-y-2 p-4">
								{[0, 1, 2, 3].map((row) => (
									<div key={row} className="h-6 bg-line" />
								))}
							</div>
						) : (
							<RecordTable
								rows={shown}
								columns={columns}
								rowKey={(user) => user.id}
								caption="People with access to this installation"
								rowClassName={(user) => (user.is_active ? "" : "opacity-55")}
								empty={
									users.length === 0 ? (
										<EmptyState
											title="No accounts yet"
											body="Add the first person and hand them the temporary password it issues."
										/>
									) : (
										<EmptyState
											title="Nobody matches that"
											body="Try a different name, or clear the role and status filters."
											action={<Button onClick={() => setQuery(EMPTY_USER_QUERY)}>Clear filters</Button>}
										/>
									)
								}
							/>
						)}

						<div className="flex items-center gap-3 border-t border-line px-3.5 py-2">
							<ResultCount shown={shown.length} total={users.length} noun="account" plural="accounts" />
							<span className="tnum ml-auto text-[11px] text-muted">
								{admins} active {admins === 1 ? "administrator" : "administrators"}
								{loading && !initial ? " · refreshing" : ""}
							</span>
						</div>
					</Panel>
				)}
			</div>

			{issued ? (
				<TemporaryPassword
					password={issued.password}
					forName={issued.forName}
					onDismiss={() => setIssued(null)}
				/>
			) : null}
		</PageBody>
	);
}

function RolePicker({
	user,
	disabled,
	lockedReason,
	onChange,
}: {
	user: UserRead;
	disabled: boolean;
	lockedReason: string | null;
	onChange: (role: UserRole) => void;
}) {
	return (
		<Select
			value={user.role}
			disabled={disabled || lockedReason !== null}
			title={lockedReason ?? undefined}
			aria-label={`Role for ${user.full_name}`}
			onChange={(event) => onChange(event.target.value as UserRole)}
			className="py-1 text-[11.5px]"
		>
			{USER_ROLES.map((role) => (
				<option key={role} value={role}>
					{ROLE_LABELS[role]}
				</option>
			))}
		</Select>
	);
}

/**
 * Active or not, as a word plus a dot.
 *
 * A dot alone would put the whole meaning in colour, which is exactly the
 * failure mode the flagged-row work in this app already ruled out.
 */
function StatusCell({ user }: { user: UserRead }) {
	if (!user.is_active) {
		return (
			<span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted">
				<Dot className="bg-muted" />
				Deactivated
			</span>
		);
	}
	if (user.must_change_password) {
		return (
			<span
				className="inline-flex items-center gap-1.5 text-[11.5px] text-change"
				title="Has a temporary password and has not chosen their own yet"
			>
				<Dot className="bg-change" />
				Pending
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1.5 text-[11.5px] text-secondary">
			<Dot className="bg-live" />
			Active
		</span>
	);
}

function Dot({ className }: { className: string }) {
	return <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${className}`} />;
}

function ActivationButton({
	user,
	users,
	disabled,
	onToggle,
}: {
	user: UserRead;
	users: readonly UserRead[];
	disabled: boolean;
	onToggle: () => void;
}) {
	const locked = user.is_active && isLastActiveAdmin(user, users);

	return (
		<Button
			/* Not `danger`. Deactivating is reversible - "Reactivate" is the same
			   button - and a column of alarm-coloured controls in a dense table
			   out-shouts the data it sits beside, which is the exact thing the
			   signal palette is reserved against. The word carries the meaning. */
			tone="default"
			disabled={disabled || locked}
			title={
				locked
					? "The only active administrator. Promote somebody else first."
					: user.is_active
						? "Ends every session on this account and refuses new sign-ins"
						: "Lets this person sign in again"
			}
			onClick={onToggle}
		>
			{user.is_active ? "Deactivate" : "Reactivate"}
		</Button>
	);
}
