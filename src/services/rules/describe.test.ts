import { describe, expect, it } from "vitest";
import { OPERATOR_LABELS, type FlagOperator } from "@/contracts/api";
import {
  MAX_LISTED_MEMBERS,
  MAX_VALUE_LENGTH,
  OPERATOR_WORDS,
  describeCondition,
  describeConditionParts,
  describeRule,
  describeRuleParts,
  type DescribableCondition,
} from "./describe";

const cond = (over: Partial<DescribableCondition> = {}): DescribableCondition => ({
  column_name: "amount",
  operator: "gt",
  value: "300",
  ...over,
});

/**
 * One expected sentence per operator. The table is keyed by the FlagOperator
 * type's own list (taken from OPERATOR_LABELS), and a test below fails if an
 * operator is added to the contract without a sentence here, so a new operator
 * cannot ship reading as its raw code.
 */
const EXPECTED: Record<FlagOperator, [DescribableCondition, string]> = {
  gt: [cond({ operator: "gt", value: "300" }), "amount is greater than 300"],
  gte: [cond({ operator: "gte", value: "300" }), "amount is at least 300"],
  lt: [cond({ operator: "lt", value: "10" }), "amount is less than 10"],
  lte: [cond({ operator: "lte", value: "10" }), "amount is at most 10"],
  eq: [cond({ column_name: "outcome", operator: "eq", value: "declined" }), "outcome equals declined"],
  neq: [cond({ column_name: "outcome", operator: "neq", value: "approved" }), "outcome does not equal approved"],
  contains: [cond({ column_name: "memo", operator: "contains", value: "refund" }), "memo contains refund"],
  not_contains: [cond({ column_name: "memo", operator: "not_contains", value: "test" }), "memo does not contain test"],
  starts_with: [cond({ column_name: "bank", operator: "starts_with", value: "01" }), "bank starts with 01"],
  in: [cond({ column_name: "country", operator: "in", value: "NG, GH" }), "country is one of NG or GH"],
  not_in: [cond({ column_name: "country", operator: "not_in", value: "NG, GH" }), "country is not one of NG or GH"],
  in_list: [
    cond({ column_name: "terminal", operator: "in_list", value: null, list_id: "l1", list_name: "MFBs Terminal" }),
    "terminal is in the list “MFBs Terminal”",
  ],
  not_in_list: [
    cond({ column_name: "terminal", operator: "not_in_list", value: null, list_id: "l1", list_name: "MFBs Terminal" }),
    "terminal is not in the list “MFBs Terminal”",
  ],
  is_null: [cond({ column_name: "beneficiary", operator: "is_null", value: null }), "beneficiary is empty"],
  is_not_null: [cond({ column_name: "beneficiary", operator: "is_not_null", value: null }), "beneficiary is not empty"],
  between: [
    cond({ column_name: "risk_score", operator: "between", value: "70", value2: "100" }),
    "risk_score is between 70 and 100",
  ],
};

describe("describeCondition: every operator", () => {
  const operators = Object.keys(OPERATOR_LABELS) as FlagOperator[];

  it("has a sentence for every operator the contract defines", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...operators].sort());
    expect(Object.keys(OPERATOR_WORDS).sort()).toEqual([...operators].sort());
  });

  it.each(operators)("%s reads as a sentence", (operator) => {
    const [condition, sentence] = EXPECTED[operator];
    expect(describeCondition(condition)).toBe(sentence);
  });

  it.each(operators)("%s never prints the raw operator code", (operator) => {
    const [condition] = EXPECTED[operator];
    expect(describeCondition(condition)).not.toMatch(/\b(gte?|lte?|neq|not_in|in_list|not_in_list|is_not_null|is_null|starts_with|not_contains)\b/);
  });
});

