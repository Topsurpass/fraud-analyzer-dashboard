import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemListSummary, UserRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { can } from "@/services/auth/permissions";
import ListsPage from "./page";

const listsState = vi.hoisted(() => ({
	current: null as unknown as {
		lists: ItemListSummary[];
		loading: boolean;
		initial: boolean;
		error: ApiError | null;
		reload: () => void;
	},
}));
const reload = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ListsContext", () => ({ useLists: () => listsState.current }));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
	usePathname: () => "/lists",
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
			can: (capability: Parameters<typeof permissions.can>[1]) =>
				permissions.can(signedInAs.current, capability),
		}),
	};
});

function person(over: Partial<UserRead> = {}): UserRead {
	return {
		id: "u1",
		email: "ada@example.com",
		full_name: "Ada Lovelace",
		role: "analyst",
		is_active: true,
		must_change_password: false,
		last_login_at: null,
		created_at: "2026-08-01T00:00:00Z",
		...over,
	};
}

function summary(over: Partial<ItemListSummary> = {}): ItemListSummary {
	return {
		id: "l1",
		name: "Blocked terminals",
		description: "Pulled after the August wave",
		item_count: 1200,
		rule_count: 2,
		created_by: "u1",
		created_at: "2026-09-01T00:00:00Z",
		updated_at: "2026-09-01T00:00:00Z",
		...over,
	};
}

beforeEach(() => {
	signedInAs.current = person();
	reload.mockReset();
	listsState.current = {
		lists: [summary(), summary({ id: "l2", name: "Watchlist", description: null, created_by: "u9", item_count: 3, rule_count: 0 })],
		loading: false,
		initial: false,
		error: null,
		reload,
	};
});

function rowFor(name: string): HTMLElement {
	const row = screen.getByText(name).closest('[role="row"]');
	if (!row) throw new Error(`no row rendered for ${name}`);
	return row as HTMLElement;
}

describe("the lists index", () => {
	it("shows name, description, item count and how many rules use each list", () => {
		render(<ListsPage />);
		const row = within(rowFor("Blocked terminals"));
		expect(row.getByText("Pulled after the August wave")).toBeInTheDocument();
		expect(row.getByText("1,200")).toBeInTheDocument();
		expect(row.getByText("2")).toBeInTheDocument();
		expect(within(rowFor("Watchlist")).getByText("No description")).toBeInTheDocument();
	});

	it("links each name to its own page", () => {
		render(<ListsPage />);
		expect(screen.getByRole("link", { name: "Watchlist" })).toHaveAttribute("href", "/lists/l2");
	});

	it("offers Edit on your own list and View on somebody else's", () => {
		render(<ListsPage />);
		expect(within(rowFor("Blocked terminals")).getByRole("link", { name: "Edit" })).toBeInTheDocument();
		expect(within(rowFor("Watchlist")).getByRole("link", { name: "View" })).toBeInTheDocument();
	});

	it("offers Edit on every list to an administrator", () => {
		signedInAs.current = person({ id: "u2", role: "admin" });
		render(<ListsPage />);
		expect(within(rowFor("Watchlist")).getByRole("link", { name: "Edit" })).toBeInTheDocument();
	});

	it("gives any signed-in role a New list button, agreeing with the capability table", () => {
		render(<ListsPage />);
		expect(screen.getByRole("link", { name: "New list" })).toHaveAttribute("href", "/lists/new");
		expect(can(person(), "lists.write")).toBe(true);
	});

	it("offers no New list to an account that holds no capabilities", () => {
		signedInAs.current = person({ must_change_password: true });
		render(<ListsPage />);
		expect(screen.queryByRole("link", { name: "New list" })).not.toBeInTheDocument();
	});

	it("says there are none, and how to make one", () => {
		listsState.current = { ...listsState.current, lists: [] };
		render(<ListsPage />);
		expect(screen.getByText("No lists yet")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Create a list" })).toHaveAttribute("href", "/lists/new");
	});

	it("reports a failed first load with a retry instead of an empty table", () => {
		listsState.current = {
			...listsState.current,
			lists: [],
			error: new ApiError({ kind: "network", message: "x", url: "" }),
		};
		render(<ListsPage />);
		expect(screen.getByText("Could not load the lists")).toBeInTheDocument();
		expect(screen.queryByText("No lists yet")).not.toBeInTheDocument();
		screen.getByRole("button", { name: "Retry" }).click();
		expect(reload).toHaveBeenCalled();
	});

	it("counts the lists", () => {
		render(<ListsPage />);
		expect(screen.getByText("2 lists")).toBeInTheDocument();
	});

	it("filters by name or description and says how many matched", async () => {
		render(<ListsPage />);
		await userEvent.type(screen.getByLabelText("Filter lists"), "AUGUST");
		expect(screen.getByText("Blocked terminals")).toBeInTheDocument();
		expect(screen.queryByText("Watchlist")).not.toBeInTheDocument();
		expect(screen.getByText("1 of 2 lists match this filter")).toBeInTheDocument();

		await userEvent.clear(screen.getByLabelText("Filter lists"));
		await userEvent.type(screen.getByLabelText("Filter lists"), "watch");
		expect(screen.getByText("Watchlist")).toBeInTheDocument();
		expect(screen.queryByText("Blocked terminals")).not.toBeInTheDocument();
	});

	it("shows a no-match state, distinct from having no lists, and clears it", async () => {
		render(<ListsPage />);
		await userEvent.type(screen.getByLabelText("Filter lists"), "zzz");
		expect(screen.getByText("No lists match")).toBeInTheDocument();
		expect(screen.queryByText("No lists yet")).not.toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));
		expect(screen.getByText("Blocked terminals")).toBeInTheDocument();
		expect(screen.getByLabelText("Filter lists")).toHaveValue("");
	});

	it("keeps the table and reports a failed refresh inline, with a retry", () => {
		listsState.current = {
			...listsState.current,
			error: new ApiError({ kind: "network", message: "x", url: "" }),
		};
		render(<ListsPage />);
		expect(screen.getByText("Blocked terminals")).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent(/could not refresh the lists/i);
		screen.getByRole("button", { name: "Retry" }).click();
		expect(reload).toHaveBeenCalled();
	});

	it("has a short search placeholder that fits its box", () => {
		render(<ListsPage />);
		expect(screen.getByLabelText("Filter lists")).toHaveAttribute("placeholder", "Search lists");
	});
});
