import { describe, expect, it } from "vitest";
import {
  UNFLAGGED,
  compareFlagState,
  newlyFlagged,
  nextFlagState,
  orderKeys,
  sameFlagState,
  shiftsBetween,
  worstSeverity,
  type FlagState,
} from "./flagRanking";

const flagged = (count: number, severity: FlagState["severity"], since = 0): FlagState => ({
  count,
  severity,
  since,
});
const map = (entries: Record<string, FlagState>) => new Map(Object.entries(entries));

describe("compareFlagState", () => {
  it("puts flagged before unflagged", () => {
    expect(compareFlagState(flagged(1, "low"), UNFLAGGED)).toBeLessThan(0);
    expect(compareFlagState(UNFLAGGED, flagged(1, "low"))).toBeGreaterThan(0);
  });

  it("treats two unflagged cards as equal", () => {
    expect(compareFlagState(UNFLAGGED, UNFLAGGED)).toBe(0);
  });

  it("puts the most recently flagged first, ahead of severity and count", () => {
    const fresh = flagged(1, "low", 2000);
    const old = flagged(50, "high", 1000);
    expect(compareFlagState(fresh, old)).toBeLessThan(0);
  });

  it("breaks a tie on `since` by the worse severity", () => {
    expect(compareFlagState(flagged(1, "high", 5), flagged(9, "medium", 5))).toBeLessThan(0);
  });

  it("breaks a tie on severity by the larger count", () => {
    expect(compareFlagState(flagged(9, "high", 5), flagged(2, "high", 5))).toBeLessThan(0);
  });

  it("is zero when everything is equal", () => {
    expect(compareFlagState(flagged(3, "high", 5), flagged(3, "high", 5))).toBe(0);
  });
});

describe("orderKeys", () => {
  it("moves flagged cards ahead and keeps the rest in their original order", () => {
    const states = map({ b: flagged(2, "high", 10) });
    expect(orderKeys(["a", "b", "c", "d"], states)).toEqual(["b", "a", "c", "d"]);
  });

  it("is stable: equal cards keep the order they came in", () => {
    const states = map({ a: flagged(1, "low", 5), b: flagged(1, "low", 5), c: flagged(1, "low", 5) });
    expect(orderKeys(["a", "b", "c"], states)).toEqual(["a", "b", "c"]);
    expect(orderKeys(["c", "a", "b"], states)).toEqual(["c", "a", "b"]);
  });

  it("puts the newest flag first among several", () => {
    const states = map({
      a: flagged(5, "high", 100),
      b: flagged(1, "low", 300),
      c: flagged(2, "medium", 200),
    });
    expect(orderKeys(["a", "b", "c"], states)).toEqual(["b", "c", "a"]);
  });

  it("treats a card nobody has reported for as unflagged", () => {
    expect(orderKeys(["x", "y"], map({ y: flagged(1, "low") }))).toEqual(["y", "x"]);
  });

  it("changes nothing when nothing is flagged", () => {
    expect(orderKeys(["a", "b", "c"], new Map())).toEqual(["a", "b", "c"]);
  });

  it("does not change the order on a repeat of the same state", () => {
    const states = map({ b: flagged(2, "high", 10) });
    const once = orderKeys(["a", "b", "c"], states);
    expect(orderKeys(once, states)).toEqual(once);
  });
});

