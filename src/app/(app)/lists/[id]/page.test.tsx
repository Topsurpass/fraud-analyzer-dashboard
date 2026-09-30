import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemListRead, UserRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import ListPage from "./page";

const getList = vi.hoisted(() => vi.fn());
const updateList = vi.hoisted(() => vi.fn());
const deleteList = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const reloadLists = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
	const actual =
		await vi.importActual<typeof import("@/services/api-client")>("@/services/api-client");
	return { ...actual, getList, updateList, deleteList };
});

vi.mock("@/lib/ListsContext", () => ({ useLists: () => ({ reload: reloadLists }) }));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
	usePathname: () => "/lists/l1",
}));

vi.mock("@/components/PageBody", () => ({
	PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const signedInAs = vi.hoisted(() => ({ current: null as UserRead | null }));

vi.mock("@/services/auth/AuthContext", () => ({
	useAuth: () => ({ status: "signedIn", user: signedInAs.current }),
}));

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

function stored(over: Partial<ItemListRead> = {}): ItemListRead {
	return {
		id: "l1",
		name: "Blocked terminals",
		description: "August wave",
		item_count: 2,
		rule_count: 0,
		created_by: "u1",
		created_at: "2026-09-01T00:00:00Z",
		updated_at: "2026-09-01T00:00:00Z",
		items: ["T-1", "T-2"],
		...over,
	};
}

const forbidden = () =>
	new ApiError({
		kind: "http",
		status: 403,
		errorCode: "FORBIDDEN",
		message: "Only the person who created this list, or an admin, can change it.",
		url: "/lists/l1",
	});

// `params` is a promise the page unwraps with `use`, so the first commit suspends.
async function open(id = "l1") {
	let view!: ReturnType<typeof render>;
	await act(async () => {
		view = render(
			<Suspense fallback={null}>
				<ListPage params={Promise.resolve({ id })} />
			</Suspense>,
		);
	});
	return view;
}

beforeEach(() => {
	signedInAs.current = person();
	getList.mockReset().mockResolvedValue(stored());
	updateList.mockReset();
	deleteList.mockReset().mockResolvedValue(undefined);
	push.mockReset();
	window.sessionStorage.clear();
	reloadLists.mockReset();
});

describe("a list you made", () => {
	it("loads the list by id and fills the form, one item per line", async () => {
		await open();
		expect(await screen.findByDisplayValue("Blocked terminals")).toBeInTheDocument();
		expect((screen.getByLabelText("Items") as HTMLTextAreaElement).value).toBe("T-1\nT-2");
		expect(getList.mock.calls[0][0]).toBe("l1");
	});

	it("saves the whole list and reports what the engine kept", async () => {
		updateList.mockResolvedValue({
			...stored({ items: ["T-1", "T-2", "T-3"], item_count: 3, updated_at: "2026-09-02T00:00:00Z" }),
			received: 4,
			kept: 3,
			duplicates_dropped: 1,
		});
		await open();
		const items = await screen.findByLabelText("Items");
		await userEvent.clear(items);
		await userEvent.type(items, "T-1, T-2, T-3, t-3");
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => expect(updateList).toHaveBeenCalledTimes(1));
		expect(updateList).toHaveBeenCalledWith("l1", {
			name: "Blocked terminals",
			description: "August wave",
			items: ["T-1", "T-2", "T-3", "t-3"],
		});
		expect(await screen.findByRole("status")).toHaveTextContent(
			"Saved. 3 items kept, 1 duplicate dropped.",
		);
		expect(reloadLists).toHaveBeenCalled();
		// The list is refetched so the box shows the stored, de-duplicated items.
		await waitFor(() => expect(getList).toHaveBeenCalledTimes(2));
	});

	it("keeps the form and says why when the name is taken", async () => {
		updateList.mockRejectedValue(
			new ApiError({ kind: "http", status: 409, errorCode: "LIST_NAME_TAKEN", message: "x", url: "" }),
		);
		await open();
		await screen.findByDisplayValue("Blocked terminals");
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(/already has that name/i);
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});

	it("asks twice before deleting, then deletes and returns to the index", async () => {
		await open();
		await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
		expect(deleteList).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

		await waitFor(() => expect(deleteList).toHaveBeenCalledWith("l1"));
		expect(reloadLists).toHaveBeenCalled();
		expect(push).toHaveBeenCalledWith("/lists");
	});

	it("names the rules that block a delete, and links to their queries", async () => {
		deleteList.mockRejectedValue(
			new ApiError({
				kind: "http",
				status: 409,
				errorCode: "LIST_IN_USE",
				message: "This list is used by 2 rules.",
				url: "/lists/l1",
				detail: {
					rules: [
						{ rule_name: "Blocked terminal", query_id: "q1", query_name: "Transfers" },
						{ rule_name: "Watch", query_id: "q2", query_name: "Cards" },
					],
				},
			}),
		);
		await open();
		await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
		await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

		const alert = await screen.findByRole("alert");
		// The structured list carries the facts; the engine's sentence is not
		// printed on top of it.
		expect(alert).toHaveTextContent("This list is still used by:");
		expect(alert).not.toHaveTextContent("This list is used by 2 rules.");
		expect(screen.getByRole("link", { name: "Blocked terminal" })).toHaveAttribute(
			"href",
			"/queries/q1",
		);
		expect(alert).toHaveTextContent("on Transfers");
		expect(alert).toHaveTextContent("on Cards");
		expect(push).not.toHaveBeenCalled();
		// Back to the first press, so a second delete needs a fresh confirmation.
		expect(screen.getByRole("button", { name: "Delete list" })).toBeInTheDocument();
	});

	const blocked = (detail: unknown, message: string) =>
		new ApiError({
			kind: "http",
			status: 409,
			errorCode: "LIST_IN_USE",
			message,
			url: "/lists/l1",
			detail,
		});

	async function attemptDelete() {
		await open();
		await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
		await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
		return screen.findByRole("alert");
	}

	it("says so when the only rules are on queries the viewer cannot see", async () => {
		deleteList.mockRejectedValue(
			blocked({ list_id: "l1", rules: [], hidden_rule_count: 2 }, "in use"),
		);
		const alert = await attemptDelete();
		expect(alert).toHaveTextContent("Used by 2 rules on queries you cannot see");
		expect(screen.queryByRole("list")).not.toBeInTheDocument();
		expect(push).not.toHaveBeenCalled();
	});

	it("lists visible rules and counts the hidden ones beside them", async () => {
		deleteList.mockRejectedValue(
			blocked(
				{
					list_id: "l1",
					rules: [{ rule_name: "Blocked terminal", query_id: "q1", query_name: "Transfers" }],
					hidden_rule_count: 1,
				},
				"in use",
			),
		);
		const alert = await attemptDelete();
		expect(screen.getByRole("link", { name: "Blocked terminal" })).toBeInTheDocument();
		expect(alert).toHaveTextContent("Plus 1 rule on queries you cannot see");
	});

	it("does not mention hidden rules when there are none", async () => {
		deleteList.mockRejectedValue(
			blocked(
				{
					list_id: "l1",
					rules: [{ rule_name: "R", query_id: "q1", query_name: "T" }],
					hidden_rule_count: 0,
				},
				"in use",
			),
		);
		const alert = await attemptDelete();
		expect(alert).not.toHaveTextContent(/cannot see/);
	});

	it("does not offer a delete that cannot work when rules already use the list", async () => {
		getList.mockResolvedValue(stored({ rule_count: 2 }));
		await open();
		const button = await screen.findByRole("button", { name: "Delete list" });
		expect(button).toBeDisabled();
		expect(screen.getByText(/2 rules use this list/)).toBeInTheDocument();
		expect(deleteList).not.toHaveBeenCalled();

		getList.mockResolvedValue(stored({ rule_count: 0 }));
		await userEvent.click(screen.getByRole("button", { name: "Check again" }));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Delete list" })).toBeEnabled(),
		);
	});

	it("shows the blockers and locks the delete when a rule appeared since the page loaded", async () => {
		deleteList.mockRejectedValue(
			blocked(
				{
					list_id: "l1",
					rules: [{ rule_name: "New rule", query_id: "q7", query_name: "Cards" }],
					hidden_rule_count: 0,
				},
				"engine sentence",
			),
		);
		getList.mockResolvedValueOnce(stored()).mockResolvedValue(stored({ rule_count: 1 }));
		const alert = await attemptDelete();
		expect(screen.getByRole("link", { name: "New rule" })).toHaveAttribute("href", "/queries/q7");
		expect(alert).not.toHaveTextContent("engine sentence");
		await waitFor(() => expect(screen.getByRole("button", { name: "Delete list" })).toBeDisabled());
	});

	it("falls back to the engine's sentence when the detail names nothing", async () => {
		deleteList.mockRejectedValue(blocked(null, "engine sentence"));
		const alert = await attemptDelete();
		expect(alert).toHaveTextContent("engine sentence");
	});

	it("moves keyboard focus with the delete buttons instead of dropping it", async () => {
		await open();
		await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
		expect(screen.getByRole("button", { name: "Delete permanently" })).toHaveFocus();

		// The form has its own Cancel; the delete confirmation's comes last.
		await userEvent.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1) as HTMLElement);
		expect(screen.getByRole("button", { name: "Delete list" })).toHaveFocus();
	});

	it("moves focus to the explanation after a refused delete", async () => {
		deleteList.mockRejectedValue(forbidden());
		await open();
		await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
		await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
		const alert = await screen.findByRole("alert");
		await waitFor(() => expect(alert).toHaveFocus());
	});

	it("keeps focus on the blockers when a race 409 swaps Delete for a disabled button", async () => {
		deleteList.mockRejectedValue(
			blocked(
				{
					list_id: "l1",
					rules: [{ rule_name: "New rule", query_id: "q7", query_name: "Cards" }],
					hidden_rule_count: 0,
				},
				"engine sentence",
			),
		);
		getList.mockResolvedValueOnce(stored()).mockResolvedValue(stored({ rule_count: 1 }));
		const alert = await attemptDelete();
		await waitFor(() => expect(screen.getByRole("button", { name: "Delete list" })).toBeDisabled());
		expect(alert).toHaveFocus();
		expect(document.body).not.toHaveFocus();
	});

	it("clears the blockers when Check again finds the rule gone", async () => {
		deleteList.mockRejectedValue(
			blocked(
				{
					list_id: "l1",
					rules: [{ rule_name: "New rule", query_id: "q7", query_name: "Cards" }],
					hidden_rule_count: 0,
				},
				"engine sentence",
			),
		);
		getList.mockResolvedValueOnce(stored()).mockResolvedValue(stored({ rule_count: 1 }));
		await attemptDelete();
		await waitFor(() => expect(screen.getByRole("button", { name: "Delete list" })).toBeDisabled());

		getList.mockResolvedValue(stored({ rule_count: 0 }));
		await userEvent.click(screen.getByRole("button", { name: "Check again" }));

		await waitFor(() => expect(screen.getByRole("button", { name: "Delete list" })).toBeEnabled());
		// The focused Check again button and the alert both unmounted; focus
		// must land on the button that replaced them, not on the body.
		expect(screen.getByRole("button", { name: "Delete list" })).toHaveFocus();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "New rule" })).not.toBeInTheDocument();
		expect(screen.getByText(/No rule uses it/)).toBeInTheDocument();
	});

	it("drops the blockers on its own when a later reload shows no rule uses the list", async () => {
		// The count fell to zero without anyone pressing Check again: the alert
		// must not outlive the fact it reported.
		deleteList.mockRejectedValue(
			blocked({ list_id: "l1", rules: [], hidden_rule_count: 1 }, "in use"),
		);
		getList.mockResolvedValueOnce(stored()).mockResolvedValue(stored({ rule_count: 1 }));
		await attemptDelete();
		await waitFor(() => expect(screen.getByRole("button", { name: "Delete list" })).toBeDisabled());

		// Saving reloads the list too; by then the rule is gone.
		updateList.mockResolvedValue({ ...stored(), received: 2, kept: 2, duplicates_dropped: 0 });
		getList.mockResolvedValue(stored({ rule_count: 0 }));
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => expect(screen.getByRole("button", { name: "Delete list" })).toBeEnabled());
		expect(screen.queryByText(/cannot see/)).not.toBeInTheDocument();
	});

	it("puts focus on Delete list when the render-phase clear removes the focused alert", async () => {
		deleteList.mockRejectedValue(
			blocked({ list_id: "l1", rules: [], hidden_rule_count: 1 }, "in use"),
		);
		getList.mockResolvedValueOnce(stored()).mockResolvedValue(stored({ rule_count: 1 }));
		const alert = await attemptDelete();
		await waitFor(() => expect(alert).toHaveFocus());

		updateList.mockResolvedValue({ ...stored(), received: 2, kept: 2, duplicates_dropped: 0 });
		getList.mockResolvedValue(stored({ rule_count: 0 }));
		// Put focus back on the (about to unmount) alert, as if the reload landed
		// while the analyst was still reading it.
		await act(async () => {
			(await screen.findByRole("alert")).focus();
			screen.getByRole("button", { name: "Save changes" }).click();
		});
		await waitFor(() => expect(screen.getByRole("button", { name: "Delete list" })).toBeEnabled());
		expect(screen.getByRole("button", { name: "Delete list" })).toHaveFocus();
	});

	it("does not steal focus from the form when the count falls to zero", async () => {
		deleteList.mockRejectedValue(
			blocked({ list_id: "l1", rules: [], hidden_rule_count: 1 }, "in use"),
		);
		getList.mockResolvedValueOnce(stored()).mockResolvedValue(stored({ rule_count: 1 }));
		await attemptDelete();
		await waitFor(() => expect(screen.getByRole("button", { name: "Delete list" })).toBeDisabled());

		const name = screen.getByLabelText("Name");
		getList.mockResolvedValue(stored({ rule_count: 0 }));
		await userEvent.click(screen.getByRole("button", { name: "Check again" }));
		name.focus();
		await waitFor(() => expect(screen.getByRole("button", { name: "Delete list" })).toBeEnabled());
		expect(name).toHaveFocus();
	});

	it("keeps a non-blocker error (network) visible when the count is zero", async () => {
		deleteList.mockRejectedValue(new ApiError({ kind: "network", message: "x", url: "" }));
		const alert = await attemptDelete();
		expect(alert).toHaveTextContent("Cannot reach engine");
		expect(screen.getByRole("button", { name: "Delete list" })).toBeEnabled();
	});

	it("points the disabled Delete list at the explanation", async () => {
		getList.mockResolvedValue(stored({ rule_count: 2 }));
		await open();
		const button = await screen.findByRole("button", { name: "Delete list" });
		const id = button.getAttribute("aria-describedby");
		expect(id).toBeTruthy();
		expect(document.getElementById(id as string)).toHaveTextContent(/2 rules use this list/);
	});

	it("warns up front when rules already use it", async () => {
		getList.mockResolvedValue(stored({ rule_count: 3 }));
		await open();
		expect(await screen.findByText(/3 rules use this list/)).toBeInTheDocument();
	});
});

