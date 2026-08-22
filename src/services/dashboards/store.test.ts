import { describe, expect, it } from "vitest";
import {
  EMPTY_STATE,
  addQuery,
  createDashboard,
  dashboardsContaining,
  deleteDashboard,
  findDashboard,
  moveQuery,
  normalizeName,
  parseState,
  pruneMissingQueries,
  removeQuery,
  renameDashboard,
  serializeState,
  type DashboardState,
} from "./store";

const NOW = "2026-08-22T12:00:00.000Z";

function seed(): DashboardState {
  let state = EMPTY_STATE;
  state = createDashboard(state, "Card testing", { id: "d1", now: NOW }).state;
  state = createDashboard(state, "Chargebacks", { id: "d2", now: NOW, queryIds: ["q1"] }).state;
  return state;
}

describe("normalizeName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeName("  Card   testing  ")).toBe("Card testing");
  });

  it("falls back rather than allowing an unnameable board", () => {
    expect(normalizeName("   ")).toBe("Untitled dashboard");
    expect(normalizeName("", "Keep me")).toBe("Keep me");
  });

  it("caps the length so the rail cannot be broken by a long name", () => {
    expect(normalizeName("x".repeat(200))).toHaveLength(80);
  });
});

describe("parseState", () => {
  it("returns empty state for absent, malformed, or non-object data", () => {
    expect(parseState(null)).toEqual(EMPTY_STATE);
    expect(parseState("not json")).toEqual(EMPTY_STATE);
    expect(parseState('"a string"')).toEqual(EMPTY_STATE);
    expect(parseState("[]")).toEqual(EMPTY_STATE);
  });

  it("refuses a version it does not understand instead of guessing", () => {
    expect(parseState(JSON.stringify({ version: 2, dashboards: [] }))).toEqual(EMPTY_STATE);
  });

  it("drops only the malformed entries, keeping the good ones", () => {
    const raw = JSON.stringify({
      version: 1,
      dashboards: [
        { id: "d1", name: "Good", queryIds: ["q1"], createdAt: NOW, updatedAt: NOW },
        { id: "", name: "No id", queryIds: [] },
        { name: "Missing id", queryIds: [] },
        { id: "d2", name: "Bad ids", queryIds: [1, 2] },
      ],
    });
    const state = parseState(raw);
    expect(state.dashboards).toHaveLength(1);
    expect(state.dashboards[0].id).toBe("d1");
  });

  it("de-duplicates query ids, which are always a mistake", () => {
    const raw = JSON.stringify({
      version: 1,
      dashboards: [{ id: "d1", name: "D", queryIds: ["q1", "q1", "q2"] }],
    });
    expect(parseState(raw).dashboards[0].queryIds).toEqual(["q1", "q2"]);
  });

  it("round-trips through serialize", () => {
    const state = seed();
    expect(parseState(serializeState(state))).toEqual(state);
  });
});

describe("createDashboard", () => {
  it("appends a named board and returns it", () => {
    const { state, dashboard } = createDashboard(EMPTY_STATE, " Card testing ", {
      id: "d1",
      now: NOW,
    });
    expect(dashboard).toEqual({
      id: "d1",
      name: "Card testing",
      queryIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(state.dashboards).toHaveLength(1);
  });

  it("does not mutate the state it was given", () => {
    const before = seed();
    const snapshot = JSON.stringify(before);
    createDashboard(before, "New");
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("renameDashboard", () => {
  it("renames the target and stamps it", () => {
    const state = renameDashboard(seed(), "d1", "Velocity", "2026-08-22T13:00:00.000Z");
    expect(findDashboard(state, "d1")?.name).toBe("Velocity");
    expect(findDashboard(state, "d1")?.updatedAt).toBe("2026-08-22T13:00:00.000Z");
  });

  it("keeps the old name when the new one is blank", () => {
    const state = renameDashboard(seed(), "d1", "   ");
    expect(findDashboard(state, "d1")?.name).toBe("Card testing");
  });

  it("is a no-op for an unknown id", () => {
    const before = seed();
    expect(renameDashboard(before, "nope", "X").dashboards).toHaveLength(2);
  });
});

describe("deleteDashboard", () => {
  it("removes only the target", () => {
    const state = deleteDashboard(seed(), "d1");
    expect(state.dashboards.map((entry) => entry.id)).toEqual(["d2"]);
  });
});

describe("addQuery / removeQuery", () => {
  it("appends a query to the end of the board", () => {
    const state = addQuery(seed(), "d2", "q2");
    expect(findDashboard(state, "d2")?.queryIds).toEqual(["q1", "q2"]);
  });

  it("never adds the same query twice", () => {
    const state = addQuery(addQuery(seed(), "d2", "q2"), "d2", "q2");
    expect(findDashboard(state, "d2")?.queryIds).toEqual(["q1", "q2"]);
  });

  it("removes a query without touching the others", () => {
    const state = removeQuery(addQuery(seed(), "d2", "q2"), "d2", "q1");
    expect(findDashboard(state, "d2")?.queryIds).toEqual(["q2"]);
  });

  it("ignores removal of a query that is not on the board", () => {
    const state = removeQuery(seed(), "d2", "absent");
    expect(findDashboard(state, "d2")?.queryIds).toEqual(["q1"]);
  });
});

describe("moveQuery", () => {
  const three = () =>
    createDashboard(EMPTY_STATE, "D", { id: "d1", queryIds: ["a", "b", "c"] }).state;

  it("moves a query to the requested position", () => {
    expect(findDashboard(moveQuery(three(), "d1", "c", 0), "d1")?.queryIds).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(findDashboard(moveQuery(three(), "d1", "a", 1), "d1")?.queryIds).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("clamps an out-of-range target instead of throwing", () => {
    expect(findDashboard(moveQuery(three(), "d1", "a", 99), "d1")?.queryIds).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(findDashboard(moveQuery(three(), "d1", "c", -5), "d1")?.queryIds).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("ignores a query that is not on the board", () => {
    expect(findDashboard(moveQuery(three(), "d1", "zz", 0), "d1")?.queryIds).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("pruneMissingQueries", () => {
  it("drops ids for queries the engine no longer has", () => {
    const before = createDashboard(EMPTY_STATE, "D", { id: "d1", queryIds: ["a", "b", "c"] }).state;
    const after = pruneMissingQueries(before, ["a", "c"]);
    expect(findDashboard(after, "d1")?.queryIds).toEqual(["a", "c"]);
  });

  it("returns the identical object when nothing changed, so React can skip a write", () => {
    const before = createDashboard(EMPTY_STATE, "D", { id: "d1", queryIds: ["a"] }).state;
    expect(pruneMissingQueries(before, ["a", "b"])).toBe(before);
  });
});

describe("lookups", () => {
  it("finds by id and tolerates null", () => {
    expect(findDashboard(seed(), "d2")?.name).toBe("Chargebacks");
    expect(findDashboard(seed(), null)).toBeNull();
    expect(findDashboard(seed(), "absent")).toBeNull();
  });

  it("lists the boards a query appears on", () => {
    const state = addQuery(seed(), "d1", "q1");
    expect(dashboardsContaining(state, "q1").map((entry) => entry.id)).toEqual(["d1", "d2"]);
    expect(dashboardsContaining(state, "nope")).toEqual([]);
  });
});
