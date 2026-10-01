import { Suspense } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionFlagged, FlaggedQuery, UserRead } from "@/contracts/api";
import { ConnectionsProvider } from "@/services/connections/ConnectionsContext";
import { FlaggedProvider } from "@/services/flagged/FlaggedContext";
import FlaggedPage from "./page";

/**
 * A published query's findings reach everyone who can see the chart. What a
 * viewer may do with them is look, and dismiss for themselves: dismissals are
 * personal, so Dismiss and Restore stay. Clearing the queue and editing or
 * deleting the rules would change the owner's query for everyone, so those are
 * not offered. The engine refuses them too; this is what the person is offered
 * meanwhile.
 */

const getConnectionFlagged = vi.hoisted(() => vi.fn());
const dismissFlaggedRows = vi.hoisted(() => vi.fn());
const restoreFlaggedRows = vi.hoisted(() => vi.fn());
const role = vi.hoisted(() => ({ value: "analyst" as "admin" | "analyst" }));

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return {
    ...actual,
    getConnectionFlagged,
    dismissFlaggedRows,
    restoreFlaggedRows,
    refreshConnectionFlagged: vi.fn(),
    putFlagRules: vi.fn(),
    listConnections: vi.fn().mockResolvedValue([]),
    getFlaggedSummary: vi.fn().mockResolvedValue({ connections: [], queries: [], flagged_count: 0 }),
    deleteFlaggedRows: vi.fn().mockResolvedValue({ query_id: "q1", changed: 0 }),
  };
});

vi.mock("@/services/auth/AuthContext", () => ({
  useOptionalUser: (): UserRead => ({
    id: role.value === "admin" ? "u1" : "u2",
    email: `${role.value}@example.com`,
    full_name: role.value,
    role: role.value,
    is_active: true,
    must_change_password: false,
    last_login_at: null,
    created_at: "2026-10-01T00:00:00Z",
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/connections/c1/flagged",
}));

const finding = (index: number, fingerprint: string) => ({
  index,
  rule_ids: ["r1"],
  rule_names: ["Large"],
  values: ["2026-10-01", 900 + index],
  fingerprint,
  severity: "high" as const,
  first_seen_at: "2026-10-01T08:00:00Z",
  last_seen_at: "2026-10-01T09:00:00Z",
});

const section = (over: Partial<FlaggedQuery> = {}): FlaggedQuery => ({
  query_id: "q1",
  query_name: "Large transfers",
  columns: ["day", "amount"],
  rows: [finding(0, "a".repeat(64)), finding(1, "b".repeat(64))],
  rules: [{ id: "r1", name: "Large", severity: "high", matched: 2 }],
  warnings: [],
  flagged_count: 2,
  dismissed_count: 0,
  executed_at: "2026-10-01T09:00:00Z",
  stale: false,
  error_code: null,
  error_message: null,
  ...over,
});

const sharedSection = (over: Partial<FlaggedQuery> = {}) =>
  section({ query_id: "qs", query_name: "Declines by bank", shared: true, owner_name: "Grace Hopper", ...over });

const payload = (queries: FlaggedQuery[]): ConnectionFlagged => ({
  connection_id: "c1",
  queries,
  flagged_count: queries.reduce((n, q) => n + q.flagged_count, 0),
  dismissed_count: 0,
  refreshed: false,
  refresh_truncated: false,
});

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

const panelOf = (name: string) =>
  screen.getByRole("heading", { name: new RegExp(name) }).closest("section") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  role.value = "analyst";
  getConnectionFlagged.mockResolvedValue(payload([section(), sharedSection()]));
  dismissFlaggedRows.mockResolvedValue({ query_id: "qs", changed: 1 });
  restoreFlaggedRows.mockResolvedValue({ query_id: "qs", changed: 1 });
});