describe("describeCondition: values", () => {
  it("shows a placeholder, not a blank, for a missing value", () => {
    expect(describeCondition(cond({ value: "" }))).toBe("amount is greater than (no value)");
    expect(describeCondition(cond({ value: null }))).toBe("amount is greater than (no value)");
    expect(describeCondition(cond({ value: undefined }))).toBe("amount is greater than (no value)");
    expect(describeCondition(cond({ value: "   " }))).toBe("amount is greater than (no value)");
  });

  it("shows a placeholder for a missing column", () => {
    expect(describeCondition(cond({ column_name: "" }))).toBe("(no column) is greater than 300");
    expect(describeCondition(cond({ column_name: "  " }))).toBe("(no column) is greater than 300");
  });

  it("marks a missing column and a missing value as placeholders", () => {
    const parts = describeConditionParts(cond({ column_name: "", value: "" }));
    expect(parts.filter((p) => p.placeholder).map((p) => p.kind)).toEqual(["column", "value"]);
  });

  it("marks only the missing bound of a between", () => {
    const parts = describeConditionParts(cond({ operator: "between", value: "70", value2: "" }));
    expect(describeCondition(cond({ operator: "between", value: "70", value2: "" }))).toBe(
      "amount is between 70 and (no value)",
    );
    expect(parts.filter((p) => p.placeholder)).toHaveLength(1);
  });

  it("trims and collapses whitespace, including a pasted line break", () => {
    expect(describeCondition(cond({ operator: "eq", value: "  declined \n  by issuer " }))).toBe(
      "amount equals declined by issuer",
    );
  });

  it("keeps a value that is only a number, zero included", () => {
    expect(describeCondition(cond({ value: "0" }))).toBe("amount is greater than 0");
  });

  it("keeps symbols and quotes exactly as typed", () => {
    expect(describeCondition(cond({ operator: "contains", value: `a "b" & <c>` }))).toBe(
      `amount contains a "b" & <c>`,
    );
  });

  it("cuts a very long value and marks the cut", () => {
    const long = "x".repeat(300);
    const text = describeCondition(cond({ operator: "contains", value: long }));
    const value = text.replace("amount contains ", "");
    expect(value.length).toBeLessThanOrEqual(MAX_VALUE_LENGTH);
    expect(value.endsWith("…")).toBe(true);
  });

  it("does not cut a value that fits exactly", () => {
    const exact = "y".repeat(MAX_VALUE_LENGTH);
    expect(describeCondition(cond({ operator: "contains", value: exact }))).toBe(`amount contains ${exact}`);
  });

  it("honours a different limit", () => {
    expect(describeCondition(cond({ operator: "contains", value: "abcdefghij" }), { maxValueLength: 5 })).toBe(
      "amount contains abcd…",
    );
  });

  it("treats a limit of zero as no limit rather than printing nothing", () => {
    expect(describeCondition(cond({ operator: "contains", value: "abcdefghij" }), { maxValueLength: 0 })).toBe(
      "amount contains abcdefghij",
    );
  });

  it("cuts each bound of a between on its own", () => {
    const text = describeCondition(
      cond({ operator: "between", value: "1".repeat(80), value2: "9".repeat(80) }),
    );
    expect(text.match(/…/g)).toHaveLength(2);
  });
});

describe("describeCondition: is one of", () => {
  const inCond = (value: string | null) => cond({ column_name: "country", operator: "in", value });

  it("names one member plainly", () => {
    expect(describeCondition(inCond("NG"))).toBe("country is one of NG");
  });

  it("joins two with or", () => {
    expect(describeCondition(inCond("NG, GH"))).toBe("country is one of NG or GH");
  });

  it("joins several with commas and a final or", () => {
    expect(describeCondition(inCond("NG, GH, KE"))).toBe("country is one of NG, GH or KE");
  });

  it("names up to the limit in full", () => {
    const five = "NG, GH, KE, ZA, EG";
    expect(MAX_LISTED_MEMBERS).toBe(5);
    expect(describeCondition(inCond(five))).toBe("country is one of NG, GH, KE, ZA or EG");
  });

  it("counts the rest past the limit", () => {
    expect(describeCondition(inCond("NG, GH, KE, ZA, EG, MA, TZ"))).toBe(
      "country is one of NG, GH, KE, ZA, EG and 2 more",
    );
    expect(describeCondition(inCond("a,b,c,d,e,f"))).toBe("country is one of a, b, c, d, e and 1 more");
  });

  it("ignores empty members and stray whitespace", () => {
    expect(describeCondition(inCond(" NG ,, GH ,  "))).toBe("country is one of NG or GH");
  });

  it("shows a placeholder when there are no members at all", () => {
    expect(describeCondition(inCond(""))).toBe("country is one of (no value)");
    expect(describeCondition(inCond(" , , "))).toBe("country is one of (no value)");
    expect(describeCondition(inCond(null))).toBe("country is one of (no value)");
  });

  it("cuts a long member, not the whole list", () => {
    const text = describeCondition(inCond(`${"z".repeat(100)}, ok`));
    expect(text).toContain("…");
    expect(text.endsWith("or ok")).toBe(true);
  });

  it("reads not-in the same way", () => {
    expect(describeCondition(cond({ column_name: "country", operator: "not_in", value: "NG, GH, KE" }))).toBe(
      "country is not one of NG, GH or KE",
    );
  });
});

