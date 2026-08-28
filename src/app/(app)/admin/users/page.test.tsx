import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { can } from "@/services/auth/permissions";
import AdminUsersPage from "./page";

const listUsers = vi.hoisted(() => vi.fn());
const createUser = vi.hoisted(() => vi.fn());
const updateUser = vi.hoisted(() => vi.fn());
const resetUserPassword = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
	const actual =
		await vi.importActual<typeof import("@/services/api-client")>("@/services/api-client");
	return { ...actual, listUsers, createUser, updateUser, resetUserPassword };
});

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
	usePathname: () => "/admin/users",
}));

// The shell's own providers fetch on mount and are not what this page is about.
vi.mock("@/components/PageBody", () => ({
	PageBody: ({ actions, children }: { actions?: React.ReactNode; children: React.ReactNode }) => (
		<div>
			<div>{actions}</div>
			{children}
		</div>
	),
}));

const refreshMe = vi.hoisted(() => vi.fn());
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
			refresh: refreshMe,
			can: (capability: Parameters<typeof permissions.can>[1]) =>
				permissions.can(signedInAs.current, capability),
			signIn: vi.fn(),
			signOut: vi.fn(),
			changeOwnPassword: vi.fn(),
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
		last_login_at: "2026-08-27T08:00:00Z",
		created_at: "2026-08-01T00:00:00Z",
		...over,
	};
}

const ADMIN = person({ id: "u2", email: "grace@navy.example", full_name: "Grace Hopper", role: "admin" });
const SECOND_ADMIN = person({ id: "u9", email: "alan@example.com", full_name: "Alan Turing", role: "admin" });

beforeEach(() => {
	signedInAs.current = ADMIN;
	refreshMe.mockReset();
	listUsers.mockReset().mockResolvedValue([ADMIN, person()]);
	createUser.mockReset();
	updateUser.mockReset();
	resetUserPassword.mockReset();
});

/** The row for one person, found by the name shown in it. */
function rowFor(name: string): HTMLElement {
	const cell = screen.getByText(name);
	const row = cell.closest('[role="row"]');
	if (!row) throw new Error(`no row rendered for ${name}`);
	return row as HTMLElement;
}

describe("who may open this page", () => {
	it("refuses an analyst in the engine's own words", async () => {
		// The engine 403s the data regardless. This decides whether the analyst
		// reads a sentence or watches a page fail to load.
		signedInAs.current = person();
		render(<AdminUsersPage />);

		expect(await screen.findByText(/Not available on this account/i)).toBeInTheDocument();
		expect(screen.getByText(/needs an administrator account/i)).toBeInTheDocument();
		expect(listUsers).not.toHaveBeenCalled();
	});

	it("lets an administrator through", async () => {
		render(<AdminUsersPage />);
		expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
		expect(listUsers).toHaveBeenCalled();
	});

	it("agrees with the capability table rather than checking the role itself", () => {
		// If this ever disagrees, the page has grown its own copy of the rule.
		expect(can(ADMIN, "users.manage")).toBe(true);
		expect(can(person(), "users.manage")).toBe(false);
	});
});

