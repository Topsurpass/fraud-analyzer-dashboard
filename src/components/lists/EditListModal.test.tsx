import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemListRead, UserRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { EditListModal } from "./EditListModal";

const getList = vi.hoisted(() => vi.fn());
const updateList = vi.hoisted(() => vi.fn());
const deleteList = vi.hoisted(() => vi.fn());
const onClose = vi.hoisted(() => vi.fn());
const onChanged = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/services/api-client")>("@/services/api-client");
  return { ...actual, getList, updateList, deleteList };
});

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

const blocked = (detail: unknown, message: string) =>
  new ApiError({
    kind: "http",
    status: 409,
    errorCode: "LIST_IN_USE",
    message,
    url: "/lists/l1",
    detail,
  });

const element = (id: string | null) => (
  <EditListModal id={id} title="Blocked terminals" onClose={onClose} onChanged={onChanged} />
);

async function open(id = "l1") {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(element(id));
  });
  return view;
}

/** The delete section, which has a Cancel of its own beside the form's. */
const dangerZone = () => within(screen.getByRole("region", { name: "Delete this list" }));

beforeEach(() => {
  signedInAs.current = person();
  getList.mockReset().mockResolvedValue(stored());
  updateList.mockReset();
  deleteList.mockReset().mockResolvedValue(undefined);
  onClose.mockReset();
  onChanged.mockReset();
});