describe("the engine refusing a write", () => {
	it("shows the 403 on save and keeps what was typed", async () => {
		// The page thought the viewer owned it (a role or ownership change since
		// load): the engine is the authority and its sentence is the answer.
		updateList.mockRejectedValue(forbidden());
		await open();
		const name = await screen.findByDisplayValue("Blocked terminals");
		await userEvent.type(name, " v2");
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Only the person who created this list, or an admin, can change it.",
		);
		expect(screen.getByDisplayValue("Blocked terminals v2")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});

	it("shows the 403 on delete, stays on the page, and offers the delete again", async () => {
		deleteList.mockRejectedValue(forbidden());
		await open();
		await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
		await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(/can change it/);
		expect(push).not.toHaveBeenCalled();
		expect(screen.getByDisplayValue("Blocked terminals")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Delete list" })).toBeEnabled();
	});
});

describe("a refetch that fails after a good save", () => {
	it("keeps the form and reports the refresh failure inline", async () => {
		updateList.mockResolvedValue({
			...stored({ updated_at: "2026-09-02T00:00:00Z" }),
			received: 2,
			kept: 2,
			duplicates_dropped: 0,
		});
		await open();
		await screen.findByDisplayValue("Blocked terminals");
		getList.mockRejectedValue(
			new ApiError({ kind: "network", message: "x", url: "" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

		expect(await screen.findByText(/Could not refresh this list/)).toBeInTheDocument();
		expect(screen.getByText(/^Saved\./)).toBeInTheDocument();
		expect(screen.getByDisplayValue("Blocked terminals")).toBeInTheDocument();
		expect(screen.queryByText("Could not load this list")).not.toBeInTheDocument();

		getList.mockResolvedValue(stored());
		await userEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(screen.queryByText(/Could not refresh this list/)).not.toBeInTheDocument(),
		);
	});
});

describe("focus and state across reloads and route changes", () => {
	const racing = () =>
		new ApiError({
			kind: "http",
			status: 409,
			errorCode: "LIST_IN_USE",
			message: "in use",
			url: "/lists/l1",
			detail: { list_id: "l1", rules: [], hidden_rule_count: 1 },
		});

	it("leaves focus on Delete list when the reload also changes updated_at and remounts the form", async () => {
		// The form is keyed on updated_at, so it remounts here. It must not pull
		// focus into the Name field on the way.
		deleteList.mockRejectedValue(racing());
		getList.mockResolvedValueOnce(stored()).mockResolvedValue(stored({ rule_count: 1 }));
		await open();
		await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
		await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
		await waitFor(() => expect(screen.getByRole("button", { name: "Delete list" })).toBeDisabled());

		getList.mockResolvedValue(stored({ rule_count: 0, updated_at: "2026-09-05T00:00:00Z" }));
		await userEvent.click(screen.getByRole("button", { name: "Check again" }));

		await waitFor(() => expect(screen.getByRole("button", { name: "Delete list" })).toBeEnabled());
		expect(screen.getByRole("button", { name: "Delete list" })).toHaveFocus();
		expect(screen.getByLabelText("Name")).not.toHaveFocus();
	});

	it("does not focus the name field when the page opens", async () => {
		await open();
		expect(await screen.findByDisplayValue("Blocked terminals")).not.toHaveFocus();
	});

	it("never shows a confirmation nobody asked for when the count returns to zero", async () => {
		await open();
		await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
		expect(screen.getByRole("button", { name: "Delete permanently" })).toBeInTheDocument();

		updateList.mockResolvedValue({ ...stored(), received: 2, kept: 2, duplicates_dropped: 0 });
		getList.mockResolvedValue(stored({ rule_count: 1, updated_at: "2026-09-03T00:00:00Z" }));
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() => expect(screen.getByRole("button", { name: "Delete list" })).toBeDisabled());

		getList.mockResolvedValue(stored({ rule_count: 0, updated_at: "2026-09-04T00:00:00Z" }));
		await userEvent.click(screen.getByRole("button", { name: "Check again" }));
		await waitFor(() => expect(screen.getByRole("button", { name: "Delete list" })).toBeEnabled());
		expect(screen.queryByRole("button", { name: "Delete permanently" })).not.toBeInTheDocument();
	});

	it("never shows the old list, its form or its refusal under a new id", async () => {
		deleteList.mockRejectedValue(forbidden());
		const view = await open("l1");
		await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
		await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
		await screen.findByRole("alert");

		let release!: (value: ItemListRead) => void;
		getList.mockReturnValue(new Promise<ItemListRead>((resolve) => (release = resolve)));
		await act(async () => {
			view.rerender(
				<Suspense fallback={null}>
					<ListPage params={Promise.resolve({ id: "l2" })} />
				</Suspense>,
			);
		});
		// While l2 loads, nothing of l1 is on screen.
		expect(screen.queryByDisplayValue("Blocked terminals")).not.toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(getList).toHaveBeenLastCalledWith("l2", expect.anything());

		await act(async () => release(stored({ id: "l2", name: "Other", items: ["x"] })));
		expect(await screen.findByDisplayValue("Other")).toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Delete permanently" })).not.toBeInTheDocument();
	});

	it("ignores a delete that fails after the route moved to another list", async () => {
		let fail!: (reason: unknown) => void;
		deleteList.mockReturnValue(new Promise((_, reject) => (fail = reject)));
		const view = await open("l1");
		await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
		await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

		getList.mockResolvedValue(stored({ id: "l2", name: "Other" }));
		await act(async () => {
			view.rerender(
				<Suspense fallback={null}>
					<ListPage params={Promise.resolve({ id: "l2" })} />
				</Suspense>,
			);
		});
		await screen.findByDisplayValue("Other");

		await act(async () => fail(forbidden()));
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Delete list" })).toBeEnabled();
	});
});

describe("after a save", () => {
	const savedResponse = () => ({
		...stored({ items: ["T-1", "T-2"], updated_at: "2026-09-02T00:00:00Z" }),
		received: 3,
		kept: 2,
		duplicates_dropped: 1,
	});

	it("keeps focus on the Save button pressed, and shows what the engine kept", async () => {
		updateList.mockResolvedValue(savedResponse());
		getList.mockResolvedValueOnce(stored()).mockResolvedValue(savedResponse());
		await open();
		const items = await screen.findByLabelText("Items");
		await userEvent.clear(items);
		await userEvent.type(items, "T-1\nT-2\nt-2");
		const save = screen.getByRole("button", { name: "Save changes" });
		await userEvent.click(save);

		await screen.findByRole("status");
		await waitFor(() => expect(getList).toHaveBeenCalledTimes(2));
		// The same element, still focused: the form was not remounted.
		expect(screen.getByRole("button", { name: "Save changes" })).toBe(save);
		expect(save).toHaveFocus();
		expect((screen.getByLabelText("Items") as HTMLTextAreaElement).value).toBe("T-1\nT-2");
	});

	it("keeps focus in the field when the save was submitted with Enter", async () => {
		updateList.mockResolvedValue(savedResponse());
		getList.mockResolvedValueOnce(stored()).mockResolvedValue(savedResponse());
		await open();
		const name = await screen.findByLabelText("Name");
		await userEvent.click(name);
		await userEvent.keyboard("{Enter}");

		await screen.findByRole("status");
		await waitFor(() => expect(getList).toHaveBeenCalledTimes(2));
		expect(screen.getByLabelText("Name")).toBe(name);
		expect(name).toHaveFocus();
	});

	it("does not overwrite what is being typed when the list merely reloads", async () => {
		getList.mockResolvedValue(stored({ rule_count: 1 }));
		await open();
		const name = await screen.findByLabelText("Name");
		await userEvent.type(name, " draft");

		getList.mockResolvedValue(
			stored({ rule_count: 1, name: "Changed elsewhere", updated_at: "2026-09-09T00:00:00Z" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Check again" }));
		await waitFor(() => expect(getList).toHaveBeenCalledTimes(2));
		expect(screen.getByLabelText("Name")).toHaveValue("Blocked terminals draft");
	});
});

describe("a list that vanishes while open", () => {
	it("says it no longer exists, with a way back, instead of a refresh error", async () => {
		updateList.mockResolvedValue({ ...stored(), received: 2, kept: 2, duplicates_dropped: 0 });
		await open();
		await screen.findByDisplayValue("Blocked terminals");
		getList.mockRejectedValue(
			new ApiError({ kind: "http", status: 404, errorCode: "LIST_NOT_FOUND", message: "x", url: "" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

		expect(await screen.findByText("This list no longer exists")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Back to lists" })).toHaveAttribute("href", "/lists");
		expect(screen.queryByText(/Could not refresh this list/)).not.toBeInTheDocument();
		expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
	});
});

describe("a list somebody else made", () => {
	beforeEach(() => {
		getList.mockResolvedValue(stored({ created_by: "u9" }));
	});

	it("is read-only for another analyst, with the reason", async () => {
		await open();
		expect(await screen.findByDisplayValue("Blocked terminals")).toBeDisabled();
		expect(screen.getByLabelText("Items")).toBeDisabled();
		expect(screen.getByText(/Only the person who made this list/)).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Delete list" })).not.toBeInTheDocument();
	});

	it("is editable and deletable by an administrator", async () => {
		signedInAs.current = person({ id: "u2", role: "admin" });
		await open();
		expect(await screen.findByRole("button", { name: "Save changes" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Delete list" })).toBeInTheDocument();
	});
});

describe("a list that cannot be loaded", () => {
	it("says it does not exist on a 404, with a retry", async () => {
		getList.mockRejectedValue(
			new ApiError({ kind: "http", status: 404, errorCode: "LIST_NOT_FOUND", message: "x", url: "" }),
		);
		await open();
		expect(await screen.findByText("Could not load this list")).toBeInTheDocument();
		expect(screen.getByText(/does not exist, or it was deleted/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
	});
});
