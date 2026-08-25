"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useFlagged } from "@/services/flagged/FlaggedContext";
import { formatInteger, formatRelative } from "@/services/format";
import { useNow } from "@/lib/useNow";

/**
 * "Something has been flagged" without going to look.
 *
 * The engine runs queries on a schedule now, so findings appear while nobody is
 * watching. Before this the only way to learn about one was to open the flagged
 * view and check, which is the thing this replaces.
 *
 * Two states, deliberately distinct:
 *
 * - **A count** - there are findings waiting. Steady, no colour beyond the
 *   badge, because a queue that has been sitting there for a week is not news.
 * - **Unseen** - something arrived since the last time this browser
 *   acknowledged it. That is what actually earns attention, and it is decided
 *   by the newest finding's timestamp rather than by the count: dismiss two and
 *   gain two and the count has not moved while something new has still arrived.
 *
 * The acknowledgement lives in this browser, because "have *I* seen this" is a
 * per-reader question and the engine has no idea who is looking.
 */

const SEEN_KEY = "fae.flagged.seenAt";

function readSeen(): string | null {
	// Private windows, cleared site data and browsers that block storage all
	// throw here rather than returning null.
	try {
		return window.localStorage.getItem(SEEN_KEY);
	} catch {
		return null;
	}
}

function writeSeen(value: string): void {
	try {
		window.localStorage.setItem(SEEN_KEY, value);
	} catch {
		// Storage unavailable: the bell simply keeps reporting unseen, which is
		// the safe direction to fail in for something whose job is to nag.
	}
	for (const listener of listeners) listener();
}

/**
 * The acknowledgement as an external store.
 *
 * Reading localStorage during render would differ between the server pass and
 * the client one; reading it in an effect and calling setState is the same
 * thing with an extra render and a lint rule against it. useSyncExternalStore
 * exists for exactly this: a server snapshot of "nothing acknowledged" and a
 * client snapshot of whatever is stored.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function FlaggedBell() {
	const flagged = useFlagged();
	const now = useNow(30_000);

	const seenAt = useSyncExternalStore(subscribe, readSeen, () => null);
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const onDown = (event: MouseEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const { total, newestAt } = flagged;
	const unseen = newestAt !== null && (seenAt === null || newestAt > seenAt);

	const acknowledge = () => {
		if (newestAt) writeSeen(newestAt);
	};

	const label =
		total === 0
			? "Nothing flagged"
			: `${total} flagged ${total === 1 ? "row" : "rows"}${unseen ? ", new since you last looked" : ""}`;

	return (
		<div className="relative" ref={containerRef}>
			<button
				type="button"
				aria-label={label}
				title={label}
				aria-expanded={open}
				aria-haspopup="menu"
				onClick={() => {
					setOpen((value) => !value);
					// Opening it is the act of looking, so it stops being new.
					if (!open) acknowledge();
				}}
				className="relative flex items-center p-1 text-muted transition-colors hover:text-ink"
			>
				<BellGlyph ringing={unseen} />
				{total > 0 ? (
					<span
						className={`tnum absolute -top-0.5 -right-0.5 min-w-[14px] border px-[3px] text-center text-[9px] leading-[13px] ${
							unseen
								? "border-alert bg-alert font-semibold text-bg"
								: "border-line bg-surface text-muted"
						}`}
					>
						{total > 99 ? "99+" : formatInteger(total)}
					</span>
				) : null}
			</button>

			{open ? (
				<div
					role="menu"
					className="absolute top-full right-0 z-50 mt-1 w-64 border border-line bg-surface shadow-lg"
				>
					<p className="border-b border-line px-3 py-2 text-[11px] text-muted">
						{total === 0 ? (
							"Nothing is flagged right now."
						) : (
							<>
								<span className="tnum text-ink">{formatInteger(total)}</span> flagged{" "}
								{total === 1 ? "row" : "rows"} waiting
								{newestAt ? (
									<>
										{" · newest "}
										{formatRelative(newestAt, now)}
									</>
								) : null}
							</>
						)}
					</p>

					{flagged.connections.length > 0 ? (
						<ul>
							{flagged.connections.map((entry) => (
								<li key={entry.connection_id}>
									<Link
										href={`/connections/${entry.connection_id}/flagged`}
										onClick={() => setOpen(false)}
										className="flex items-center gap-2 px-3 py-2 text-[12px] transition-colors hover:bg-sunken"
									>
										<span className="truncate text-ink">
											{entry.connection_name}
										</span>
										<span className="tnum ml-auto shrink-0 text-[11px] text-muted">
											{formatInteger(entry.flagged_count)}
										</span>
									</Link>
								</li>
							))}
						</ul>
					) : null}
				</div>
			) : null}
		</div>
	);
}

/** A bell. Tilted when there is something unseen, so the state is not colour alone. */
function BellGlyph({ ringing }: { ringing: boolean }) {
	return (
		<svg
			width={15}
			height={15}
			viewBox="0 0 16 16"
			aria-hidden="true"
			className={`shrink-0 ${ringing ? "-rotate-12" : ""}`}
		>
			<path
				d="M8 2c-2.2 0-3.6 1.6-3.6 3.6 0 2.6-.7 3.4-1.2 3.9-.2.2-.1.6.2.6h9.2c.3 0 .4-.4.2-.6-.5-.5-1.2-1.3-1.2-3.9C11.6 3.6 10.2 2 8 2Z"
				fill="none"
				stroke="currentColor"
				strokeWidth={1.2}
				strokeLinejoin="round"
			/>
			<path d="M6.6 12a1.4 1.4 0 0 0 2.8 0" fill="none" stroke="currentColor" strokeWidth={1.2} />
		</svg>
	);
}
