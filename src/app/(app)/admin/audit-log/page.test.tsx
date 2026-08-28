import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntryRead, UserRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import AuditLogPage from "./page";

const listAuditLog = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
	const actual =
		await vi.importActual<typeof import("@/services/api-client")>("@/services/api-client");
	return { ...actual, listAuditLog };
});

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
	usePathname: () => "/admin/audit-log",
}));

vi.mock("@/components/PageBody", () => ({
	PageBody: ({ actions, children }: { actions?: React.ReactNode; children: React.ReactNode }) => (
		<div>
			<div>{actions}</div>
			{children}
		</div>
	),
}));

const signedInAs = vi.hoisted(() => ({ current: null as UserRead | null }));

vi.mock("@/services/auth/AuthContext", async () => {
	const permissions =
		await vi.importActual<typeof import("@/services/auth/permissions")>(
			"@/services/auth/permissions",
		);
	return {
		useAuth: () => ({
			status: "signedIn",
			user: signedInAs.current,
			busy: false,
			refresh: vi.fn(),
			can: (capability: Parameters<typeof permissions.can>[1]) =>
				permissions.can(signedInAs.current, capability),
			signIn: vi.fn(),
			signOut: vi.fn(),
			changeOwnPassword: vi.fn(),
		}),
	};
});

function account(over: Partial<UserRead> = {}): UserRead {
	return {
		id: "u2",
		email: "grace@navy.example",
		full_name: "Grace Hopper",
		role: "admin",
		is_active: true,
		must_change_password: false,
		last_login_at: null,
		created_at: "2026-08-01T00:00:00Z",
		...over,
	};
}

function entry(over: Partial<AuditEntryRead> = {}): AuditEntryRead {
	return {
		id: "a1",
		actor_id: "u2",
		actor_email: "grace@navy.example",
		action: "user_created",
		target_type: "user",
		target_id: "u1",
		detail: { email: "ada@example.com", role: "analyst" },
		created_at: "2026-08-27T09:00:00Z",
		...over,
	};
}

beforeEach(() => {
	signedInAs.current = account();
	listAuditLog.mockReset().mockResolvedValue([entry()]);
});

describe("who may read the audit log", () => {
	it("refuses an analyst and does not fetch it", async () => {
		signedInAs.current = account({ role: "analyst" });
		render(<AuditLogPage />);

		expect(await screen.findByText(/Not available on this account/i)).toBeInTheDocument();
		expect(listAuditLog).not.toHaveBeenCalled();
	});

	it("lets an administrator read it", async () => {
		render(<AuditLogPage />);
		expect(await screen.findByText(/Opened ada@example.com's account as Analyst/)).toBeInTheDocument();
	});
});

describe("reading an entry", () => {
	it("puts the actor and the sentence in separate columns", async () => {
		render(<AuditLogPage />);
		await screen.findByText(/Opened ada@example.com/);
		// The actor has its own column, so the sentence must not repeat it.
		expect(screen.getByTitle("grace@navy.example")).toBeInTheDocument();
		expect(screen.getByText(/Opened ada@example.com's account as Analyst/)).toBeInTheDocument();
	});

	it("filters by action", async () => {
		listAuditLog.mockResolvedValue([
			entry(),
			entry({ id: "a2", action: "user_password_reset", detail: { email: "ada@example.com" } }),
		]);
		render(<AuditLogPage />);
		await screen.findByText(/Opened ada@example.com/);

		await userEvent.selectOptions(screen.getByLabelText("Filter by action"), "user_password_reset");

		await waitFor(() => expect(screen.queryByText(/Opened ada/)).not.toBeInTheDocument());
		expect(screen.getByText(/new temporary password/)).toBeInTheDocument();
		expect(screen.getByText("1 of 2 entries match this filter")).toBeInTheDocument();
	});

	it("searches actor and subject together", async () => {
		listAuditLog.mockResolvedValue([
			entry(),
			entry({
				id: "a2",
				actor_email: "alan@example.com",
				detail: { email: "bob@example.com", role: "analyst" },
			}),
		]);
		render(<AuditLogPage />);
		await screen.findByText(/Opened ada@example.com/);

		await userEvent.type(screen.getByLabelText("Search the audit log"), "alan");

		await waitFor(() => expect(screen.queryByText(/Opened ada@/)).not.toBeInTheDocument());
		expect(screen.getByText(/Opened bob@example.com/)).toBeInTheDocument();
	});

	it("says one entry, not one entries", async () => {
		render(<AuditLogPage />);
		expect(await screen.findByText("1 entry")).toBeInTheDocument();
	});

	it("surfaces a failure with a retry", async () => {
		listAuditLog.mockRejectedValue(new ApiError({ kind: "network", message: "offline", url: "" }));
		render(<AuditLogPage />);

		expect(await screen.findByText(/Could not load the audit log/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
	});

	it("explains an empty log rather than showing a blank panel", async () => {
		listAuditLog.mockResolvedValue([]);
		render(<AuditLogPage />);
		expect(await screen.findByText(/Nothing recorded yet/i)).toBeInTheDocument();
	});
});

describe("at scale", () => {
	/**
	 * The audit log is append-only and nothing prunes it, so it is the one table
	 * in this app whose row count only goes up. An unwindowed render puts a row
	 * per entry in the DOM, and the cost lands on the main thread every time a
	 * filter changes.
	 *
	 * jsdom reports every element as zero-height, so the window this resolves to
	 * is the overscan rather than a screenful. That is fine for what is being
	 * asserted: the count must be bounded and far below the row total, not equal
	 * to any particular number.
	 */
	function many(count: number): AuditEntryRead[] {
		return Array.from({ length: count }, (_, index) =>
			entry({
				id: `a${index}`,
				actor_email: `admin${index % 7}@example.com`,
				detail: { email: `person${index}@example.com`, role: "analyst" },
			}),
		);
	}

	it("renders a bounded window of a 10,000-entry log", async () => {
		listAuditLog.mockResolvedValue(many(10_000));
		render(<AuditLogPage />);

		await screen.findByText("10000 entries");
		const rendered = document.querySelectorAll('[role="row"]').length;
		expect(rendered).toBeGreaterThan(0);
		expect(rendered).toBeLessThan(100);
	});

	it("reports the true total, not the number it drew", async () => {
		// A count that reflected the window would tell an admin the log is 24
		// entries long, which is worse than showing no count at all.
		listAuditLog.mockResolvedValue(many(25_000));
		render(<AuditLogPage />);

		expect(await screen.findByText("25000 entries")).toBeInTheDocument();
	});

	it("keeps the window bounded after a filter narrows it", async () => {
		listAuditLog.mockResolvedValue(many(10_000));
		render(<AuditLogPage />);
		await screen.findByText("10000 entries");

		await userEvent.type(screen.getByLabelText("Search the audit log"), "admin3@");

		await waitFor(() =>
			expect(screen.getByText(/of 10000 entries match this filter/)).toBeInTheDocument(),
		);
		expect(document.querySelectorAll('[role="row"]').length).toBeLessThan(100);
	});

	it("tells assistive technology how many rows there really are", async () => {
		// A windowed table without aria-rowcount announces "row 3 of 24" to a
		// screen reader user scrolling a log of ten thousand.
		listAuditLog.mockResolvedValue(many(10_000));
		render(<AuditLogPage />);
		await screen.findByText("10000 entries");

		expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "10000");
	});
});
