import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEY, parseState } from "./store";
import { resetDashboardCache, useDashboards } from "./useDashboards";

function stored() {
  return parseState(window.localStorage.getItem(STORAGE_KEY));
}

beforeEach(() => {
  window.localStorage.clear();
  resetDashboardCache();
});

describe("useDashboards", () => {
  it("starts empty and reports itself hydrated on the client", () => {
    const { result } = renderHook(() => useDashboards());
    expect(result.current.dashboards).toEqual([]);
    expect(result.current.hydrated).toBe(true);
  });

  it("reads what is already in storage", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        dashboards: [{ id: "d1", name: "Chargebacks", queryIds: ["q1"] }],
      }),
    );
    const { result } = renderHook(() => useDashboards());
    expect(result.current.dashboards.map((entry) => entry.name)).toEqual(["Chargebacks"]);
  });

  it("survives corrupt storage instead of taking the rail down", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    const { result } = renderHook(() => useDashboards());
    expect(result.current.dashboards).toEqual([]);
  });

  it("creates a dashboard and persists it", () => {
    const { result } = renderHook(() => useDashboards());

    let id = "";
    act(() => {
      id = result.current.create("Card testing").id;
    });

    expect(result.current.dashboards).toHaveLength(1);
    expect(stored().dashboards[0].id).toBe(id);
    expect(stored().dashboards[0].name).toBe("Card testing");
  });

  it("adds and removes queries, persisting each change", () => {
    const { result } = renderHook(() => useDashboards());
    let id = "";
    act(() => {
      id = result.current.create("Board").id;
    });

    act(() => result.current.addQueryTo(id, "q1"));
    act(() => result.current.addQueryTo(id, "q2"));
    expect(stored().dashboards[0].queryIds).toEqual(["q1", "q2"]);

    act(() => result.current.removeQueryFrom(id, "q1"));
    expect(result.current.dashboards[0].queryIds).toEqual(["q2"]);
    expect(stored().dashboards[0].queryIds).toEqual(["q2"]);
  });

  it("renames and deletes", () => {
    const { result } = renderHook(() => useDashboards());
    let id = "";
    act(() => {
      id = result.current.create("Before").id;
    });

    act(() => result.current.rename(id, "After"));
    expect(result.current.dashboards[0].name).toBe("After");

    act(() => result.current.remove(id));
    expect(result.current.dashboards).toEqual([]);
    expect(stored().dashboards).toEqual([]);
  });

  it("prunes queries the engine no longer has", () => {
    const { result } = renderHook(() => useDashboards());
    act(() => {
      result.current.create("Board", ["q1", "q2", "q3"]);
    });

    act(() => result.current.prune(["q1", "q3"]));
    expect(result.current.dashboards[0].queryIds).toEqual(["q1", "q3"]);
  });

  it("does not write when a prune changes nothing", () => {
    const { result } = renderHook(() => useDashboards());
    act(() => {
      result.current.create("Board", ["q1"]);
    });
    const before = window.localStorage.getItem(STORAGE_KEY);

    act(() => result.current.prune(["q1", "q2"]));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("picks up a write made by another tab", () => {
    const { result } = renderHook(() => useDashboards());
    expect(result.current.dashboards).toEqual([]);

    act(() => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          dashboards: [{ id: "other", name: "From another tab", queryIds: [] }],
        }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });

    expect(result.current.dashboards.map((entry) => entry.name)).toEqual([
      "From another tab",
    ]);
  });

  it("keeps two hooks in the same tab in agreement", () => {
    const first = renderHook(() => useDashboards());
    const second = renderHook(() => useDashboards());

    act(() => {
      first.result.current.create("Shared");
    });

    expect(second.result.current.dashboards.map((entry) => entry.name)).toEqual(["Shared"]);
  });
});
