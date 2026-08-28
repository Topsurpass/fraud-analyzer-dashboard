import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/auth/AuthGate";

/**
 * `AuthGate` reads the query string to remember where an unauthenticated
 * visitor was headed, which needs a Suspense boundary Next can name rather than
 * one it infers.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
	return (
		<Suspense fallback={null}>
			<AuthGate>
				<AppShell>{children}</AppShell>
			</AuthGate>
		</Suspense>
	);
}
