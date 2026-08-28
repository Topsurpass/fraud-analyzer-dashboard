"use client";

import { PageBody } from "@/components/PageBody";
import { EmptyState, LinkButton } from "@/components/ui";
import { useAuth } from "@/services/auth/AuthContext";
import { ADMIN_ONLY_REASON, type Capability } from "@/services/auth/permissions";
import type { Crumb } from "@/components/TopBar";

/**
 * A page an analyst can reach by URL but must not use.
 *
 * The rail does not link to these, but a bookmark, a pasted link, or a role
 * changed under somebody with the tab still open all land here, and every one
 * of them deserves a sentence rather than a wall of failed requests. The engine
 * refuses the data regardless; this decides what the person reads while it does.
 *
 * Renders the full page chrome, not a bare message. Landing on a screen with no
 * breadcrumb and no way back reads as a crash - which is what "you are not
 * allowed here" should never be mistaken for.
 */
export function RequireCapability({
	capability,
	crumbs,
	children,
}: {
	capability: Capability;
	crumbs: Crumb[];
	children: React.ReactNode;
}) {
	const { can, status } = useAuth();

	// `AuthGate` above this only renders children once `status` is "signedIn",
	// so anything else here means the session ended mid-page.
	if (status !== "signedIn") return null;

	if (!can(capability)) {
		return (
			<PageBody crumbs={crumbs}>
				<EmptyState
					title="Not available on this account"
					body={`${ADMIN_ONLY_REASON} If you think that is wrong, ask an administrator to check your role.`}
					action={
						<LinkButton href="/" tone="default">
							Back to the overview
						</LinkButton>
					}
				/>
			</PageBody>
		);
	}

	return <>{children}</>;
}
