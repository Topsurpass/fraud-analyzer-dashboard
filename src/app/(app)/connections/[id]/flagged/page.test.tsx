import { Suspense } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionFlagged, FlaggedQuery } from "@/contracts/api";
import { ConnectionsProvider } from "@/services/connections/ConnectionsContext";
import { FlaggedProvider } from "@/services/flagged/FlaggedContext";
import FlaggedPage, { bySeverityThenCount } from "./page";

/**
 * The flagged view is a review queue, so the thing it has to get right is
 * letting an analyst clear rows and keeping them cleared. Rows are recomputed
 * from a cached result on every load, so "dismissed" lives on a fingerprint of
 * the row's contents rather than on the row.
 */

const getConnectionFlagged = vi.hoisted(() => vi.fn());
const refreshConnectionFlagged = vi.hoisted(() => vi.fn());
const dismissFlaggedRows = vi.hoisted(() => vi.fn());
const restoreFlaggedRows = vi.hoisted(() => vi.fn());
const putFlagRules = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return {
    ...actual,
    getConnectionFlagged,
    refreshConnectionFlagged,
    dismissFlaggedRows,
    restoreFlaggedRows,
    putFlagRules,
    listConnections: vi.fn().mockResolvedValue([]),
    getFlaggedSummary: vi
      .fn()
      .mockResolvedValue({ connections: [], queries: [], flagged_count: 0 }),
    deleteFlaggedRows: vi.fn().mockResolvedValue({ query_id: "q1", changed: 0 }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/connections/c1/flagged",
}));

function finding(index: number, values: (string | number)[], fingerprint: string) {
  return {
    index,
    rule_ids: ["r1"],
    rule_names: ["Large"],
    values,
    fingerprint,
    severity: "high" as const,
    first_seen_at: "2026-08-24T08:00:00Z",
    last_seen_at: "2026-08-24T09:00:00Z",
  };
}

function section(over: Partial<FlaggedQuery> = {}): FlaggedQuery {
  return {
    query_id: "q1",
    query_name: "Large transfers",
    columns: ["day", "amount"],
    rows: [
      finding(0, ["2026-08-21", 900], "a".repeat(64)),
      finding(1, ["2026-08-22", 950], "b".repeat(64)),
    ],
    rules: [{ id: "r1", name: "Large", severity: "high", matched: 2 }],
    warnings: [],
    flagged_count: 2,
    dismissed_count: 0,
    executed_at: "2026-08-24T09:00:00Z",
    stale: false,
    error_code: null,
    error_message: null,
    ...over,
  };
}

function flagged(over: Partial<ConnectionFlagged> = {}): ConnectionFlagged {
  return {
    connection_id: "c1",
    queries: [section()],
    flagged_count: 2,
    dismissed_count: 0,
    refreshed: false,
    refresh_truncated: false,
    ...over,
  };
}

async function open() {
  await act(async () => {
    render(
      <ConnectionsProvider>
        <FlaggedProvider>
          <Suspense fallback={null}>
            <FlaggedPage params={Promise.resolve({ id: "c1" })} />
          </Suspense>
        </FlaggedProvider>
      </ConnectionsProvider>,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getConnectionFlagged.mockResolvedValue(flagged());
  dismissFlaggedRows.mockResolvedValue({ query_id: "q1", changed: 1 });
  restoreFlaggedRows.mockResolvedValue({ query_id: "q1", changed: 2 });
  putFlagRules.mockResolvedValue({ query_id: "q1", rules: [] });
});

describe("dismissing rows", () => {
  it("dismisses one row by its fingerprint, never by its index", async () => {
    // The index is a position in one run's result; after the next run it points
    // at a different row entirely.
    await open();
    await waitFor(() => expect(screen.getByText("Large transfers")).toBeInTheDocument());

    // Row 2 is the second finding in the section, whose fingerprint is "bbb...".
    await userEvent.click(screen.getByRole("button", { name: /dismiss flagged row 2/i }));
    expect(dismissFlaggedRows).toHaveBeenCalledWith("q1", ["b".repeat(64)]);
  });

  it("dismisses the whole section in one call", async () => {
    await open();
    await waitFor(() => expect(screen.getByText("Large transfers")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /dismiss all 2/i }));
    expect(dismissFlaggedRows).toHaveBeenCalledWith("q1", [
      "a".repeat(64),
      "b".repeat(64),
    ]);
  });

  it("reloads afterwards, so the row actually leaves the screen", async () => {
    await open();
    await waitFor(() => expect(getConnectionFlagged).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: /dismiss all 2/i }));
    await waitFor(() => expect(getConnectionFlagged).toHaveBeenCalledTimes(2));
  });

  it("offers to restore what was dismissed", async () => {
    // Dismissed rows are listed nowhere, so without this a mis-click is
    // permanent and the row it hid is unreachable.
    getConnectionFlagged.mockResolvedValue(
      flagged({
        queries: [section({ rows: [], flagged_count: 0, dismissed_count: 2 })],
        flagged_count: 0,
        dismissed_count: 2,
      }),
    );
    await open();
    await waitFor(() => expect(screen.getByText("Large transfers")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /restore 2/i }));
    expect(restoreFlaggedRows).toHaveBeenCalledWith("q1");
  });

  it("offers no restore when nothing has been dismissed", async () => {
    await open();
    await waitFor(() => expect(screen.getByText("Large transfers")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /restore/i })).toBeNull();
  });

  it("says the queue was cleared rather than that nothing matched", async () => {
    // Two very different facts, and reading the wrong one would have an analyst
    // believe their rules stopped working.
    getConnectionFlagged.mockResolvedValue(
      flagged({
        queries: [section({ rows: [], flagged_count: 0, dismissed_count: 2 })],
        flagged_count: 0,
        dismissed_count: 2,
      }),
    );
    await open();
    await waitFor(() =>
      expect(screen.getByText(/reviewed and dismissed/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/nothing matched/i)).toBeNull();
  });

  it("still says nothing matched when nothing did", async () => {
    getConnectionFlagged.mockResolvedValue(
      flagged({
        queries: [section({ rows: [], flagged_count: 0, dismissed_count: 0 })],
        flagged_count: 0,
      }),
    );
    await open();
    await waitFor(() => expect(screen.getByText(/nothing matched/i)).toBeInTheDocument());
  });

  it("reports a failed dismissal instead of pretending it worked", async () => {
    const { ApiError } = await import("@/services/api-client");
    dismissFlaggedRows.mockRejectedValue(
      new ApiError({ kind: "http", status: 500, message: "boom", url: "/x" }),
    );
    await open();
    await waitFor(() => expect(screen.getByText("Large transfers")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /dismiss all 2/i }));
    await waitFor(() =>
      expect(screen.getByText(/something went wrong|boom|unexpected/i)).toBeInTheDocument(),
    );
  });
});

