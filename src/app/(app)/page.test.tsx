import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionRead, UserRead } from "@/contracts/api";
import OverviewPage from "./page";

/**
 * The front door is the second place a role becomes visible, after the rail,
 * and it was the one that got missed: the rail hid "+ New" for an analyst while
 * this page still offered "New connection" in the top bar and "Add the first
 * connection" in its empty state. Both 403 on click.
 *
 * The browser lane caught it, but that lane needs an engine and a dev server
 * and does not run on every commit. This does.
 */

const useConnections = vi.hoisted(() => vi.fn());
const useDashboards = vi.hoisted(() => vi.fn());

vi.mock("@/services/connections/ConnectionsContext", () => ({ useConnections }));
vi.mock("@/services/dashboards", () => ({ useDashboards }));
vi.mock("@/services/flagged/FlaggedContext", () => ({
	useFlagged: () => ({
		countForConnection: () => 0,
		severityForConnection: () => null,
		total: 0,
	}),
}));

vi.mock("@/components/PageBody", () => ({
	PageBody: ({ actions, children }: { actions?: React.ReactNode; children: React.ReactNode }) => (
		<div>
			<div data-testid="page-actions">{actions}</div>
			{children}
		</div>
	),
}));

const signedInAs = vi.hoisted(() => ({ role: "admin" as "admin" | "analyst" }));

vi.mock("@/services/auth/AuthContext", async () => {
	const permissions =
		await vi.importActual<typeof import("@/services/auth/permissions")>(
			"@/services/auth/permissions",
		);
	const account = (): UserRead => ({
		id: "u1",
		email: "ada@example.com",
		full_name: "Ada Lovelace",
		role: signedInAs.role,
		is_active: true,
		must_change_password: false,
		last_login_at: null,
		created_at: "2026-08-01T00:00:00Z",
	});
	return {
		useAuth: () => ({
			status: "signedIn",
			user: account(),
			busy: false,
			signIn: vi.fn(),
			signOut: vi.fn(),
			changeOwnPassword: vi.fn(),
			refresh: vi.fn(),
			can: (capability: Parameters<typeof permissions.can>[1]) =>
				permissions.can(account(), capability),
		}),
	};
});

function connection(over: Partial<ConnectionRead> = {}): ConnectionRead {
	return {
		id: "c1",
		name: "Payments DB",
		db_type: "sqlite",
		host: null,
		port: null,
		database: null,
		username: null,
		sqlite_path: "/tmp/payments.db",
		ssl_mode: "require",
		ssl_root_cert: null,
		paused: false,
		status: "ok",
		last_tested_at: "2026-08-27T09:00:00Z",
		last_test_error: null,
		created_at: "2026-08-01T00:00:00Z",
		updated_at: "2026-08-01T00:00:00Z",
		...over,
	};
}

function withConnections(list: ConnectionRead[]) {
	useConnections.mockReturnValue({
		connections: list,
		initial: false,
		loading: false,
		error: null,
		reload: vi.fn(),
	});
}

beforeEach(() => {
	signedInAs.role = "admin";
	withConnections([connection()]);
	useDashboards.mockReturnValue({
		dashboards: [],
		initial: false,
		loading: false,
		error: null,
		reload: vi.fn(),
	});
});

const newConnectionLinks = () =>
	screen.queryAllByRole("link").filter((link) => link.getAttribute("href") === "/connections/new");

describe("adding a connection from the front door", () => {
	it("is offered to an administrator", () => {
		render(<OverviewPage />);
		expect(newConnectionLinks().length).toBeGreaterThan(0);
	});

	it("is not offered to an analyst, who would only be refused", () => {
		signedInAs.role = "analyst";
		render(<OverviewPage />);
		expect(newConnectionLinks()).toHaveLength(0);
	});

	it("is not offered to an analyst from the empty state either", () => {
		// The second half of the same bug: the top-bar button and the empty
		// state's call to action are separate links to the same guarded page.
		signedInAs.role = "analyst";
		withConnections([]);
		render(<OverviewPage />);

		expect(newConnectionLinks()).toHaveLength(0);
		expect(screen.getByText(/No connections yet/i)).toBeInTheDocument();
	});

	it("tells an analyst with no connections who does add them", () => {
		// An empty state with the action removed and nothing said in its place
		// is a dead end. It should say where connections come from.
		signedInAs.role = "analyst";
		withConnections([]);
		render(<OverviewPage />);

		expect(screen.getByText(/An administrator adds them/i)).toBeInTheDocument();
	});

	it("still offers it to an administrator with no connections", () => {
		withConnections([]);
		render(<OverviewPage />);
		expect(newConnectionLinks().length).toBeGreaterThan(0);
	});
});

describe("what every role still sees", () => {
	it("shows an analyst the connections themselves", () => {
		// Listing is not managing. Analysts query these databases, so hiding the
		// list would remove the thing they came for.
		signedInAs.role = "analyst";
		render(<OverviewPage />);

		expect(screen.getByRole("link", { name: /Payments DB/ })).toHaveAttribute(
			"href",
			"/connections/c1",
		);
	});

	it("lets an analyst build a dashboard, which is not an admin act", () => {
		signedInAs.role = "analyst";
		render(<OverviewPage />);

		expect(
			screen.queryAllByRole("link").some((link) => link.getAttribute("href") === "/dashboards/new"),
		).toBe(true);
	});
});