describe("describeCondition: lists", () => {
  const listCond = (over: Partial<DescribableCondition> = {}) =>
    cond({ column_name: "terminal", operator: "in_list", value: null, list_id: "l-secret-123", ...over });

  it("uses the name the engine sent", () => {
    expect(describeCondition(listCond({ list_name: "Watchlist" }))).toBe("terminal is in the list “Watchlist”");
  });

  it("finds the name in a map by id", () => {
    expect(describeCondition(listCond(), { listNames: new Map([["l-secret-123", "From map"]]) })).toBe(
      "terminal is in the list “From map”",
    );
  });

  it("finds the name with a function by id", () => {
    expect(describeCondition(listCond(), { listNames: (id) => (id === "l-secret-123" ? "From fn" : undefined) })).toBe(
      "terminal is in the list “From fn”",
    );
  });

  it("prefers the engine's name over a lookup", () => {
    expect(
      describeCondition(listCond({ list_name: "Engine" }), { listNames: new Map([["l-secret-123", "Lookup"]]) }),
    ).toContain("Engine");
  });

  it("never prints an id when the name is not known", () => {
    for (const options of [{}, { listNames: new Map<string, string>() }, { listNames: () => undefined }]) {
      const text = describeCondition(listCond(), options);
      expect(text).toBe("terminal is in a list");
      expect(text).not.toContain("l-secret-123");
    }
  });

  it("never prints an id for not-in-list either", () => {
    const text = describeCondition(listCond({ operator: "not_in_list" }));
    expect(text).toBe("terminal is not in a list");
    expect(text).not.toContain("secret");
  });

  it("shows a placeholder when no list has been chosen yet", () => {
    expect(describeCondition(listCond({ list_id: null }))).toBe("terminal is in (no list)");
    expect(describeConditionParts(listCond({ list_id: null })).some((p) => p.placeholder)).toBe(true);
  });

  it("treats an empty name as unknown, not as a blank pair of quotes", () => {
    expect(describeCondition(listCond({ list_name: "" }))).toBe("terminal is in a list");
  });

  it("cuts a very long list name", () => {
    const text = describeCondition(listCond({ list_name: "L".repeat(200) }));
    expect(text.length).toBeLessThan(80);
    expect(text).toContain("…");
  });
});

describe("describeRule", () => {
  it("joins conditions with and", () => {
    expect(
      describeRule({
        conditions: [
          cond({ operator: "gte", value: "300" }),
          cond({ column_name: "outcome", operator: "eq", value: "declined" }),
        ],
      }),
    ).toBe("amount is at least 300 and outcome equals declined");
  });

  it("reads three conditions in order", () => {
    expect(
      describeRule({
        conditions: [
          cond({ column_name: "beneficiary", operator: "is_null", value: null }),
          cond({ operator: "gt", value: "10000" }),
          cond({ column_name: "country", operator: "in", value: "NG, GH" }),
        ],
      }),
    ).toBe("beneficiary is empty and amount is greater than 10000 and country is one of NG or GH");
  });

  it("says plainly that a rule with no conditions has none yet", () => {
    expect(describeRule({ conditions: [] })).toBe("has no conditions yet");
    expect(describeRuleParts({ conditions: [] })[0].placeholder).toBe(true);
  });

  it("passes list names through to every condition", () => {
    expect(
      describeRule(
        { conditions: [cond({ column_name: "t", operator: "in_list", value: null, list_id: "a" })] },
        { listNames: new Map([["a", "Named"]]) },
      ),
    ).toBe("t is in the list “Named”");
  });

  it("is the same text whether read as parts or as a string", () => {
    const rule = {
      conditions: [cond(), cond({ column_name: "country", operator: "in", value: "a, b, c, d, e, f, g" })],
    };
    expect(
      describeRuleParts(rule)
        .map((p) => p.text)
        .join(" "),
    ).toBe(describeRule(rule));
  });

  it("tags every part with what it is, so a screen can set values apart", () => {
    const parts = describeRuleParts({ conditions: [cond(), cond({ column_name: "b", operator: "eq", value: "x" })] });
    expect(parts.map((p) => p.kind)).toEqual(["column", "words", "value", "words", "column", "words", "value"]);
  });

  it("does not mutate what it is given", () => {
    const rule = { conditions: [cond({ value: "  spaced  " })] };
    const copy = JSON.parse(JSON.stringify(rule));
    describeRule(rule);
    expect(rule).toEqual(copy);
  });
});
