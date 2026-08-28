"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard, AuthError } from "@/components/auth/AuthCard";
import { PasswordField } from "@/components/auth/PasswordField";
import { Button, Field, Input } from "@/components/ui";
import { useAuth } from "@/services/auth/AuthContext";
import { authErrorMessage, shouldClearPassword } from "@/services/auth/messages";
import { safeNextPath } from "@/services/auth/redirect";

export default function LoginPage() {
	// `useSearchParams` opts the tree into client-side rendering, and Next
	// requires the boundary to be explicit rather than inferred.
	return (
		<Suspense fallback={<AuthCard title="Sign in">{null}</AuthCard>}>
			<LoginForm />
		</Suspense>
	);
}

function LoginForm() {
	const router = useRouter();
	const params = useSearchParams();
	const { signIn, busy, status } = useAuth();

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);

	const next = safeNextPath(params.get("next"));

	/*
	 * Somebody who is already signed in has no business on this screen - they
	 * reach it by using a bookmark, or by hitting back after signing in. Sending
	 * them on is done in an effect rather than during render because it is a
	 * navigation, and `mustChangePassword` deliberately does not redirect here:
	 * the gate below decides where that state goes.
	 */
	useEffect(() => {
		if (status === "signedIn") router.replace(next);
		else if (status === "mustChangePassword") router.replace("/change-password");
	}, [status, router, next]);

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		try {
			const user = await signIn(email.trim(), password);
			router.replace(user.must_change_password ? "/change-password" : next);
		} catch (cause) {
			setError(authErrorMessage(cause));
			if (shouldClearPassword(cause)) setPassword("");
		}
	}

	return (
		<AuthCard
			title="Sign in"
			lede="Use the account your administrator opened for you."
			footer="Locked out, or never given a password? An administrator can reset it."
		>
			<form onSubmit={onSubmit} className="space-y-4" noValidate>
				<Field label="Email" htmlFor="login-email">
					<Input
						id="login-email"
						name="email"
						type="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						autoComplete="username"
						autoFocus
						autoCapitalize="off"
						autoCorrect="off"
						spellCheck={false}
						required
						disabled={busy}
						placeholder="you@example.com"
					/>
				</Field>

				<PasswordField
					id="login-password"
					name="password"
					label="Password"
					value={password}
					onChange={setPassword}
					autoComplete="current-password"
					disabled={busy}
				/>

				<AuthError message={error} />

				<Button
					type="submit"
					tone="primary"
					/* Not disabled on empty fields. A disabled submit gives no
					   reason, where submitting an empty form gets the browser's
					   own "fill this in" on the field that is missing. */
					disabled={busy}
					className="w-full py-2 text-[12.5px]"
				>
					{busy ? "Signing in…" : "Sign in"}
				</Button>
			</form>
		</AuthCard>
	);
}
