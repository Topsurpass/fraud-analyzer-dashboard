import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { DashboardsProvider, findDashboard, useDashboards } from "./DashboardsContext";

const listDashboards = vi.hoisted(() => vi.fn());
const createDashboard = vi.hoisted(() => vi.fn());
const getDashboard = vi.hoisted(() => vi.fn());
const updateDashboard = vi.hoisted(() => vi.fn());
const deleteDashboard = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return {
    ...actual,
    listDashboards,
    createDashboard,
    getDashboard,
    updateDashboard,
    deleteDashboard,
  };
});

const board = (over: Partial<DashboardRead> = {}): DashboardRead => ({
  id: "d1",
  name: "Card testing",
  chart_ids: ["q1", "q2"],
  charts: [],
  created_at: "2026-08-23T09:00:00",
  updated_at: "2026-08-23T09:00:00",
  ...over,
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <DashboardsProvider>{children}</DashboardsProvider>;
}

const setup = () => renderHook(() => useDashboards(), { wrapper });

beforeEach(() => {
  listDashboards.mockReset().mockResolvedValue([board()]);
  createDashboard.mockReset().mockResolvedValue(board({ id: "new" }));
  // Membership changes read the board fresh rather than trusting the list, so
  // the read side needs its own answer here.
  getDashboard.mockReset().mockResolvedValue(board());
  updateDashboard.mockReset().mockResolvedValue(board());
  deleteDashboard.mockReset().mockResolvedValue(undefined);
});

describe("DashboardsProvider", () => {
  it("loads the boards the engine owns", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.initial).toBe(false));
    expect(result.current.dashboards.map((d) => d.name)).toEqual(["Card testing"]);
  });

  it("surfaces a load failure rather than pretending there are none", async () => {
    listDashboards.mockRejectedValue(
      new ApiError({ kind: "network", message: "down", url: "/x" }),
    );
    const { result } = setup();
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.displayMessage).toBe("Cannot reach engine");
  });

  it("creates a board and refetches", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.initial).toBe(false));

    await act(async () => {
      await result.current.create("  Chargebacks  ", ["q9"]);
    });

    // The name is normalized before it reaches the engine.
    expect(createDashboard).toHaveBeenCalledWith({
      name: "Chargebacks",
      chart_ids: ["q9"],
    });
    await waitFor(() => expect(listDashboards).toHaveBeenCalledTimes(2));
  });

  it("renames through the engine", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.initial).toBe(false));

    await act(async () => {
      await result.current.rename("d1", "Renamed");
    });
    expect(updateDashboard).toHaveBeenCalledWith("d1", { name: "Renamed" });
  });

  it("deletes through the engine", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.initial).toBe(false));

    await act(async () => {
      await result.current.remove("d1");
    });
    expect(deleteDashboard).toHaveBeenCalledWith("d1");
  });

  describe("membership", () => {
    it("sends the whole arrangement when adding, because PUT replaces it", async () => {
      const { result } = setup();
      await waitFor(() => expect(result.current.initial).toBe(false));

      await act(async () => {
        await result.current.addChartTo("d1", "q3");
      });
      expect(updateDashboard).toHaveBeenCalledWith("d1", {
        chart_ids: ["q1", "q2", "q3"],
      });
    });

    it("never adds the same query twice", async () => {
      const { result } = setup();
      await waitFor(() => expect(result.current.initial).toBe(false));

      await act(async () => {
        await result.current.addChartTo("d1", "q2");
      });
      expect(updateDashboard).toHaveBeenCalledWith("d1", { chart_ids: ["q1", "q2"] });
    });

    it("removes one without disturbing the rest", async () => {
      const { result } = setup();
      await waitFor(() => expect(result.current.initial).toBe(false));

      await act(async () => {
        await result.current.removeChartFrom("d1", "q1");
      });
      expect(updateDashboard).toHaveBeenCalledWith("d1", { chart_ids: ["q2"] });
    });

    it("reorders", async () => {
      const { result } = setup();
      await waitFor(() => expect(result.current.initial).toBe(false));

      await act(async () => {
        await result.current.moveQueryTo("d1", "q2", 0);
      });
      expect(updateDashboard).toHaveBeenCalledWith("d1", { chart_ids: ["q2", "q1"] });
    });

    it("changes a board this browser has never listed", async () => {
      // A link opened straight to a board created elsewhere: the list is empty
      // and the board is still perfectly real. Reading the order from the list
      // would make every action here silently do nothing.
      listDashboards.mockResolvedValue([]);
      getDashboard.mockResolvedValue(board({ id: "elsewhere", chart_ids: ["q9"] }));

      const { result } = setup();
      await waitFor(() => expect(result.current.initial).toBe(false));
      expect(result.current.dashboards).toEqual([]);

      await act(async () => {
        await result.current.addChartTo("elsewhere", "q3");
      });
      expect(updateDashboard).toHaveBeenCalledWith("elsewhere", {
        chart_ids: ["q9", "q3"],
      });
    });

    it("does not write when the board turns out to be gone", async () => {
      getDashboard.mockRejectedValue(
        new ApiError({ kind: "http", status: 404, message: "no", url: "/dashboards/absent" }),
      );
      const { result } = setup();
      await waitFor(() => expect(result.current.initial).toBe(false));

      await expect(
        act(async () => {
          await result.current.addChartTo("absent", "q3");
        }),
      ).rejects.toThrow();
      expect(updateDashboard).not.toHaveBeenCalled();
    });

    it("computes the next order from the engine, not from the cached list", async () => {
      // Another machine added a card after this browser listed the board. The
      // write must not drop it.
      getDashboard.mockResolvedValue(board({ chart_ids: ["q1", "q2", "added-elsewhere"] }));

      const { result } = setup();
      await waitFor(() => expect(result.current.initial).toBe(false));

      await act(async () => {
        await result.current.addChartTo("d1", "q3");
      });
      expect(updateDashboard).toHaveBeenCalledWith("d1", {
        chart_ids: ["q1", "q2", "added-elsewhere", "q3"],
      });
    });
  });

  it("refuses to be used outside its provider", () => {
    // Otherwise a component would silently render with no dashboards at all.
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Bare() {
      useDashboards();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/must be used inside/);
    vi.mocked(console.error).mockRestore();
  });

  it("shares one fetch across every consumer", async () => {
    function Consumer({ label }: { label: string }) {
      const { dashboards } = useDashboards();
      return <span>{`${label}:${dashboards.length}`}</span>;
    }

    render(
      <DashboardsProvider>
        <Consumer label="rail" />
        <Consumer label="page" />
      </DashboardsProvider>,
    );

    // The rail renders dashboards on every screen; fetching per consumer would
    // mean the same request several times over and a rail that flickers.
    await waitFor(() => expect(screen.getByText("rail:1")).toBeInTheDocument());
    expect(screen.getByText("page:1")).toBeInTheDocument();
    expect(listDashboards).toHaveBeenCalledTimes(1);
  });
});

describe("findDashboard", () => {
  it("finds by id and tolerates null", () => {
    const boards = [board(), board({ id: "d2", name: "Other" })];
    expect(findDashboard(boards, "d2")?.name).toBe("Other");
    expect(findDashboard(boards, null)).toBeNull();
    expect(findDashboard(boards, "absent")).toBeNull();
  });
});