describe("the dialog", () => {
  it("is shut without an id, and open as a dialog named for the list with one", async () => {
    const view = render(element(null));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getList).not.toHaveBeenCalled();

    await act(async () => view.rerender(element("l1")));
    expect(screen.getByRole("dialog", { name: "Blocked terminals" })).toBeInTheDocument();
  });

  it("closes from Cancel and from the close button without saving", async () => {
    await open();
    await screen.findByDisplayValue("Blocked terminals");
    await userEvent.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1) as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(updateList).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("a list you made", () => {
  it("loads the list by id and fills the form, one item per line", async () => {
    await open();
    expect(await screen.findByDisplayValue("Blocked terminals")).toBeInTheDocument();
    expect((screen.getByLabelText("Items") as HTMLTextAreaElement).value).toBe("T-1\nT-2");
    expect(getList.mock.calls[0][0]).toBe("l1");
  });

  it("saves the whole list, then reports what the engine kept and closes", async () => {
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
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onChanged).toHaveBeenCalledWith({
      kind: "saved",
      id: "l1",
      name: "Blocked terminals",
      kept: 3,
      duplicatesDropped: 1,
    });
  });

  it("stays open with the reason, and reports nothing, when the name is taken", async () => {
    updateList.mockRejectedValue(
      new ApiError({ kind: "http", status: 409, errorCode: "LIST_NAME_TAKEN", message: "x", url: "" }),
    );
    await open();
    await screen.findByDisplayValue("Blocked terminals");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already has that name/i);
    expect(onChanged).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("asks twice before deleting, then deletes, reports it and closes", async () => {
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
    expect(deleteList).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(deleteList).toHaveBeenCalledWith("l1"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onChanged).toHaveBeenCalledWith({ kind: "deleted", id: "l1", name: "Blocked terminals" });
  });

  it("does not submit the form when a delete button is pressed", async () => {
    // The delete section sits inside the form; its buttons must not save it.
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
    await userEvent.click(dangerZone().getByRole("button", { name: "Cancel" }));
    expect(updateList).not.toHaveBeenCalled();
  });

  it("names the rules that block a delete, links to their queries, and stays open", async () => {
    deleteList.mockRejectedValue(
      blocked(
        {
          rules: [
            { rule_name: "Blocked terminal", query_id: "q1", query_name: "Transfers" },
            { rule_name: "Watch", query_id: "q2", query_name: "Cards" },
          ],
        },
        "This list is used by 2 rules.",
      ),
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
    expect(onClose).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    // Back to the first press, so a second delete needs a fresh confirmation.
    expect(screen.getByRole("button", { name: "Delete list" })).toBeInTheDocument();
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
    expect(onClose).not.toHaveBeenCalled();
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

  it("shows the blockers and locks the delete when a rule appeared since it loaded", async () => {
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

    await userEvent.click(dangerZone().getByRole("button", { name: "Cancel" }));
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
  it("shows the 403 on save and keeps what was typed, open", async () => {
    // The dialog thought the viewer owned it (a role or ownership change since
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
    expect(onChanged).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the 403 on delete, stays open, and offers the delete again", async () => {
    deleteList.mockRejectedValue(forbidden());
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/can change it/);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Blocked terminals")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete list" })).toBeEnabled();
  });
});

describe("a refresh that fails while the list is open", () => {
  it("keeps the form and reports the failure inline, with a retry", async () => {
    getList.mockResolvedValueOnce(stored({ rule_count: 1 }));
    await open();
    await screen.findByDisplayValue("Blocked terminals");

    getList.mockRejectedValue(new ApiError({ kind: "network", message: "x", url: "" }));
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));

    expect(await screen.findByText(/Could not refresh this list/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Blocked terminals")).toBeInTheDocument();
    expect(screen.queryByText("Could not load this list")).not.toBeInTheDocument();

    getList.mockResolvedValue(stored({ rule_count: 1 }));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.queryByText(/Could not refresh this list/)).not.toBeInTheDocument(),
    );
  });
});

describe("focus and state across reloads and other lists", () => {
  const racing = () => blocked({ list_id: "l1", rules: [], hidden_rule_count: 1 }, "in use");

  it("leaves focus on Delete list when the reload also changes updated_at", async () => {
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

  it("does not put the cursor in the name field when it opens", async () => {
    await open();
    expect(await screen.findByDisplayValue("Blocked terminals")).not.toHaveFocus();
  });

  it("never shows a confirmation nobody asked for when the count goes up then back to zero", async () => {
    // A failed refresh leaves the last count on screen and a Retry beside it.
    getList.mockResolvedValueOnce(stored()).mockRejectedValueOnce(
      new ApiError({ kind: "network", message: "x", url: "" }),
    );
    deleteList.mockRejectedValue(new ApiError({ kind: "network", message: "x", url: "" }));
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await screen.findByText(/Could not refresh this list/);

    // A confirmation is opened, then a retry finds that a rule now uses the list.
    await userEvent.click(screen.getByRole("button", { name: "Delete list" }));
    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeInTheDocument();
    getList.mockResolvedValue(stored({ rule_count: 1 }));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete list" })).toBeDisabled());
    expect(screen.queryByRole("button", { name: "Delete permanently" })).not.toBeInTheDocument();

    // The count returns to zero: the confirmation must not reappear by itself.
    getList.mockResolvedValue(stored({ rule_count: 0 }));
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete list" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Delete permanently" })).not.toBeInTheDocument();
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

  it("never shows the old list, its form or its refusal under a new id", async () => {
    deleteList.mockRejectedValue(forbidden());
    const view = await open("l1");
    await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await screen.findByRole("alert");

    let release!: (value: ItemListRead) => void;
    getList.mockReturnValue(new Promise<ItemListRead>((resolve) => (release = resolve)));
    await act(async () => view.rerender(element("l2")));
    // While l2 loads, nothing of l1 is on screen.
    expect(screen.queryByDisplayValue("Blocked terminals")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getList).toHaveBeenLastCalledWith("l2", expect.anything());

    await act(async () => release(stored({ id: "l2", name: "Other", items: ["x"] })));
    expect(await screen.findByDisplayValue("Other")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete permanently" })).not.toBeInTheDocument();
  });

  it("ignores a delete that fails after another list was opened", async () => {
    let fail!: (reason: unknown) => void;
    deleteList.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const view = await open("l1");
    await userEvent.click(await screen.findByRole("button", { name: "Delete list" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    getList.mockResolvedValue(stored({ id: "l2", name: "Other" }));
    await act(async () => view.rerender(element("l2")));
    await screen.findByDisplayValue("Other");

    await act(async () => fail(forbidden()));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete list" })).toBeEnabled();
  });
});

describe("a list that vanishes while open", () => {
  it("says it no longer exists, with a way out, instead of a refresh error", async () => {
    getList.mockResolvedValueOnce(stored({ rule_count: 1 }));
    await open();
    await screen.findByDisplayValue("Blocked terminals");
    getList.mockRejectedValue(
      new ApiError({ kind: "http", status: 404, errorCode: "LIST_NOT_FOUND", message: "x", url: "" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));

    expect(await screen.findByText("This list no longer exists")).toBeInTheDocument();
    expect(screen.queryByText(/Could not refresh this list/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1) as HTMLElement);
    expect(onClose).toHaveBeenCalled();
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
    // Nothing to import into, and a way out.
    expect(screen.queryByRole("button", { name: /Import from Excel/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("is editable and deletable by an administrator", async () => {
    signedInAs.current = person({ id: "u2", role: "admin" });
    await open();
    expect(await screen.findByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete list" })).toBeInTheDocument();
  });
});

describe("a list that cannot be loaded", () => {
  it("says it does not exist on a 404, with a retry and a way out", async () => {
    getList.mockRejectedValue(
      new ApiError({ kind: "http", status: 404, errorCode: "LIST_NOT_FOUND", message: "x", url: "" }),
    );
    await open();
    expect(await screen.findByText("Could not load this list")).toBeInTheDocument();
    expect(screen.getByText(/does not exist, or it was deleted/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1) as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });
});
