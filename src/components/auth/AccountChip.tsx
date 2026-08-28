"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROLE_LABELS } from "@/contracts/api";
import { useAuth } from "@/services/auth/AuthContext";

/** Two letters from the name, or one from the email if the name is a single word. */
export function initialsFor(fullName: string, email: string): string {
	const parts = fullName.trim().split(/\s+/).filter(Boolean);
	if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
	if (parts.length === 1 && parts[0].length > 0) return parts[0].slice(0, 2).toUpperCase();
	return (email.trim()[0] ?? "?").toUpperCase();
}

/**
 * Who is signed in, at the foot of the rail, with the way out.
 *
 * Permanent rather than behind an avatar menu in a top bar. Two people share a
 * screen in a fraud team more often than anyone plans for, and the role sits
 * next to the name for the same reason the connection dots sit in the rail: the
 * question "why can I not click that" is answered before it is asked.
 */
export function AccountChip({
	collapsed,
	onNavigate,
}: {
	collapsed: boolean;
	onNavigate?: () => void;
}) {
	const { user, signOut, busy } = useAuth();
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const wrapper = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		const onPointerDown = (event: PointerEvent) => {
			if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("pointerdown", onPointerDown);
		};
	}, [open]);

	if (!user) return null;

	const initials = initialsFor(user.full_name, user.email);
	const role = ROLE_LABELS[user.role];

	async function onSignOut() {
		setOpen(false);
		await signOut();
		router.replace("/login");
	}

	return (
		<div ref={wrapper} className="relative shrink-0 border-t border-line">
			<button
				type="button"
				onClick={() => setOpen((current) => !current)}
				aria-expanded={open}
				aria-haspopup="menu"
				title={collapsed ? `${user.full_name} · ${role}` : undefined}
				className={`flex w-full items-center gap-2.5 text-left transition-colors hover:bg-raised ${
					collapsed ? "justify-center px-1 py-2.5" : "px-3 py-2.5"
				}`}
			>
				<Avatar initials={initials} admin={user.role === "admin"} />
				{collapsed ? null : (
					<>
						<span className="min-w-0 flex-1">
							<span className="block truncate text-[12px] font-medium text-ink">
								{user.full_name}
							</span>
							<span className="block truncate text-[10px] text-muted">{role}</span>
						</span>
						<Chevron open={open} />
					</>
				)}
			</button>

			{open ? (
				<div
					role="menu"
					className="absolute bottom-full left-2 z-50 mb-1 w-[212px] overflow-hidden rounded-[var(--radius)] border border-line bg-raised py-1 shadow-lg"
				>
					<p className="truncate px-3 py-1.5 text-[11px] text-muted" title={user.email}>
						{user.email}
					</p>
					<div className="my-1 border-t border-line" />
					<MenuLink href="/account" onClick={() => setOpen(false)} onNavigate={onNavigate}>
						Account
					</MenuLink>
					<MenuLink
						href="/change-password"
						onClick={() => setOpen(false)}
						onNavigate={onNavigate}
					>
						Change password
					</MenuLink>
					<div className="my-1 border-t border-line" />
					<button
						type="button"
						role="menuitem"
						onClick={() => void onSignOut()}
						disabled={busy}
						className="block w-full px-3 py-1.5 text-left text-[12px] text-secondary transition-colors hover:bg-surface hover:text-ink disabled:opacity-40"
					>
						{busy ? "Signing out…" : "Sign out"}
					</button>
				</div>
			) : null}
		</div>
	);
}

function MenuLink({
	href,
	children,
	onClick,
	onNavigate,
}: {
	href: string;
	children: React.ReactNode;
	onClick: () => void;
	onNavigate?: () => void;
}) {
	return (
		<Link
			href={href}
			role="menuitem"
			onClick={() => {
				onClick();
				onNavigate?.();
			}}
			className="block px-3 py-1.5 text-[12px] text-secondary transition-colors hover:bg-surface hover:text-ink"
		>
			{children}
		</Link>
	);
}

/**
 * Initials on a disc, with a ring for an administrator.
 *
 * The ring is the accent, not a signal colour: "this account can change the
 * system" is a fact about chrome, and must not borrow the vocabulary that means
 * "this row is fraud".
 */
function Avatar({ initials, admin }: { initials: string; admin: boolean }) {
	return (
		<span
			aria-hidden="true"
			className={`tnum flex size-7 shrink-0 items-center justify-center rounded-full bg-surface text-[10px] font-medium text-secondary ${
				admin ? "ring-1 ring-accent/50" : "ring-1 ring-line"
			}`}
		>
			{initials}
		</span>
	);
}

function Chevron({ open }: { open: boolean }) {
	return (
		<svg
			width={10}
			height={10}
			viewBox="0 0 10 10"
			aria-hidden="true"
			className={`shrink-0 text-muted transition-transform duration-[var(--tween-fast)] ${
				open ? "rotate-180" : ""
			}`}
		>
			<path d="M2 6.5 L5 3.5 L8 6.5" fill="none" stroke="currentColor" strokeWidth={1.25} />
		</svg>
	);
}
