"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/services/auth/AuthContext";

/**
 * Nothing inside the app renders until we know who is looking at it.
 *
 * This is a convenience, not a control. Every rule it enforces is enforced
 * again by the engine on every request, which is where it counts - a guard that
 * lives only in the browser is a suggestion. What it buys is that a signed-out
 * person sees a login form instead of a rail full of "Engine unreachable", and
 * that an account still holding a temporary password is sent to the one screen
 * that can clear it rather than to a dashboard where every panel 403s.
 *
 * It deliberately renders nothing during `loading` rather than rendering the
 * shell with empty data. The shell's providers fetch on mount; mounting them
 * before the token is known means firing three requests that are about to be
 * either unnecessary or unauthorised.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
	const { status } = useAuth();
	const router = useRouter();
	const pathname = usePathname();
	const search = useSearchParams();

	useEffect(() => {
		if (status === "signedOut") {
			// Carry where they were headed, so signing in resumes it rather than
			// dropping them on the home page. The query string goes too: a
			// deep link into a filtered flagged view is exactly the kind of URL
			// somebody pastes to a colleague who is not signed in yet.
			const query = search.toString();
			const next = query ? `${pathname}?${query}` : pathname;
			router.replace(`/login?next=${encodeURIComponent(next)}`);
		} else if (status === "mustChangePassword") {
			router.replace("/change-password");
		}
	}, [status, router, pathname, search]);

	if (status !== "signedIn") return <AuthGatePlaceholder />;
	return <>{children}</>;
}

/**
 * The half-second before the app appears.
 *
 * A rail-shaped skeleton rather than a spinner: this is a full-height layout
 * about to arrive, and a centred spinner would be replaced by something a
 * completely different shape, which reads as two page loads instead of one.
 */
function AuthGatePlaceholder() {
	return (
		<div className="flex h-dvh min-h-0 w-full" aria-busy="true" aria-live="polite">
			<span className="sr-only">Loading</span>
			<div className="skeleton-sweep hidden w-[var(--rail-width)] shrink-0 border-r border-line bg-sunken md:block" />
			<div className="skeleton-sweep min-w-0 flex-1 bg-bg" />
		</div>
	);
}
