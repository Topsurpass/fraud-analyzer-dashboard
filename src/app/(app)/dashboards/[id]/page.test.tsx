import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardRead, SavedQueryRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { DashboardsProvider } from "@/services/dashboards";
import DashboardPage from "./page";

/**
 * The board is fetched by id, not read out of the rail's list.
 *
 * That distinction is invisible on the machine that created the board and the
 * whole story on any other one, so it gets its own tests: a deep link must
 * resolve from `GET /dashboards/{id}` alone, with an empty list beside it.
 */

const getDashboard = vi.hoisted(() => vi.fn());
const getQuery = vi.hoisted(() => vi.fn());
const listDashboards = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return {
    ...actual,
    getDashboard,
    getQuery,
    listDashboards,
    createDashboard: vi.fn(),
    updateDashboard: vi.fn(),
    deleteDashboard: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboards/d1",
}));

// The card owns a poll loop of its own; this page's job is only to hand it a
// query, so the real one would test the wrong thing here.
vi.mock("@/components/ChartCard", () => ({
  ChartCard: ({ query }: { query: SavedQueryRead }) => (
    <article aria-label={query.name}>{query.name}</article>
  ),
}));

const board = (over: Partial<DashboardRead> = {}): DashboardRead => ({
  id: "d1",
  name: "Chargebacks",
  query_ids: ["q1"],
  created_at: "2026-08-23T09:00:00",
  updated_at: "2026-08-23T09:00:00",
  ...over,
});

const query = (over: Partial<SavedQueryRead> = {}): SavedQueryRead =>
  ({
    id: "q1",
    connection_id: "c1",
    name: "Declines by hour",
    description: null,
    sql: "SELECT 1",
    chart_type: "line",
    chart_spec: null,
    poll_interval_ms: 5_000,
    created_at: "2026-08-23T09:00:00",
    updated_at: "2026-08-23T09:00:00",
    ...over,
  }) as SavedQueryRead;

// `params` is a promise the page unwraps with `use`, so the first commit
// suspends. Awaiting the act scope lets that settle before anything is queried.
async function open(id = "d1") {
  await act(async () => {
    render(
      <DashboardsProvider>
        <Suspense fallback={null}>
          <DashboardPage params={Promise.resolve({ id })} />
        </Suspense>
      </DashboardsProvider>,
    );
  });
}

beforeEach(() => {
  // The list is deliberately empty: this browser has never seen the board.
  listDashboards.mockReset().mockResolvedValue([]);
  getDashboard.mockReset().mockResolvedValue(board());
  getQuery.mockReset().mockResolvedValue(query());
});

describe("DashboardPage", () => {
  it("resolves a board the rail's list has never seen", async () => {
    await open();
    expect(await screen.findByText("Chargebacks")).toBeInTheDocument();
    expect(await screen.findByLabelText("Declines by hour")).toBeInTheDocument();
    expect(getDashboard).toHaveBeenCalledWith("d1", expect.anything());
  });

  it("says so when the engine does not have that board", async () => {
    getDashboard.mockRejectedValue(
      new ApiError({ kind: "http", status: 404, message: "no", url: "/dashboards/d1" }),
    );
    await open();
    expect(await screen.findByText("This dashboard does not exist")).toBeInTheDocument();
  });

  it("offers a retry when the board cannot be fetched at all", async () => {
    getDashboard.mockRejectedValue(
      new ApiError({ kind: "network", message: "down", url: "/dashboards/d1" }),
    );
    await open();
    expect(await screen.findByText("Could not load this dashboard")).toBeInTheDocument();
    // A transport failure is not a missing board, and must not read as one.
    expect(screen.queryByText("This dashboard does not exist")).not.toBeInTheDocument();
  });

  it("shows the empty state for a board with no cards on it", async () => {
    getDashboard.mockResolvedValue(board({ query_ids: [] }));
    await open();
    expect(await screen.findByText("This dashboard is empty")).toBeInTheDocument();
    expect(getQuery).not.toHaveBeenCalled();
  });

  it("refetches the board when a card resolves to a deleted query", async () => {
    getDashboard.mockResolvedValue(board({ query_ids: ["q1", "gone"] }));
    getQuery.mockImplementation((id: string) =>
      id === "gone"
        ? Promise.reject(
            new ApiError({ kind: "http", status: 404, message: "no", url: `/queries/${id}` }),
          )
        : Promise.resolve(query()),
    );

    await open();
    expect(await screen.findByLabelText("Declines by hour")).toBeInTheDocument();
    await waitFor(() => expect(getDashboard.mock.calls.length).toBeGreaterThan(1));
  });
});
