import { describe, expect, it } from "vitest";
import { MAX_PINS, parsePins, pinPositions, pinStorageKey, serializePins, togglePin } from "./pins";

describe("togglePin", () => {
  it("adds a new pin at the end, so the first pinned stays first", () => {
    expect(togglePin(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  });

  it("removes an existing pin and keeps the others in order", () => {
    expect(togglePin(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("does not change the list it was given", () => {
    const pins = Object.freeze(["a"]);
    expect(togglePin(pins, "b")).toEqual(["a", "b"]);
    expect(pins).toEqual(["a"]);
  });

  it("toggles back to where it started", () => {
    expect(togglePin(togglePin(["a"], "b"), "b")).toEqual(["a"]);
  });
});

describe("pinPositions", () => {
  it("maps each id to the place it was pinned", () => {
    expect([...pinPositions(["x", "y", "z"])]).toEqual([["x", 0], ["y", 1], ["z", 2]]);
  });
});

describe("parsePins", () => {
  it("reads what serializePins wrote", () => {
    expect(parsePins(serializePins(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("is empty for nothing, garbage, and the wrong shape", () => {
    expect(parsePins(null)).toEqual([]);
    expect(parsePins(undefined)).toEqual([]);
    expect(parsePins("")).toEqual([]);
    expect(parsePins("{not json")).toEqual([]);
    expect(parsePins('{"a":1}')).toEqual([]);
    expect(parsePins('"a"')).toEqual([]);
  });

  it("drops anything that is not a non-empty string", () => {
    expect(parsePins('["a", 3, null, "", {"x":1}, "b"]')).toEqual(["a", "b"]);
  });

  it("keeps the first position of a duplicate", () => {
    expect(parsePins('["a","b","a","c","b"]')).toEqual(["a", "b", "c"]);
  });
});

describe("pinStorageKey", () => {
  it("is separate for each person", () => {
    expect(pinStorageKey("u1")).not.toBe(pinStorageKey("u2"));
  });
  it("has a key for nobody signed in", () => {
    expect(pinStorageKey(null)).toBe(pinStorageKey(undefined));
  });
});

describe("MAX_PINS", () => {
  it("is a sensible cap", () => {
    expect(MAX_PINS).toBeGreaterThan(20);
  });
});
