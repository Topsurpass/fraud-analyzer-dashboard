"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

/**
 * The one and only sighting of a generated password.
 *
 * A modal rather than an inline banner, and it does not close on a click
 * outside or on Escape. Both of those are normally the right behaviour and both
 * are wrong here: this string exists nowhere else - not in a later read of the
 * account, not in the audit entry - so a stray click that dismisses it costs
 * the admin a second reset and the user a second wait. Closing is deliberate,
 * through the one button that says what closing means.
 *
 * The copy button is not the only way out either. Clipboard writes fail (an
 * insecure origin, a browser that refuses without a user gesture it recognises,
 * a locked-down enterprise policy), so the password is on screen, selectable,
 * in a monospace face chosen so the admin can read it aloud if it comes to that.
 */
export function TemporaryPassword({
	password,
	forName,
	onDismiss,
}: {
	password: string;
	forName: string;
	onDismiss: () => void;
}) {
	const [copied, setCopied] = useState(false);
	const [copyFailed, setCopyFailed] = useState(false);
	const dismissRef = useRef<HTMLButtonElement | null>(null);

	// Focus lands on the dismiss button, so the keyboard path out of the dialog
	// is one Enter away and a screen reader announces the dialog on arrival.
	useEffect(() => dismissRef.current?.focus(), []);

	async function copy() {
		try {
			await navigator.clipboard.writeText(password);
			setCopied(true);
			setCopyFailed(false);
		} catch {
			setCopyFailed(true);
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-5 backdrop-blur-sm">
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="temp-password-title"
				className="w-full max-w-[420px] rounded-[var(--radius-lg)] border border-line bg-surface p-5 shadow-lg"
			>
				<h2 id="temp-password-title" className="t-section text-ink">
					Temporary password for {forName}
				</h2>
				<p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
					Copy this now. It is not stored anywhere and cannot be shown again - if you lose
					it, issue another reset.
				</p>

				<p
					className="mt-4 rounded-[var(--radius-sm)] border border-line bg-sunken px-3 py-2.5 font-mono text-[14px] break-all text-ink select-all"
					/* Selectable and announced as the value it is, so a screen
					   reader user can read it character by character. */
					aria-label={`Temporary password: ${password.split("").join(" ")}`}
				>
					{password}
				</p>

				<p className="mt-2.5 text-[11.5px] leading-relaxed text-muted">
					They will be asked to choose their own password the first time they sign in.
				</p>

				{copyFailed ? (
					<p role="alert" className="mt-2.5 text-[11.5px] text-change">
						This browser refused clipboard access. Select the password above and copy it
						by hand.
					</p>
				) : null}

				<div className="mt-5 flex items-center gap-2">
					<Button onClick={() => void copy()} tone="default">
						{copied ? "Copied" : "Copy password"}
					</Button>
					<Button ref={dismissRef} onClick={onDismiss} tone="primary" className="ml-auto">
						I have copied it
					</Button>
				</div>
			</div>
		</div>
	);
}
