import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemListRead, ItemListSummary, UserRead } from "@/contracts/api";
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
const createList = vi.hoisted(() => vi.fn());
const getList = vi.hoisted(() => vi.fn());
const updateList = vi.hoisted(() => vi.fn());
const deleteList = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ current: "" }));

vi.mock("@/services/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/services/api-client")>("@/services/api-client");
  return { ...actual, createList, getList, updateList, deleteList };
});

vi.mock("@/lib/ListsContext", () => ({ useLists: () => listsState.current }));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
	usePathname: () => "/lists",
	useSearchParams: () => new URLSearchParams(search.current),
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
	replace.mockReset();
	search.current = "";
	getList.mockReset().mockImplementation(async (id: string) => detail(id));
	updateList.mockReset();
	deleteList.mockReset().mockResolvedValue(undefined);
	createList.mockReset().mockResolvedValue({
		id: "l9",
		name: "Fresh list",
		received: 4,
		kept: 3,
		duplicates_dropped: 1,
	});
	listsState.current = {
		lists: [summary(), summary({ id: "l2", name: "Watchlist", description: null, created_by: "u9", item_count: 3, rule_count: 0 })],
		loading: false,
		initial: false,
		error: null,
		reload,
	};
});

/** What GET /lists/<id> returns for the rows in `listsState`. */
function detail(id: string): ItemListRead {
	const row = listsState.current.lists.find((list) => list.id === id) as ItemListSummary;
	return { ...row, items: ["T-1", "T-2"] };
}

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
		// A real link, so it can be copied or opened in a new tab.
		expect(screen.getByRole("link", { name: "Watchlist" })).toHaveAttribute(
			"href",
			"/lists?open=l2",
		);
	});

	it("offers Edit on your own list and View on somebody else's", () => {
		render(<ListsPage />);
		expect(within(rowFor("Blocked terminals")).getByRole("button", { name: "Edit" })).toBeInTheDocument();
		expect(within(rowFor("Watchlist")).getByRole("button", { name: "View" })).toBeInTheDocument();
	});

	it("offers Edit on every list to an administrator", () => {
		signedInAs.current = person({ id: "u2", role: "admin" });
		render(<ListsPage />);
		expect(within(rowFor("Watchlist")).getByRole("button", { name: "Edit" })).toBeInTheDocument();
	});

	it("gives any signed-in role a New list button, agreeing with the capability table", () => {
		render(<ListsPage />);
		expect(screen.getByRole("button", { name: "New list" })).toBeInTheDocument();
		expect(can(person(), "lists.write")).toBe(true);
	});

	it("offers no New list to an account that holds no capabilities", () => {
		signedInAs.current = person({ must_change_password: true });
		render(<ListsPage />);
		expect(screen.queryByRole("button", { name: "New list" })).not.toBeInTheDocument();
	});

	it("says there are none, and how to make one", () => {
		listsState.current = { ...listsState.current, lists: [] };
		render(<ListsPage />);
		expect(screen.getByText("No lists yet")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Create a list" })).toBeInTheDocument();
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

describe("creating a list from the index", () => {
  const dialog = () => screen.queryByRole("dialog");
  /** What a browser does on Escape: a cancellable `cancel` event on the dialog.
   *  jsdom does not, so it is sent by hand. Returns whether it was cancelled. */
  const pressEscape = () =>
    !fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));

  async function createOne() {
    await userEvent.click(screen.getByRole("button", { name: "New list" }));
    await userEvent.type(within(screen.getByRole("dialog")).getByLabelText("Name"), "Fresh list");
    await userEvent.type(within(screen.getByRole("dialog")).getByLabelText("Items"), "a\nb\nc\nc");
    await userEvent.click(screen.getByRole("button", { name: "Create list" }));
  }

  it("opens a dialog over the lists instead of leaving the page", async () => {
    render(<ListsPage />);
    expect(dialog()).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New list" }));
    expect(screen.getByRole("dialog", { name: "New list" })).toBeInTheDocument();
    // The table is still there behind it.
    expect(screen.getByText("Watchlist")).toBeInTheDocument();
  });

  it("puts the cursor in Name when it opens", async () => {
    render(<ListsPage />);
    await userEvent.click(screen.getByRole("button", { name: "New list" }));
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it("closes on save, refreshes the lists and says what was kept", async () => {
    render(<ListsPage />);
    await createOne();

    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(createList).toHaveBeenCalledWith({
      name: "Fresh list",
      description: null,
      items: ["a", "b", "c", "c"],
    });
    expect(reload).toHaveBeenCalled();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Created");
    expect(status).toHaveTextContent("Fresh list");
    expect(status).toHaveTextContent("3 items");
    expect(status).toHaveTextContent("1 duplicate was dropped");
    expect(within(status).getByRole("link", { name: "Open list" })).toHaveAttribute(
      "href",
      "/lists?open=l9",
    );
  });

  it("dismisses the confirmation", async () => {
    render(<ListsPage />);
    await createOne();
    await screen.findByRole("status");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("marks the new row once it arrives, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { rerender } = render(<ListsPage />);
      await createOne();
      await screen.findByRole("status");
      // The context refetches: the new list joins the table.
      listsState.current = {
        ...listsState.current,
        lists: [...listsState.current.lists, summary({ id: "l9", name: "Fresh list" })],
      };
      rerender(<ListsPage />);
      expect(rowFor("Fresh list")).toHaveClass("bg-accent-soft");
      await vi.advanceTimersByTimeAsync(5100);
      expect(rowFor("Fresh list")).not.toHaveClass("bg-accent-soft");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays open with the reason when the save fails, and confirms nothing", async () => {
    createList.mockRejectedValue(
      new ApiError({ kind: "http", status: 409, errorCode: "LIST_NAME_TAKEN", message: "taken", url: "/lists" }),
    );
    render(<ListsPage />);
    await createOne();

    expect(await screen.findByRole("alert")).toHaveTextContent(/already has that name/i);
    expect(dialog()).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    // What was typed is still there to fix.
    expect(screen.getByLabelText("Name")).toHaveValue("Fresh list");
  });

  it("starts empty every time it is opened", async () => {
    render(<ListsPage />);
    await userEvent.click(screen.getByRole("button", { name: "New list" }));
    await userEvent.type(screen.getByLabelText("Name"), "half typed");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(dialog()).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "New list" }));
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("closes on Escape and on the close button, without saving", async () => {
    render(<ListsPage />);
    await userEvent.click(screen.getByRole("button", { name: "New list" }));
    // Handled here rather than left to the browser, so the page stays in charge
    // of whether the dialog is open.
    expect(pressEscape()).toBe(true);
    expect(dialog()).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "New list" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(dialog()).not.toBeInTheDocument();
    expect(createList).not.toHaveBeenCalled();
  });

  it("cannot be dismissed while the save is in flight", async () => {
    let finish: (value: unknown) => void = () => {};
    createList.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<ListsPage />);
    await createOne();

    expect(pressEscape()).toBe(true);
    expect(dialog()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();

    finish({ id: "l9", name: "Fresh list", received: 4, kept: 4, duplicates_dropped: 0 });
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
  });

  it("opens already when the old /lists/new link redirects here, and strips the flag on close", async () => {
    search.current = "new";
    render(<ListsPage />);
    expect(screen.getByRole("dialog", { name: "New list" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(replace).toHaveBeenCalledWith("/lists");
  });

  it("does not touch the URL when it was opened from the button", async () => {
    render(<ListsPage />);
    await userEvent.click(screen.getByRole("button", { name: "New list" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("editing a list from the index", () => {
  const dialog = () => screen.queryByRole("dialog");

  it("opens the list in a dialog when its name is clicked, without leaving the page", async () => {
    render(<ListsPage />);
    await userEvent.click(screen.getByRole("link", { name: "Watchlist" }));

    expect(screen.getByRole("dialog", { name: "Watchlist" })).toBeInTheDocument();
    expect(getList).toHaveBeenCalledWith("l2", expect.anything());
    // The table is still there behind it.
    expect(screen.getByRole("link", { name: "Blocked terminals" })).toBeInTheDocument();
  });

  it("leaves a modified click to the browser, so a new tab still works", async () => {
    render(<ListsPage />);
    const link = screen.getByRole("link", { name: "Watchlist" });
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      // `fireEvent` returns false when the handler prevented the default.
      expect(fireEvent.click(link, modifier)).toBe(true);
    }
    expect(dialog()).not.toBeInTheDocument();
  });

  it("opens from the Edit button and loads that list", async () => {
    render(<ListsPage />);
    await userEvent.click(within(rowFor("Blocked terminals")).getByRole("button", { name: "Edit" }));
    expect(await screen.findByDisplayValue("Blocked terminals")).toBeInTheDocument();
    expect(getList).toHaveBeenCalledWith("l1", expect.anything());
  });

  it("opens somebody else's list read-only from View", async () => {
    render(<ListsPage />);
    await userEvent.click(within(rowFor("Watchlist")).getByRole("button", { name: "View" }));
    expect(await screen.findByDisplayValue("Watchlist")).toBeDisabled();
    expect(screen.getByText(/Only the person who made this list/)).toBeInTheDocument();
  });

  it("saves, closes, refreshes and says what was kept, marking the row", async () => {
    updateList.mockResolvedValue({
      ...detail("l1"),
      received: 4,
      kept: 3,
      duplicates_dropped: 1,
    });
    render(<ListsPage />);
    await userEvent.click(within(rowFor("Blocked terminals")).getByRole("button", { name: "Edit" }));
    await screen.findByDisplayValue("Blocked terminals");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(reload).toHaveBeenCalled();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Saved");
    expect(status).toHaveTextContent("Blocked terminals");
    expect(status).toHaveTextContent("3 items kept, 1 duplicate was dropped");
    expect(status).toHaveTextContent("pick up the change on their next poll");
    expect(rowFor("Blocked terminals")).toHaveClass("bg-accent-soft");
  });

  it("deletes, closes, refreshes and confirms, with no row left to mark", async () => {
    // "Watchlist" is used by no rule, so it can be deleted; an administrator may
    // delete a list somebody else made.
    signedInAs.current = person({ id: "u2", role: "admin" });
    render(<ListsPage />);
    await userEvent.click(within(rowFor("Watchlist")).getByRole("button", { name: "Edit" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(deleteList).toHaveBeenCalledWith("l2");
    expect(reload).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/Deleted.*Watchlist/);
    expect(document.querySelector(".bg-accent-soft")).toBeNull();
  });

  it("confirms nothing when it is closed without saving", async () => {
    render(<ListsPage />);
    await userEvent.click(screen.getByRole("link", { name: "Watchlist" }));
    await screen.findByDisplayValue("Watchlist");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(dialog()).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("opens already when the old /lists/<id> link redirects here, and strips the flag on close", async () => {
    search.current = "open=l2";
    render(<ListsPage />);
    expect(await screen.findByDisplayValue("Watchlist")).toBeInTheDocument();
    expect(getList).toHaveBeenCalledWith("l2", expect.anything());

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(replace).toHaveBeenCalledWith("/lists");
  });

  it("does not touch the URL when it was opened by a click", async () => {
    render(<ListsPage />);
    await userEvent.click(screen.getByRole("link", { name: "Watchlist" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(replace).not.toHaveBeenCalled();
  });

  it("opens the created list from the banner's Open list link", async () => {
    render(<ListsPage />);
    await userEvent.click(screen.getByRole("button", { name: "New list" }));
    await userEvent.type(screen.getByLabelText("Name"), "Fresh list");
    await userEvent.type(screen.getByLabelText("Items"), "a");
    await userEvent.click(screen.getByRole("button", { name: "Create list" }));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());

    listsState.current = {
      ...listsState.current,
      lists: [...listsState.current.lists, summary({ id: "l9", name: "Fresh list" })],
    };
    await userEvent.click(screen.getByRole("link", { name: "Open list" }));
    expect(await screen.findByDisplayValue("Fresh list")).toBeInTheDocument();
    expect(getList).toHaveBeenCalledWith("l9", expect.anything());
  });
});