describe("a section shared with you", () => {
  it("says who shares it, and that dismissing is yours alone", async () => {
    await open();
    await waitFor(() => expect(screen.getByText("Declines by bank")).toBeInTheDocument());

    const shared = panelOf("Declines by bank");
    expect(shared).toHaveTextContent("Shared by Grace Hopper");
    expect(shared).toHaveTextContent("hides it for you only");
  });

  it("lets a viewer dismiss a row, by fingerprint", async () => {
    await open();
    await waitFor(() => expect(screen.getByText("Declines by bank")).toBeInTheDocument());

    await userEvent.click(
      within(panelOf("Declines by bank")).getByRole("button", { name: /dismiss flagged row 2/i }),
    );
    expect(dismissFlaggedRows).toHaveBeenCalledWith("qs", ["b".repeat(64)]);
  });

  it("lets a viewer dismiss the whole section for themselves", async () => {
    await open();
    await waitFor(() => expect(screen.getByText("Declines by bank")).toBeInTheDocument());

    await userEvent.click(within(panelOf("Declines by bank")).getByRole("button", { name: /dismiss all 2/i }));
    expect(dismissFlaggedRows).toHaveBeenCalledWith("qs", ["a".repeat(64), "b".repeat(64)]);
  });

  it("lets a viewer restore what they dismissed", async () => {
    getConnectionFlagged.mockResolvedValue(payload([sharedSection({ dismissed_count: 3 })]));
    await open();
    await waitFor(() => expect(screen.getByText("Declines by bank")).toBeInTheDocument());

    await userEvent.click(within(panelOf("Declines by bank")).getByRole("button", { name: "Restore 3" }));
    expect(restoreFlaggedRows).toHaveBeenCalledWith("qs");
  });

  it("offers a viewer nothing that would change the owner's query", async () => {
    await open();
    await waitFor(() => expect(screen.getByText("Declines by bank")).toBeInTheDocument());

    const shared = panelOf("Declines by bank");
    for (const name of [/^Clear$/, /Delete rules/, /Edit rules/]) {
      expect(within(shared).queryByRole("button", { name })).not.toBeInTheDocument();
      expect(within(shared).queryByRole("link", { name })).not.toBeInTheDocument();
    }
    expect(within(shared).queryByRole("link", { name: /Edit rules/ })).toBeNull();
  });

  it("falls back to a neutral label when the owner's name is not sent", async () => {
    getConnectionFlagged.mockResolvedValue(payload([sharedSection({ owner_name: null })]));
    await open();
    await waitFor(() => expect(screen.getByText("Declines by bank")).toBeInTheDocument());
    expect(panelOf("Declines by bank")).toHaveTextContent("Shared by its owner");
  });
});

describe("your own section, next to a shared one", () => {
  it("keeps every control, and carries no shared label", async () => {
    await open();
    await waitFor(() => expect(screen.getByText("Large transfers")).toBeInTheDocument());

    const own = panelOf("Large transfers");
    expect(own).not.toHaveTextContent("Shared by");
    expect(within(own).getByRole("button", { name: /^Clear$/ })).toBeInTheDocument();
    expect(within(own).getByRole("button", { name: /Delete rules/ })).toBeInTheDocument();
    expect(within(own).getByRole("link", { name: /Edit rules/ })).toHaveAttribute("href", "/queries/q1");
  });

  it("treats an engine that does not send `shared` as your own", async () => {
    getConnectionFlagged.mockResolvedValue(payload([section()]));
    await open();
    await waitFor(() => expect(screen.getByText("Large transfers")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Edit rules/ })).toBeInTheDocument();
  });
});

describe("an administrator", () => {
  it("keeps every control on a shared section, since they may change anyone's query", async () => {
    role.value = "admin";
    await open();
    await waitFor(() => expect(screen.getByText("Declines by bank")).toBeInTheDocument());

    const shared = panelOf("Declines by bank");
    expect(shared).toHaveTextContent("Shared by Grace Hopper");
    expect(within(shared).getByRole("button", { name: /^Clear$/ })).toBeInTheDocument();
    expect(within(shared).getByRole("link", { name: /Edit rules/ })).toBeInTheDocument();
  });
});
