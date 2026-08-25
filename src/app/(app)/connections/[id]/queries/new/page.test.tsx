import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/services/api-client";
import { ConnectionsProvider } from "@/services/connections/ConnectionsContext";
import NewQueryPage from "./page";

/**
 * Saving a new query writes three things in sequence and then navigates, and
 * the failure this pins is what the reader sees in between: the button said
 * "Saving…" until the destination finished rendering, which made a save that
 * had already succeeded look like a hang.
 */

const createQuery = vi.hoisted(() => vi.fn());
const putFlagRules = vi.hoisted(() => vi.fn());
const putQueryCharts = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return {
    ...actual,
    createQuery,
    putFlagRules,
    putQueryCharts,
    listConnections: vi.fn().mockResolvedValue([]),
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
        <Suspense fallback={null}>
          <NewQueryPage params={Promise.resolve({ id: "c1" })} />
        </Suspense>
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
});
