"use client";

import type { ReactNode } from "react";
import { LogoMark, Wordmark } from "@/components/Logo";

/**
 * The frame every signed-out screen sits in: a brand panel beside the form on
 * a wide screen, the form alone on a phone.
 *
 * The panel says what the product is for, in three short claims, and shows
 * a stylised signal trace rather than data: this screen is public, so nothing
 * on it may come from a real system.
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
		<main className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
			<BrandPanel />

			<div className="flex flex-col items-center justify-center px-5 py-10 sm:px-10">
				<div className="w-full max-w-[400px]">
					<div className="mb-8 lg:hidden">
						<Wordmark />
					</div>

					<h1 className="text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
					{lede ? (
						<p className="mt-2 text-[14px] leading-relaxed text-muted">{lede}</p>
					) : null}

					<section className="mt-7 rounded-[var(--radius-lg)] border border-line bg-surface p-6 shadow-[var(--shadow)]">
						{children}
					</section>

					{footer ? (
						<div className="mt-5 text-center text-[13px] leading-relaxed text-muted">
							{footer}
						</div>
					) : null}
				</div>
			</div>
		</main>
	);
}

const CLAIMS = [
	["Live monitoring", "Every saved query polls on its own schedule and tells you when the data moves."],
	["Rules you control", "Flag rows with your own conditions and review them in one queue."],
	["Every database", "Postgres, MySQL and SQLite behind one read-only engine."],
] as const;

function BrandPanel() {
	return (
		<aside
			aria-hidden="true"
			className="relative hidden overflow-hidden bg-[#0b0d1f] p-12 text-white lg:flex lg:flex-col"
		>
			{/* Two soft colour pools behind everything. */}
			<div
				className="absolute inset-0"
				style={{
					background:
						"radial-gradient(700px 500px at 15% 0%, rgb(99 102 241 / 0.55), transparent 65%), radial-gradient(600px 500px at 100% 100%, rgb(14 165 233 / 0.28), transparent 60%)",
				}}
			/>
			<div
				className="absolute inset-0 opacity-[0.12]"
				style={{
					backgroundImage:
						"linear-gradient(rgb(255 255 255 / 0.5) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.5) 1px, transparent 1px)",
					backgroundSize: "44px 44px",
					maskImage: "radial-gradient(ellipse at 30% 30%, black, transparent 70%)",
				}}
			/>

			<div className="relative flex items-center gap-3">
				<LogoMark size={36} />
				<span className="text-[17px] font-semibold tracking-tight">Fraud Analyzer</span>
			</div>

			<div className="relative mt-auto max-w-[480px]">
				<svg
					viewBox="0 0 480 120"
					className="mb-10 w-full"
					fill="none"
					style={{ maskImage: "linear-gradient(90deg, black 80%, transparent)" }}
				>
					<defs>
						<linearGradient id="auth-trace" x1="0" y1="0" x2="1" y2="0">
							<stop stopColor="#818cf8" stopOpacity="0" />
							<stop offset="0.35" stopColor="#818cf8" />
							<stop offset="1" stopColor="#38bdf8" />
						</linearGradient>
						<linearGradient id="auth-area" x1="0" y1="0" x2="0" y2="1">
							<stop stopColor="#818cf8" stopOpacity="0.35" />
							<stop offset="1" stopColor="#818cf8" stopOpacity="0" />
						</linearGradient>
					</defs>
					<path
						d="M0 86 C40 84 60 70 90 72 S140 92 170 78 S220 40 250 50 S300 82 330 64 S380 14 420 26 S460 40 480 30 V120 H0 Z"
						fill="url(#auth-area)"
					/>
					<path
						d="M0 86 C40 84 60 70 90 72 S140 92 170 78 S220 40 250 50 S300 82 330 64 S380 14 420 26 S460 40 480 30"
						stroke="url(#auth-trace)"
						strokeWidth="3"
						strokeLinecap="round"
					/>
					<circle cx="420" cy="26" r="9" fill="#f43f5e" opacity="0.25" />
					<circle cx="420" cy="26" r="5" fill="#0b0d1f" stroke="#fb7185" strokeWidth="2.5" />
				</svg>

				<h2 className="max-w-[420px] text-[34px] leading-[1.12] font-semibold tracking-tight text-balance">
					Catch fraud while it is still happening.
				</h2>
				<ul className="mt-9 space-y-5">
					{CLAIMS.map(([claim, detail]) => (
						<li key={claim} className="flex gap-3.5">
							<span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-white/12 text-[#a5b4fc]">
								<svg width={12} height={12} viewBox="0 0 12 12" fill="none">
									<path d="m2.5 6.3 2.3 2.3 4.7-5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
								</svg>
							</span>
							<span>
								<span className="block text-[15px] font-semibold">{claim}</span>
								<span className="mt-0.5 block text-[13.5px] leading-relaxed text-white/60">{detail}</span>
							</span>
						</li>
					))}
				</ul>
			</div>
		</aside>
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
				<p className="rounded-[var(--radius-sm)] border border-alert/25 bg-alert/8 px-3 py-2.5 text-[13px] leading-relaxed text-ink">
					{message}
				</p>
			) : null}
		</div>
	);
}
