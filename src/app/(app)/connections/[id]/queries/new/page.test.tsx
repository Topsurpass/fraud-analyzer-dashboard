import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/services/api-client";
import { ListsProvider } from "@/lib/ListsContext";
import { ConnectionsProvider } from "@/services/connections/ConnectionsContext";
import NewQueryPage from "./page";

/**
 * Saving a new query writes three things in sequence and then navigates, and
 * the failure this pins is what the reader sees in between: the button said
 * "Saving…" until the destination finished rendering, which made a save that
 * had already succeeded look like a hang.
 */

const createQuery = vi.hoisted(() => vi.fn());
const updateQuery = vi.hoisted(() => vi.fn());
const putFlagRules = vi.hoisted(() => vi.fn());
const putQueryCharts = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
// One list to pick, so a rule that points at a list can be complete: an incomplete
// rule now stops the save before the engine is asked.
const WATCHLIST = vi.hoisted(() => ({
  id: "l1",
  name: "Watchlist",
  description: null,
  item_count: 3,
  rule_count: 0,
  created_by: null,
  created_by_name: null,
  created_at: "2026-08-24T09:00:00Z",
  updated_at: "2026-08-24T09:00:00Z",
}));

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return {
    ...actual,
    createQuery,
    updateQuery,
    putFlagRules,
    putQueryCharts,
    listConnections: vi.fn().mockResolvedValue([]),
    listLists: vi.fn().mockResolvedValue([WATCHLIST]),
    previewQuery: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/connections/c1/queries/new",
}));

vi.mock("@/components/SchemaBrowser", () => ({ SchemaBrowser: () => <div /> }));

async function open() {
  await act(async () => {
    render(
      <ConnectionsProvider>
        <ListsProvider>
          <Suspense fallback={null}>
            <NewQueryPage params={Promise.resolve({ id: "c1" })} />
          </Suspense>
        </ListsProvider>
      </ConnectionsProvider>,
    );
  });
}

async function fillAndSave() {
  await userEvent.type(screen.getByLabelText("Name"), "Declines");
  await userEvent.type(screen.getByLabelText(/Read-only SQL/i), "SELECT 1 AS n");
  await userEvent.click(screen.getByRole("button", { name: /save query/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  createQuery.mockResolvedValue({ id: "q1" });
  updateQuery.mockResolvedValue({ id: "q1" });
  putFlagRules.mockResolvedValue({ query_id: "q1", rules: [] });
  putQueryCharts.mockResolvedValue({ query_id: "q1", charts: [] });
});

describe("saving a new query", () => {
  it("writes the query and then its charts", async () => {
    await open();
    await fillAndSave();

    await waitFor(() => expect(createQuery).toHaveBeenCalled());
    await waitFor(() => expect(putQueryCharts).toHaveBeenCalledWith("q1", expect.any(Array)));
  });

  it("says it saved while the next page is still resolving", async () => {
    // The bug: the label stayed on "Saving…" until the destination rendered,
    // so a save that had already landed was indistinguishable from a hang.
    await open();
    await fillAndSave();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /saved · opening/i })).toBeInTheDocument(),
    );
  });

  it("navigates once everything is written", async () => {
    await open();
    await fillAndSave();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/connections/c1"));
  });

  it("does not navigate, and re-enables the form, when the write fails", async () => {
    putQueryCharts.mockRejectedValue(
      new ApiError({ kind: "http", status: 500, message: "boom", url: "/charts" }),
    );
    await open();
    await fillAndSave();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save query/i })).toBeEnabled(),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("does not write charts before the query exists", async () => {
    // The query has no id until the POST returns, so the order is the contract.
    const order: string[] = [];
    createQuery.mockImplementation(async () => {
      order.push("query");
      return { id: "q1" };
    });
    putQueryCharts.mockImplementation(async () => {
      order.push("charts");
      return { query_id: "q1", charts: [] };
    });

    await open();
    await fillAndSave();
    await waitFor(() => expect(order).toEqual(["query", "charts"]));
  });

  describe("when the rules are refused after the query was created", () => {
    // A rule naming a list deleted in another tab is the reachable case: the
    // query POST succeeds and the rules PUT answers 404 LIST_NOT_FOUND.
    const gone = () =>
      new ApiError({
        kind: "http",
        status: 404,
        errorCode: "LIST_NOT_FOUND",
        message: "No list with id 'abc'.",
        url: "/queries/q1/flag-rules",
      });

    // Rules are written in a dialog and applied to the page. The rule is complete
    // (a column, a comparison and a list), because an incomplete one is stopped
    // before the engine is asked, and this case is about the engine's answer.
    async function addListRule() {
      await userEvent.click(screen.getByRole("button", { name: "Add a rule" }));
      await userEvent.click(await screen.findByRole("button", { name: "Add rule" }));
      await userEvent.type(screen.getByLabelText("Column"), "terminal");
      await userEvent.selectOptions(screen.getByLabelText("Comparison"), "in_list");
      await userEvent.selectOptions(await screen.findByLabelText("List"), "l1");
      await userEvent.click(screen.getByRole("button", { name: "Use these rules" }));
    }

    it("says what to do rather than printing the engine's id", async () => {
      putFlagRules.mockRejectedValue(gone());
      await open();
      await addListRule();
      await fillAndSave();
      expect(await screen.findByText(/no longer exists\. Pick another list\./)).toBeInTheDocument();
      expect(screen.queryByText(/No list with id/)).not.toBeInTheDocument();
    });

    it("retries against the same query and never creates a second one", async () => {
      putFlagRules.mockRejectedValueOnce(gone());
      await open();
      await addListRule();
      await fillAndSave();
      await screen.findByText(/no longer exists/);
      expect(createQuery).toHaveBeenCalledTimes(1);

      await userEvent.click(screen.getByRole("button", { name: /save query/i }));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/connections/c1"));

      expect(createQuery).toHaveBeenCalledTimes(1);
      expect(updateQuery).toHaveBeenCalledTimes(1);
      expect(updateQuery.mock.calls[0][0]).toBe("q1");
      expect(putFlagRules).toHaveBeenCalledTimes(2);
      expect(putFlagRules.mock.calls[1][0]).toBe("q1");
    });

    it("writes edits made after the failure, since the query already exists", async () => {
      putFlagRules.mockRejectedValueOnce(gone());
      await open();
      await addListRule();
      await fillAndSave();
      await screen.findByText(/no longer exists/);

      await userEvent.type(screen.getByLabelText("Name"), " v2");
      await userEvent.click(screen.getByRole("button", { name: /save query/i }));
      await waitFor(() => expect(updateQuery).toHaveBeenCalled());
      expect(updateQuery.mock.calls[0][1].name).toBe("Declines v2");
      expect(createQuery).toHaveBeenCalledTimes(1);
    });
  });
});
