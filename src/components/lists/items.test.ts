import { describe, expect, it } from "vitest";
import { ApiError } from "@/services/api-client";
import type { UserRead } from "@/contracts/api";
import {
  listErrorMessage,
  mayEditList,
  parseItems,
  tallyItems,
  usageFromError,
} from "./items";

describe("parseItems", () => {
  it("splits a single line on commas and trims", () => {
    expect(parseItems("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("splits on newlines only once there is a newline, so commas survive", () => {
    expect(parseItems("Smith, John\nDoe, Jane")).toEqual(["Smith, John", "Doe, Jane"]);
    expect(parseItems("a, b\nc")).toEqual(["a, b", "c"]);
  });

  it("skips blank entries", () => {
    expect(parseItems("\n\na\n\n")).toEqual(["a"]);
    expect(parseItems(",,a,,")).toEqual(["a"]);
    expect(parseItems("   ")).toEqual([]);
  });

  it("handles windows line endings", () => {
    expect(parseItems("a\r\nb\r\n")).toEqual(["a", "b"]);
  });
});

describe("tallyItems", () => {
  it("counts duplicates the way the engine matches: case, space, numbers", () => {
    const tally = tallyItems(["NG", "ng", " NG ", "2", "2.0", "02", "GH"]);
    expect(tally).toMatchObject({ received: 7, kept: 3, duplicates: 4 });
  });

  it("treats only decimal literals as numbers, like the engine's Decimal", () => {
    // Number("0x1A") is 26 in JavaScript; Decimal("0x1A") is an error, so it is text.
    expect(tallyItems(["0x1A", "26"]).duplicates).toBe(0);
    expect(tallyItems(["0x1A", "0X1a"]).duplicates).toBe(1);
    // Decimal accepts an exponent, so 1e3 is 1000 on both sides.
    expect(tallyItems(["1e3", "1000", "1.0E3", "+1000"]).duplicates).toBe(3);
    expect(tallyItems(["1_0", "10"]).duplicates).toBe(1);
    expect(tallyItems(["Infinity", "nan", "-", ".", "e5", ""]).duplicates).toBe(0);
    expect(tallyItems([".5", "0.50", "-0", "0", "0.000"]).duplicates).toBe(3);
  });

  it("keeps numbers beyond float precision apart", () => {
    expect(tallyItems(["12345678901234567890", "12345678901234567891"]).duplicates).toBe(0);
    expect(tallyItems(["1e999999", "1E999999"]).duplicates).toBe(1);
  });

  it("does not merge different text that merely looks alike", () => {
    expect(tallyItems(["a1", "a2", "1a"]).duplicates).toBe(0);
  });

  it("flags items over the length the engine accepts", () => {
    expect(tallyItems(["x".repeat(500), "y".repeat(501)]).tooLong).toBe(1);
  });

  it("is empty for no items", () => {
    expect(tallyItems([])).toEqual({ received: 0, kept: 0, duplicates: 0, tooLong: 0 });
  });
});

function person(over: Partial<UserRead>): UserRead {
  return {
    id: "u1",
    email: "a@example.com",
    full_name: "A",
    role: "analyst",
    is_active: true,
    must_change_password: false,
    last_login_at: null,
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

describe("mayEditList", () => {
  it("allows the creator and any admin, and nobody else", () => {
    expect(mayEditList({ created_by: "u1" }, person({ id: "u1" }))).toBe(true);
    expect(mayEditList({ created_by: "u9" }, person({ id: "u2", role: "admin" }))).toBe(true);
    expect(mayEditList({ created_by: "u9" }, person({ id: "u2" }))).toBe(false);
    expect(mayEditList({ created_by: null }, person({ id: "u2" }))).toBe(false);
    expect(mayEditList({ created_by: "u1" }, null)).toBe(false);
  });
});

function inUse(detail: unknown, code = "LIST_IN_USE") {
  return new ApiError({
    kind: "http",
    status: 409,
    errorCode: code,
    message: "in use",
    url: "/lists/l1",
    detail,
  });
}

describe("usageFromError", () => {
  const rules = [{ rule_name: "Blocked", query_id: "q1", query_name: "Transfers" }];

  it("reads the rules from a LIST_IN_USE detail", () => {
    expect(usageFromError(inUse({ rules }))).toEqual({ rules, hidden: 0 });
  });

  it("reads hidden_rule_count, alone or beside visible rules", () => {
    expect(usageFromError(inUse({ rules: [], hidden_rule_count: 2 }))).toEqual({
      rules: [],
      hidden: 2,
    });
    expect(usageFromError(inUse({ list_id: "l1", rules, hidden_rule_count: 1 }))).toEqual({
      rules,
      hidden: 1,
    });
  });

  it("ignores other errors and malformed details", () => {
    const empty = { rules: [], hidden: 0 };
    expect(usageFromError(new Error("x"))).toEqual(empty);
    expect(usageFromError(inUse({ rules: [] }, "LIST_NAME_TAKEN"))).toEqual(empty);
    expect(usageFromError(inUse(null))).toEqual(empty);
    expect(usageFromError(inUse({ rules: "nope" }))).toEqual(empty);
    expect(usageFromError(inUse({ rules: [null, 3, { rule_name: 1 }] }))).toEqual(empty);
    for (const bad of ["3", -1, 1.5, null, NaN]) {
      expect(usageFromError(inUse({ rules: [], hidden_rule_count: bad })).hidden).toBe(0);
    }
  });
});

describe("listErrorMessage", () => {
  it("explains a taken name", () => {
    expect(listErrorMessage(inUse(null, "LIST_NAME_TAKEN"), "x")).toMatch(/already has that name/);
  });

  it("passes the engine's message through, and falls back for the unknown", () => {
    expect(listErrorMessage(inUse(null, "OTHER"), "x")).toBe("in use");
    expect(listErrorMessage("boom", "Could not save")).toBe("Could not save");
  });
});
