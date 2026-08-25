import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FlagRuleSetRead, SavedQueryRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { ConnectionsProvider } from "@/services/connections/ConnectionsContext";
import { DashboardsProvider } from "@/services/dashboards";
import QueryPage from "./page";

/**
 * Flag rules live behind a second endpoint from the query itself, so this page
 * holds two resources that settle independently. Everything below is about that
 * seam: the editor seeds its rule state once at mount, so whatever the page has
 * loaded at that instant is what the analyst sees and edits.
 */

const getQuery = vi.hoisted(() => vi.fn());
const updateQuery = vi.hoisted(() => vi.fn());
const getFlagRules = vi.hoisted(() => vi.fn());
const putFlagRules = vi.hoisted(() => vi.fn());
const getQueryCharts = vi.hoisted(() => vi.fn());
const putQueryCharts = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return {
    ...actual,
    getQuery,
    updateQuery,
    getFlagRules,
    putFlagRules,
    getQueryCharts,
    putQueryCharts,
    deleteQuery: vi.fn(),
    listConnections: vi.fn().mockResolvedValue([]),
    listDashboards: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/queries/q1",
}));

// Both fetch on mount and neither is what these tests are about.
vi.mock("@/components/SchemaBrowser", () => ({
  SchemaBrowser: () => <div />,
}));
vi.mock("@/components/ExecutionLog", () => ({
  ExecutionLog: () => <div />,
}));

function savedQuery(over: Partial<SavedQueryRead> = {}): SavedQueryRead {
  return {
    id: "q1",
    connection_id: "c1",
    name: "smoke",
    description: null,
    sql_text: "SELECT amount FROM txns",
    table_hint: null,
    row_limit: 1000,
  charts: [],
    poll_interval_ms: 30000,
    created_at: "2026-08-24T09:00:00Z",
    updated_at: "2026-08-24T09:00:00Z",
    ...over,
  };
}

function ruleSet(value: string): FlagRuleSetRead {
  return {
    query_id: "q1",
    rules: [
      {
        id: "r1",
        query_id: "q1",
        name: "Large",
        severity: "high",
        enabled: true,
        position: 0,
        conditions: [
          { id: "c1", position: 0, column_name: "amount", operator: "gt", value, value2: null },
        ],
        created_at: "2026-08-24T09:00:00Z",
        updated_at: "2026-08-24T09:00:00Z",
      },
    ],
  };
}

// `params` is a promise the page unwraps with `use`, so the first commit
// suspends. The render has to happen inside the act scope for that to settle.
async function renderPage() {
  await act(async () => {
    render(
      <ConnectionsProvider>
        <DashboardsProvider>
          <Suspense fallback={null}>
            <QueryPage params={Promise.resolve({ id: "q1" })} />
          </Suspense>
        </DashboardsProvider>
      </ConnectionsProvider>,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getQuery.mockResolvedValue(savedQuery());
  updateQuery.mockResolvedValue(savedQuery({ updated_at: "2026-08-24T10:00:00Z" }));
  putFlagRules.mockResolvedValue(ruleSet("999"));
  getQueryCharts.mockResolvedValue({ query_id: "q1", charts: [] });
  putQueryCharts.mockResolvedValue({ query_id: "q1", charts: [] });
});

describe("saved flag rules on reopen", () => {
  it("shows the rules the query already has", async () => {
    getFlagRules.mockResolvedValue(ruleSet("500"));
    await renderPage();

    await waitFor(() =>
      expect(screen.getByLabelText("Rule name")).toHaveValue("Large"),
    );
    expect(screen.getByLabelText("Value")).toHaveValue("500");
  });

  it("says so when the rules cannot be loaded, instead of showing none", async () => {
    // An unreachable rules endpoint renders identically to a query that has no
    // rules, and the next save then wipes the rules that are actually stored.
    getFlagRules.mockRejectedValue(
      new ApiError({ kind: "http", status: 404, message: "Not Found", url: "/flag-rules" }),
    );
    await renderPage();

    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
  });

  it("waits for the rules before offering the editor at all", async () => {
    // The query and the rules settle independently. The editor seeds its rule
    // state once at mount, so mounting it on whichever lands first means either
    // seeding it empty or remounting later and discarding what was typed in
    // between. Neither is offered: there is nothing to type into until both are
    // in.
    let releaseRules: (() => void) | null = null;
    getFlagRules.mockImplementationOnce(
      () =>
        new Promise<FlagRuleSetRead>((resolve) => {
          releaseRules = () => resolve(ruleSet("500"));
        }),
    );

    await renderPage();
    await waitFor(() => expect(getQuery).toHaveBeenCalled());
    expect(screen.queryByLabelText("Name")).toBeNull();

    await act(async () => {
      releaseRules?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("smoke"));
    // Seeded with the rules on its first and only mount.
    expect(screen.getByLabelText("Value")).toHaveValue("500");
  });

  it("keeps an edited rule on screen after saving it", async () => {
    // The reported bug. The editor seeds rule state at mount, so a remount that
    // lands between the save and the rules reload restores the pre-save value
    // and the analyst watches their edit revert.
    getFlagRules.mockResolvedValueOnce(ruleSet("500"));
    // Saving bumps updated_at, which is what the page keyed the editor on.
    getQuery.mockResolvedValueOnce(savedQuery());
    getQuery.mockResolvedValue(savedQuery({ updated_at: "2026-08-24T10:00:00Z" }));
    let releaseReload: (() => void) | null = null;
    getFlagRules.mockImplementationOnce(
      () =>
        new Promise<FlagRuleSetRead>((resolve) => {
          releaseReload = () => resolve(ruleSet("999"));
        }),
    );

    await renderPage();
    await waitFor(() => expect(screen.getByLabelText("Value")).toHaveValue("500"));

    await userEvent.clear(screen.getByLabelText("Value"));
    await userEvent.type(screen.getByLabelText("Value"), "999");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(putFlagRules).toHaveBeenCalled());
    expect(putFlagRules.mock.calls[0][1].rules[0].conditions[0].value).toBe("999");

    // The query reloads first; the rules are still in flight.
    await waitFor(() => expect(getQuery).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Value")).toHaveValue("999");

    await act(async () => {
      releaseReload?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByLabelText("Value")).toHaveValue("999"));
  });
});