describe("the account list", () => {
	it("marks which row is you", async () => {
		render(<AdminUsersPage />);
		await screen.findByText("Grace Hopper");
		expect(within(rowFor("Grace Hopper")).getByText("you")).toBeInTheDocument();
		expect(within(rowFor("Ada Lovelace")).queryByText("you")).not.toBeInTheDocument();
	});

	it("says an account is still on a temporary password", async () => {
		listUsers.mockResolvedValue([ADMIN, person({ must_change_password: true })]);
		render(<AdminUsersPage />);
		await screen.findByText("Ada Lovelace");
		expect(within(rowFor("Ada Lovelace")).getByText("Pending")).toBeInTheDocument();
	});

	it("shows a deactivated account as deactivated rather than hiding it", async () => {
		listUsers.mockResolvedValue([ADMIN, person({ is_active: false })]);
		render(<AdminUsersPage />);
		await screen.findByText("Ada Lovelace");
		expect(within(rowFor("Ada Lovelace")).getByText("Deactivated")).toBeInTheDocument();
	});

	it("narrows to a search and says what it hid", async () => {
		render(<AdminUsersPage />);
		await screen.findByText("Ada Lovelace");

		await userEvent.type(screen.getByLabelText("Search people"), "grace");

		await waitFor(() => expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument());
		expect(screen.getByText("1 of 2 accounts match this filter")).toBeInTheDocument();
	});

	it("offers a way out of a filter that matches nothing", async () => {
		render(<AdminUsersPage />);
		await screen.findByText("Ada Lovelace");

		await userEvent.type(screen.getByLabelText("Search people"), "nobody");
		expect(await screen.findByText(/Nobody matches that/i)).toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
		expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
	});

	it("surfaces a failure to load with a retry rather than an empty table", async () => {
		listUsers.mockRejectedValue(
			new ApiError({ kind: "network", message: "offline", url: "" }),
		);
		render(<AdminUsersPage />);

		expect(await screen.findByText(/Could not load the account list/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
	});
});

describe("opening an account", () => {
	it("shows the temporary password once, and says it will not come back", async () => {
		const created = person({ id: "u3", email: "alan@example.com", full_name: "Alan Turing" });
		createUser.mockResolvedValue({ user: created, temporary_password: "Kx7mPqR2nT4wYbHj" });
		render(<AdminUsersPage />);
		await screen.findByText("Ada Lovelace");

		await userEvent.click(screen.getByRole("button", { name: "Add person" }));
		await userEvent.type(screen.getByLabelText("Full name"), "Alan Turing");
		await userEvent.type(screen.getByLabelText("Email"), "alan@example.com");
		await userEvent.click(screen.getByRole("button", { name: "Create account" }));

		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("Kx7mPqR2nT4wYbHj")).toBeInTheDocument();
		expect(within(dialog).getByText(/cannot be shown again/i)).toBeInTheDocument();
	});

	it("never sends a password the admin chose", async () => {
		// Structural on the engine too: UserCreate has nowhere to put one.
		createUser.mockResolvedValue({ user: person({ id: "u3" }), temporary_password: "x" });
		render(<AdminUsersPage />);
		await screen.findByText("Ada Lovelace");

		await userEvent.click(screen.getByRole("button", { name: "Add person" }));
		await userEvent.type(screen.getByLabelText("Full name"), "Alan Turing");
		await userEvent.type(screen.getByLabelText("Email"), "alan@example.com");
		await userEvent.click(screen.getByRole("button", { name: "Create account" }));

		await waitFor(() => expect(createUser).toHaveBeenCalled());
		expect(Object.keys(createUser.mock.calls[0][0])).toEqual(["email", "full_name", "role"]);
	});

	it("keeps the form and its values when the engine refuses", async () => {
		// Retyping a name because an email was already taken is a bad trade.
		createUser.mockRejectedValue(
			new ApiError({
				kind: "http",
				message: "That email already has an account.",
				url: "",
				status: 409,
				errorCode: "DUPLICATE_EMAIL",
			}),
		);
		render(<AdminUsersPage />);
		await screen.findByText("Ada Lovelace");

		await userEvent.click(screen.getByRole("button", { name: "Add person" }));
		await userEvent.type(screen.getByLabelText("Full name"), "Alan Turing");
		await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
		await userEvent.click(screen.getByRole("button", { name: "Create account" }));

		expect(await screen.findByText("That email already has an account.")).toBeInTheDocument();
		expect(screen.getByLabelText("Full name")).toHaveValue("Alan Turing");
	});
});

describe("changing an account", () => {
	it("deactivates through PATCH and reloads the list", async () => {
		updateUser.mockResolvedValue(person({ is_active: false }));
		render(<AdminUsersPage />);
		await screen.findByText("Ada Lovelace");

		await userEvent.click(within(rowFor("Ada Lovelace")).getByRole("button", { name: "Deactivate" }));

		await waitFor(() => expect(updateUser).toHaveBeenCalledWith("u1", { is_active: false }));
		expect(listUsers).toHaveBeenCalledTimes(2);
	});

	it("changes a role without touching the active flag", async () => {
		updateUser.mockResolvedValue(person({ role: "admin" }));
		render(<AdminUsersPage />);
		await screen.findByText("Ada Lovelace");

		await userEvent.selectOptions(
			screen.getByLabelText("Role for Ada Lovelace"),
			"admin",
		);

		await waitFor(() => expect(updateUser).toHaveBeenCalledWith("u1", { role: "admin" }));
	});

	it("re-reads your own session when you change your own account", async () => {
		// The rail's admin section and every guard read from the session, not
		// from this list, so demoting yourself has to be followed by the app.
		listUsers.mockResolvedValue([ADMIN, SECOND_ADMIN]);
		updateUser.mockResolvedValue(person({ id: "u2", role: "analyst" }));
		render(<AdminUsersPage />);
		await screen.findByText("Grace Hopper");

		await userEvent.selectOptions(screen.getByLabelText("Role for Grace Hopper"), "analyst");

		await waitFor(() => expect(refreshMe).toHaveBeenCalled());
	});

	it("does not re-read your session when you change somebody else's", async () => {
		updateUser.mockResolvedValue(person({ role: "admin" }));
		render(<AdminUsersPage />);
		await screen.findByText("Ada Lovelace");

		await userEvent.selectOptions(screen.getByLabelText("Role for Ada Lovelace"), "admin");

		await waitFor(() => expect(updateUser).toHaveBeenCalled());
		expect(refreshMe).not.toHaveBeenCalled();
	});

	it("reports a refusal on the row instead of failing silently", async () => {
		updateUser.mockRejectedValue(
			new ApiError({
				kind: "http",
				message: "This would leave no active administrator.",
				url: "",
				status: 409,
				errorCode: "LAST_ADMIN",
			}),
		);
		listUsers.mockResolvedValue([ADMIN, SECOND_ADMIN]);
		render(<AdminUsersPage />);
		await screen.findByText("Alan Turing");

		await userEvent.click(within(rowFor("Alan Turing")).getByRole("button", { name: "Deactivate" }));

		expect(
			await screen.findByText("This would leave no active administrator."),
		).toBeInTheDocument();
	});
});

describe("the last administrator", () => {
	it("cannot be deactivated or demoted, and the control says why", async () => {
		/*
		 * The engine answers LAST_ADMIN. Saying it on the control beats saying
		 * it in a 409 afterwards - and an installation locked out of its own
		 * administration is not a state anybody recovers from in the browser.
		 */
		listUsers.mockResolvedValue([ADMIN, person()]);
		render(<AdminUsersPage />);
		await screen.findByText("Grace Hopper");

		const row = rowFor("Grace Hopper");
		const deactivate = within(row).getByRole("button", { name: "Deactivate" });
		expect(deactivate).toBeDisabled();
		expect(deactivate).toHaveAttribute("title", expect.stringMatching(/only active administrator/i));
		expect(screen.getByLabelText("Role for Grace Hopper")).toBeDisabled();
	});

	it("unlocks once a second administrator exists", async () => {
		listUsers.mockResolvedValue([ADMIN, SECOND_ADMIN]);
		render(<AdminUsersPage />);
		await screen.findByText("Grace Hopper");

		expect(within(rowFor("Grace Hopper")).getByRole("button", { name: "Deactivate" })).toBeEnabled();
		expect(screen.getByLabelText("Role for Grace Hopper")).toBeEnabled();
	});

	it("counts only administrators who can actually sign in", async () => {
		const dormant = person({ id: "u8", full_name: "Dormant Admin", role: "admin", is_active: false });
		listUsers.mockResolvedValue([ADMIN, dormant]);
		render(<AdminUsersPage />);
		await screen.findByText("Grace Hopper");

		expect(within(rowFor("Grace Hopper")).getByRole("button", { name: "Deactivate" })).toBeDisabled();
	});
});

describe("resetting a password", () => {
	it("shows the new temporary password in the same one-time dialog", async () => {
		resetUserPassword.mockResolvedValue({ temporary_password: "Zt9kLmQ3vB6nXcRw" });
		render(<AdminUsersPage />);
		await screen.findByText("Ada Lovelace");

		await userEvent.click(
			within(rowFor("Ada Lovelace")).getByRole("button", { name: "Reset password" }),
		);

		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("Zt9kLmQ3vB6nXcRw")).toBeInTheDocument();
		expect(within(dialog).getByText(/Ada Lovelace/)).toBeInTheDocument();
	});

	it("does not close on its own - the password is gone once it does", async () => {
		resetUserPassword.mockResolvedValue({ temporary_password: "Zt9kLmQ3vB6nXcRw" });
		render(<AdminUsersPage />);
		await screen.findByText("Ada Lovelace");

		await userEvent.click(
			within(rowFor("Ada Lovelace")).getByRole("button", { name: "Reset password" }),
		);
		const dialog = await screen.findByRole("dialog");

		await userEvent.keyboard("{Escape}");
		expect(dialog).toBeInTheDocument();

		await userEvent.click(within(dialog).getByRole("button", { name: "I have copied it" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
	});
});