describe("nextFlagState", () => {
  it("is not news when a card is flagged the first time it is seen", () => {
    expect(nextFlagState(undefined, 4, "high", 999)).toEqual(flagged(4, "high", 0));
  });

  it("is news when a card first appears flagged after the page has settled", () => {
    // Added to the board mid-session, already flagged: it should lead, not sort by
    // severity alone among cards that were flagged long ago.
    expect(nextFlagState(undefined, 2, "low", 999, true)).toEqual(flagged(2, "low", 999));
  });

  it("stays not-news for a card seen flagged during the page's first moments", () => {
    expect(nextFlagState(undefined, 2, "low", 999, false).since).toBe(0);
  });

  it("stamps the time when an unflagged card becomes flagged", () => {
    expect(nextFlagState(UNFLAGGED, 2, "medium", 999)).toEqual(flagged(2, "medium", 999));
  });

  it("stamps the time when the count rises", () => {
    expect(nextFlagState(flagged(2, "low", 100), 3, "low", 999).since).toBe(999);
  });

  it("keeps its place when the count holds steady", () => {
    expect(nextFlagState(flagged(2, "low", 100), 2, "low", 999).since).toBe(100);
  });

  it("keeps its place when the count falls (a row was dismissed)", () => {
    expect(nextFlagState(flagged(5, "low", 100), 3, "low", 999).since).toBe(100);
  });

  it("returns to unflagged at zero, and forgets when it was flagged", () => {
    expect(nextFlagState(flagged(5, "high", 100), 0, null, 999)).toEqual(UNFLAGGED);
  });

  it("stamps again when it is flagged anew after being cleared", () => {
    const cleared = nextFlagState(flagged(5, "high", 100), 0, null, 500);
    expect(nextFlagState(cleared, 1, "low", 900).since).toBe(900);
  });
});

describe("sameFlagState", () => {
  it("treats a missing state as unflagged", () => {
    expect(sameFlagState(undefined, UNFLAGGED)).toBe(true);
    expect(sameFlagState(undefined, flagged(1, "low"))).toBe(false);
  });
  it("compares every field", () => {
    expect(sameFlagState(flagged(1, "low", 1), flagged(1, "low", 1))).toBe(true);
    expect(sameFlagState(flagged(1, "low", 1), flagged(1, "low", 2))).toBe(false);
    expect(sameFlagState(flagged(1, "low", 1), flagged(1, "high", 1))).toBe(false);
  });
});

describe("worstSeverity", () => {
  const rule = (severity: "low" | "medium" | "high", matched: number) => ({
    id: severity + matched,
    name: "r",
    severity,
    matched,
  });
  it("is the worst among rules that matched", () => {
    expect(worstSeverity({ rules: [rule("low", 2), rule("high", 1), rule("medium", 9)] })).toBe("high");
  });
  it("ignores a rule that matched nothing", () => {
    expect(worstSeverity({ rules: [rule("high", 0), rule("low", 3)] })).toBe("low");
  });
  it("is null with no flags at all", () => {
    expect(worstSeverity(undefined)).toBeNull();
    expect(worstSeverity({ rules: [] })).toBeNull();
  });
});

describe("shiftsBetween", () => {
  const boxes = (entries: Record<string, [number, number]>) =>
    new Map(Object.entries(entries).map(([k, [left, top]]) => [k, { left, top }]));

  it("pulls a moved card back to where it was", () => {
    const shifts = shiftsBetween(boxes({ a: [0, 0], b: [100, 0] }), boxes({ a: [100, 0], b: [0, 0] }));
    expect(shifts).toEqual([
      { key: "a", dx: -100, dy: 0 },
      { key: "b", dx: 100, dy: 0 },
    ]);
  });

  it("leaves out cards that did not move, and sub-pixel noise", () => {
    expect(shiftsBetween(boxes({ a: [10, 10] }), boxes({ a: [10.4, 10.2] }))).toEqual([]);
  });

  it("leaves out cards with no earlier position", () => {
    expect(shiftsBetween(boxes({}), boxes({ a: [0, 0] }))).toEqual([]);
  });
});

describe("newlyFlagged", () => {
  it("names cards that crossed from clear to flagged", () => {
    const before = map({ a: UNFLAGGED, b: flagged(2, "low") });
    const after = map({ a: flagged(1, "high", 5), b: flagged(4, "low", 6), c: flagged(1, "low", 7) });
    expect(newlyFlagged(before, after).sort()).toEqual(["a", "c"]);
  });
});
