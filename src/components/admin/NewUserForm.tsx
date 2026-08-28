"use client";

import { useState } from "react";
import { Button, Field, Input, Panel, Select } from "@/components/ui";
import { ROLE_HINTS, ROLE_LABELS, USER_ROLES, type UserRead, type UserRole } from "@/contracts/api";
import { createUser } from "@/services/api-client";
import { authErrorMessage } from "@/services/auth/messages";

/**
 * Opening an account.
 *
 * There is no password field, and that is structural rather than an omission:
 * the engine's `UserCreate` schema has nowhere to put one, so the password is
 * always generated and always temporary. An admin who could choose it would be
 * an admin who knows a colleague's password, which is the thing the temporary
 * password plus the forced change exists to prevent.
 *
 * Inline rather than a modal. Creating people is the main verb of this screen,
 * often several in a row, and a dialog that has to be reopened per person turns
 * a five-minute onboarding into a click count.
 */
export function NewUserForm({
	onCreated,
	onCancel,
}: {
	onCreated: (user: UserRead, temporaryPassword: string) => void;
	onCancel: () => void;
}) {
	const [email, setEmail] = useState("");
	const [fullName, setFullName] = useState("");
	const [role, setRole] = useState<UserRole>("analyst");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const result = await createUser({
				email: email.trim(),
				full_name: fullName.trim(),
				role,
			});
			onCreated(result.user, result.temporary_password);
		} catch (cause) {
			setError(authErrorMessage(cause));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Panel title="Add a person">
			<form onSubmit={onSubmit} className="p-3.5" noValidate>
				<div className="grid gap-3.5 sm:grid-cols-3">
					<Field label="Full name" htmlFor="new-user-name">
						<Input
							id="new-user-name"
							value={fullName}
							onChange={(event) => setFullName(event.target.value)}
							required
							autoFocus
							maxLength={200}
							placeholder="Ada Lovelace"
							disabled={busy}
						/>
					</Field>

					<Field label="Email" htmlFor="new-user-email">
						<Input
							id="new-user-email"
							type="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							required
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							placeholder="ada@example.com"
							disabled={busy}
						/>
					</Field>

					<Field label="Role" htmlFor="new-user-role" hint={ROLE_HINTS[role]}>
						<Select
							id="new-user-role"
							value={role}
							onChange={(event) => setRole(event.target.value as UserRole)}
							disabled={busy}
						>
							{USER_ROLES.map((option) => (
								<option key={option} value={option}>
									{ROLE_LABELS[option]}
								</option>
							))}
						</Select>
					</Field>
				</div>

				{error ? (
					<p
						role="alert"
						className="mt-3.5 rounded-[var(--radius-sm)] border border-alert/30 bg-alert/10 px-3 py-2 text-[12px] text-ink"
					>
						{error}
					</p>
				) : null}

				<div className="mt-4 flex items-center gap-2">
					<p className="text-[11.5px] leading-relaxed text-muted">
						A temporary password is generated and shown once. They choose their own the
						first time they sign in.
					</p>
					<Button type="button" onClick={onCancel} disabled={busy} className="ml-auto shrink-0">
						Cancel
					</Button>
					<Button type="submit" tone="primary" disabled={busy} className="shrink-0">
						{busy ? "Creating…" : "Create account"}
					</Button>
				</div>
			</form>
		</Panel>
	);
}
