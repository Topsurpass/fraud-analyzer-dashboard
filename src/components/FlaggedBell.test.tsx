import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsProvider } from "@/services/connections/ConnectionsContext";
import { FlaggedProvider } from "@/services/flagged/FlaggedContext";
import { FlaggedBell } from "./FlaggedBell";

/**
 * The bell exists so nobody has to open the flagged view to find out whether
 * anything is in it. Most of these are about the difference between "there is
 * a queue" and "something new arrived", which is the only part that earns
 * attention.
 */

const getFlaggedSummary = vi.hoisted(() => vi.fn());
const listConnections = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return { ...actual, getFlaggedSummary, listConnections };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));

const NEWEST = "2026-08-24T10:00:00Z";

function summary(over: Record<string, unknown> = {}) {
  return {
    connections: [
      {
        connection_id: "c1",
        connection_name: "Payments",
        flagged_count: 4,
        severity: "high",
        newest_first_seen_at: NEWEST,
      },
    ],
    queries: [],
    flagged_count: 4,
    newest_first_seen_at: NEWEST,
    ...over,
  };
}

function open() {
  return render(
    <ConnectionsProvider>
      <FlaggedProvider>
        <FlaggedBell />
      </FlaggedProvider>
    </ConnectionsProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  listConnections.mockResolvedValue([
    { id: "c1", name: "Payments", db_type: "postgres", status: "ok" },
  ]);
  getFlaggedSummary.mockResolvedValue(summary());
});

describe("the count", () => {
  it("shows how many rows are waiting", async () => {
    open();
    await waitFor(() => expect(screen.getByText("4")).toBeInTheDocument());
  });

  it("shows no number at all when nothing is flagged", async () => {
    getFlaggedSummary.mockResolvedValue(
      summary({ connections: [], flagged_count: 0, newest_first_seen_at: null }),
    );
    open();
    await waitFor(() => expect(getFlaggedSummary).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /nothing flagged/i })).toBeInTheDocument();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("caps a very large queue rather than breaking the layout", async () => {
    getFlaggedSummary.mockResolvedValue(summary({ flagged_count: 5000 }));
    open();
    await waitFor(() => expect(screen.getByText("99+")).toBeInTheDocument());
  });
});

describe("new since you last looked", () => {
  it("reads as new when this browser has never acknowledged anything", async () => {
    open();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /new since you last looked/i })).toBeInTheDocument(),
    );
  });

  it("stops reading as new once opened", async () => {
    open();
    const bell = await screen.findByRole("button", { name: /new since you last looked/i });
    await userEvent.click(bell);
    expect(
      screen.getByRole("button", { name: /4 flagged rows$/i }),
    ).toBeInTheDocument();
  });

  it("remembers that across a remount", async () => {
    const first = open();
    await userEvent.click(await screen.findByRole("button", { name: /flagged/i }));
    first.unmount();

    open();
    await waitFor(() => expect(screen.getAllByText("4").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /new since/i })).toBeNull();
  });

  it("reads as new again when something newer arrives", async () => {
    // The case a count cannot catch: dismiss two, gain two, and the total has
    // not moved while something new has still arrived.
    const first = open();
    await userEvent.click(await screen.findByRole("button", { name: /flagged/i }));
    first.unmount();

    getFlaggedSummary.mockResolvedValue(
      summary({ newest_first_seen_at: "2026-08-24T11:00:00Z" }),
    );
    open();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /new since you last looked/i })).toBeInTheDocument(),
    );
  });

  it("is never new when nothing is flagged", async () => {
    getFlaggedSummary.mockResolvedValue(
      summary({ connections: [], flagged_count: 0, newest_first_seen_at: null }),
    );
    open();
    await waitFor(() => expect(getFlaggedSummary).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /new since/i })).toBeNull();
  });

  it("keeps nagging when storage is unavailable rather than going quiet", async () => {
    // Private windows and blocked site data both throw here. Failing towards
    // "still unseen" is the safe direction for something whose job is to nag.
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    try {
      open();
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /new since you last looked/i }),
        ).toBeInTheDocument(),
      );
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

describe("getting to the flagged view", () => {
  it("lists each connection holding findings, with a link", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: /flagged/i }));

    const link = screen.getByRole("link", { name: /Payments/ });
    expect(link).toHaveAttribute("href", "/connections/c1/flagged");
  });

  it("names the connection rather than showing its id", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: /flagged/i }));
    expect(screen.getByText("Payments")).toBeInTheDocument();
    expect(screen.queryByText("c1")).toBeNull();
  });

  it("says plainly when there is nothing to go and see", async () => {
    getFlaggedSummary.mockResolvedValue(
      summary({ connections: [], flagged_count: 0, newest_first_seen_at: null }),
    );
    open();
    await userEvent.click(await screen.findByRole("button", { name: /nothing flagged/i }));
    expect(screen.getByText(/nothing is flagged right now/i)).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: /flagged/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