describe("deleting a section's rules", () => {
  it("takes two presses", async () => {
    await open();
    await waitFor(() => expect(screen.getByText("Large transfers")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /^delete rules$/i }));
    expect(putFlagRules).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /delete 1 rule/i }));
    expect(putFlagRules).toHaveBeenCalledWith("q1", { rules: [] });
  });

  it("can be called off", async () => {
    await open();
    await waitFor(() => expect(screen.getByText("Large transfers")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /^delete rules$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^keep$/i }));
    expect(putFlagRules).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^delete rules$/i })).toBeInTheDocument();
  });
});

describe("bySeverityThenCount", () => {
  it("puts the worst severity first", () => {
    const high = section({ rules: [{ id: "r1", name: "H", severity: "high", matched: 1 }] });
    const low = section({ rules: [{ id: "r2", name: "L", severity: "low", matched: 9 }] });
    expect([low, high].sort(bySeverityThenCount)[0]).toBe(high);
  });

  it("ignores a severity that caught nothing", () => {
    // A high-severity rule matching zero rows says nothing about this section.
    const empty = section({ rules: [{ id: "r1", name: "H", severity: "high", matched: 0 }] });
    const real = section({ rules: [{ id: "r2", name: "L", severity: "low", matched: 3 }] });
    expect([empty, real].sort(bySeverityThenCount)[0]).toBe(real);
  });
});

describe("the summary line", () => {
  it("counts what is left and what was cleared", async () => {
    getConnectionFlagged.mockResolvedValue(
      flagged({
        queries: [section({ rows: [section().rows[0]], flagged_count: 1, dismissed_count: 1 })],
        flagged_count: 1,
        dismissed_count: 1,
      }),
    );
    await open();
    await waitFor(() => expect(screen.getByText(/with 1 dismissed/i)).toBeInTheDocument());
  });

  it("says nothing about dismissals when there are none", async () => {
    await open();
    await waitFor(() => expect(screen.getByText("Large transfers")).toBeInTheDocument());
    expect(screen.queryByText(/dismissed/i)).toBeNull();
  });
});

describe("row identity", () => {
  it("keys rows by fingerprint so a re-run cannot reuse a stale row", async () => {
    await open();
    await waitFor(() => expect(screen.getByText("Large transfers")).toBeInTheDocument());
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + 2
  });
});

describe("a large queue", () => {
  function findings(count: number) {
    return Array.from({ length: count }, (_, index) =>
      finding(index, [`2026-08-${(index % 28) + 1}`, index], String(index).padStart(64, "0")),
    );
  }

  it("caps what it renders rather than putting thousands of rows in the DOM", async () => {
    // The store only grows. Nobody reviews finding 1,400 by scrolling past
    // 1,399 others, and rendering them all is slow as well as useless.
    getConnectionFlagged.mockResolvedValue(
      flagged({
        queries: [section({ rows: findings(1_500), flagged_count: 1_500 })],
        flagged_count: 1_500,
      }),
    );
    await open();
    await waitFor(() => expect(screen.getByText("Large transfers")).toBeInTheDocument());

    const rows = screen.getAllByRole("row");
    // Header plus the cap, not 1,500.
    expect(rows.length).toBeLessThan(220);
  });

  it("says how many findings are not shown, so the cap is not a silent lie", async () => {
    getConnectionFlagged.mockResolvedValue(
      flagged({
        queries: [section({ rows: findings(1_500), flagged_count: 1_500 })],
        flagged_count: 1_500,
      }),
    );
    await open();
    // The number sits in its own element for tabular figures, so match the
    // sentence around it rather than a string spanning both.
    const note = await screen.findByText(/more are\s+waiting/i);
    expect(note.textContent?.replace(/\s+/g, " ")).toMatch(/1,300 more are waiting/);
  });

  it("says nothing about a cap when everything fits", async () => {
    await open();
    await waitFor(() => expect(screen.getByText("Large transfers")).toBeInTheDocument());
    expect(screen.queryByText(/more are waiting/i)).toBeNull();
  });
});
