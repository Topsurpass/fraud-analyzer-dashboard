"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCard, AuthError } from "@/components/auth/AuthCard";
import {
	PasswordField,
	PasswordMeter,
	passwordProblem,
} from "@/components/auth/PasswordField";
import { Button } from "@/components/ui";
import { MIN_PASSWORD_LENGTH } from "@/contracts/api";
import { useAuth } from "@/services/auth/AuthContext";
import { authErrorMessage } from "@/services/auth/messages";

/**
 * The forced password change.
 *
 * Outside the app shell on purpose. An account in this state is refused every
 * endpoint but `/auth/me` and `/auth/change-password`, so rendering the rail
 * around it would mean three 403s behind a screen whose whole job is to be the
 * one thing that works.
 *
 * Reachable voluntarily too, from the account page: the form is the same, only
 * the framing changes.
 */
export default function ChangePasswordPage() {
	const router = useRouter();
	const { status, user, busy, changeOwnPassword, signOut } = useAuth();

	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState<string | null>(null);

	const forced = status === "mustChangePassword";

	useEffect(() => {
		if (status === "signedOut") router.replace("/login");
	}, [status, router]);

	const lengthProblem = passwordProblem(next);
	const mismatch = confirm.length > 0 && confirm !== next;
	const reusingCurrent = next.length > 0 && next === current;

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		setError(null);

		if (next !== confirm) {
			setError("The two new passwords do not match.");
			return;
		}
		if (lengthProblem) {
			setError(`Your new password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
			return;
		}

		try {
			await changeOwnPassword(current, next);
			// `changeOwnPassword` re-reads `/auth/me`, so by here the gate has
			// already lifted. Replace rather than push: the back button must not
			// return to a form whose "current password" is now wrong.
			router.replace("/");
		} catch (cause) {
			setError(authErrorMessage(cause));
		}
	}

	return (
		<AuthCard
			title={forced ? "Choose a new password" : "Change your password"}
			lede={
				forced
					? "This account is using a temporary password. Pick your own to continue."
					: user
						? `Signed in as ${user.email}.`
						: undefined
			}
			footer={
				forced ? (
					<button
						type="button"
						onClick={() => void signOut().then(() => router.replace("/login"))}
						className="underline underline-offset-2 transition-colors hover:text-ink"
					>
						Sign out instead
					</button>
				) : null
			}
		>
			<form onSubmit={onSubmit} className="space-y-4" noValidate>
				<PasswordField
					id="current-password"
					label={forced ? "Temporary password" : "Current password"}
					value={current}
					onChange={setCurrent}
					autoComplete="current-password"
					autoFocus
					disabled={busy}
					hint={forced ? "The one your administrator gave you." : undefined}
				/>

				<div>
					<PasswordField
						id="new-password"
						label="New password"
						value={next}
						onChange={setNext}
						autoComplete="new-password"
						disabled={busy}
						error={reusingCurrent ? "Pick something different from the current one." : null}
						hint={
							lengthProblem ??
							`At least ${MIN_PASSWORD_LENGTH} characters. Length is what counts here, not symbols.`
						}
					/>
					<PasswordMeter password={next} />
				</div>

				<PasswordField
					id="confirm-password"
					label="Confirm new password"
					value={confirm}
					onChange={setConfirm}
					autoComplete="new-password"
					disabled={busy}
					error={mismatch ? "These do not match." : null}
				/>

				<AuthError message={error} />

				<Button
					type="submit"
					tone="primary"
					disabled={busy || Boolean(lengthProblem) || mismatch || reusingCurrent}
					className="w-full py-2 text-[12.5px]"
				>
					{busy ? "Saving…" : "Save new password"}
				</Button>

				<p className="text-[11.5px] leading-relaxed text-muted">
					Every other session on this account is signed out. This one stays.
				</p>
			</form>
		</AuthCard>
	);
}
