import { describe, expect, it } from "vitest";
import { moved, normalizeName, withQuery, withoutQuery } from "./arrange";

describe("withQuery", () => {
  it("appends to the end of the board", () => {
    expect(withQuery(["a"], "b")).toEqual(["a", "b"]);
  });

  it("never adds the same query twice", () => {
    expect(withQuery(["a", "b"], "b")).toEqual(["a", "b"]);
  });

  it("does not mutate its input", () => {
    const before = ["a"];
    withQuery(before, "b");
    expect(before).toEqual(["a"]);
  });
});

describe("withoutQuery", () => {
  it("removes only the target", () => {
    expect(withoutQuery(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("ignores a query that is not on the board", () => {
    expect(withoutQuery(["a"], "zz")).toEqual(["a"]);
  });
});

describe("moved", () => {
  const three = ["a", "b", "c"];

  it("moves a query to the requested position", () => {
    expect(moved(three, "c", 0)).toEqual(["c", "a", "b"]);
    expect(moved(three, "a", 1)).toEqual(["b", "a", "c"]);
  });

  it("clamps an out-of-range target instead of throwing", () => {
    expect(moved(three, "a", 99)).toEqual(["b", "c", "a"]);
    expect(moved(three, "c", -5)).toEqual(["c", "a", "b"]);
  });

  it("ignores a query that is not on the board", () => {
    expect(moved(three, "zz", 0)).toEqual(three);
  });
});

describe("normalizeName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeName("  Card   testing  ")).toBe("Card testing");
  });

  it("falls back rather than allowing an unnameable board", () => {
    expect(normalizeName("   ")).toBe("Untitled dashboard");
    expect(normalizeName("", "Keep me")).toBe("Keep me");
  });

  it("caps at the length the engine accepts", () => {
    expect(normalizeName("x".repeat(400))).toHaveLength(200);
  });
});
