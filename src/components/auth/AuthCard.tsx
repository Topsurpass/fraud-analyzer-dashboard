"use client";

import type { ReactNode } from "react";

/**
 * The frame every signed-out screen sits in.
 *
 * A single centred column rather than the marketing split screen: there is
 * nothing to market to on this app's login page - everyone reaching it already
 * works here - and a hero panel would push the one control that matters off
 * centre on a laptop.
 *
 * The wordmark is set the same way as in the rail, so the screen a person sees
 * before signing in and the one they see after are recognisably the same
 * product.
 */
export function AuthCard({
	title,
	lede,
	children,
	footer,
}: {
	title: string;
	lede?: ReactNode;
	children: ReactNode;
	footer?: ReactNode;
}) {
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
			<div className="w-full max-w-[380px]">
				<div className="mb-7 text-center">
					<span className="display block text-[19px] leading-[1.1] font-medium tracking-tight">
						FRAUD ANALYZER
					</span>
					<span className="tnum mt-1.5 block text-[9px] tracking-[0.18em] text-muted/70 uppercase">
						instrument panel
					</span>
				</div>

				<section className="rounded-[var(--radius-lg)] border border-line bg-surface px-6 py-6 shadow-lg">
					<h1 className="t-section text-ink">{title}</h1>
					{lede ? (
						<p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{lede}</p>
					) : null}
					<div className="mt-5">{children}</div>
				</section>

				{footer ? (
					<div className="mt-4 text-center text-[11.5px] leading-relaxed text-muted">
						{footer}
					</div>
				) : null}
			</div>
		</main>
	);
}

/**
 * The failure line on an auth form.
 *
 * Its own component because it must be announced: a sign-in failure moves no
 * focus and changes nothing else on screen, so a screen-reader user who does
 * not get a live region simply hears nothing happen. `assertive` rather than
 * `polite` - this is the answer to the action they just took, not background
 * news.
 */
export function AuthError({ message }: { message: string | null }) {
	return (
		<div role="alert" aria-live="assertive" className="empty:hidden">
			{message ? (
				<p className="rounded-[var(--radius-sm)] border border-alert/30 bg-alert/10 px-3 py-2 text-[12px] leading-relaxed text-ink">
					{message}
				</p>
			) : null}
		</div>
	);
}
