"use client";

import { useId, useState } from "react";
import { MIN_PASSWORD_LENGTH } from "@/contracts/api";
import { Field, Input } from "@/components/ui";

/**
 * A password input with a reveal toggle.
 *
 * The toggle is not a nicety here. Every password this app issues is a
 * system-generated 16-character string that gets copied out of a chat message
 * or read off a screen, and typing one blind is where the support conversation
 * starts. It is a `button`, so it is reachable by keyboard, and it says which
 * state it is in rather than only what it will do next.
 */
export function PasswordField({
	label,
	value,
	onChange,
	autoComplete,
	autoFocus,
	hint,
	error,
	disabled,
	id: providedId,
	name,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	autoComplete: "current-password" | "new-password";
	autoFocus?: boolean;
	hint?: React.ReactNode;
	error?: string | null;
	disabled?: boolean;
	id?: string;
	name?: string;
}) {
	const generatedId = useId();
	const id = providedId ?? generatedId;
	const [revealed, setRevealed] = useState(false);

	return (
		<Field label={label} htmlFor={id} hint={hint} error={error}>
			<div className="relative">
				<Input
					id={id}
					name={name}
					type={revealed ? "text" : "password"}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					autoComplete={autoComplete}
					autoFocus={autoFocus}
					disabled={disabled}
					/* Every password here is generated or chosen by the person
					   typing it. Neither wants a phone keyboard's help. */
					autoCapitalize="off"
					autoCorrect="off"
					spellCheck={false}
					minLength={autoComplete === "new-password" ? MIN_PASSWORD_LENGTH : undefined}
					className={`pr-14 ${revealed ? "font-mono tracking-tight" : ""}`}
				/>
				<button
					type="button"
					onClick={() => setRevealed((current) => !current)}
					disabled={disabled}
					aria-pressed={revealed}
					aria-label={revealed ? "Hide password" : "Show password"}
					className="absolute inset-y-0 right-0 px-2.5 text-[10.5px] tracking-wider text-muted uppercase transition-colors hover:text-ink disabled:opacity-40"
				>
					{revealed ? "Hide" : "Show"}
				</button>
			</div>
		</Field>
	);
}

/**
 * How a proposed new password measures against the engine's rules.
 *
 * Deliberately advisory, and it says so: the engine holds the real blocklist
 * and can still answer `WEAK_PASSWORD` to something this passes. What it buys
 * is the length check, which is the rule people actually hit, answered without
 * a round trip and without wiping the field.
 */
export function passwordProblem(password: string): string | null {
	if (password.length === 0) return null;
	if (password.length < MIN_PASSWORD_LENGTH) {
		const missing = MIN_PASSWORD_LENGTH - password.length;
		return `${missing} more character${missing === 1 ? "" : "s"} needed.`;
	}
	return null;
}

/**
 * The length meter under a new-password field.
 *
 * A bar rather than a "weak/strong" word, because the engine's rule is length
 * plus a blocklist and nothing else - no composition scoring - so a word like
 * "medium" would be inventing a judgement the system does not make.
 */
export function PasswordMeter({ password }: { password: string }) {
	const ratio = Math.min(1, password.length / MIN_PASSWORD_LENGTH);
	const met = password.length >= MIN_PASSWORD_LENGTH;

	return (
		<div className="mt-1.5">
			<div
				className="h-[3px] overflow-hidden rounded-full bg-line"
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={MIN_PASSWORD_LENGTH}
				aria-valuenow={Math.min(password.length, MIN_PASSWORD_LENGTH)}
				aria-label="Password length"
			>
				<div
					className={`h-full rounded-full transition-[width,background-color] duration-[var(--tween-fast)] ${
						met ? "bg-live" : "bg-change"
					}`}
					style={{ width: `${ratio * 100}%` }}
				/>
			</div>
		</div>
	);
}
