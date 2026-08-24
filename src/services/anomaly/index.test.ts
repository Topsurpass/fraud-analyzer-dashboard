import { describe, expect, it } from "vitest";
import { EMPTY_FLAGS } from "@/contracts/api";
import { detectRowAnomalies } from "./index";

/**
 * Nothing is flagged until a rule says so.
 *
 * This module used to guess: a column named like `is_fraud` was believed, and
 * failing that a modified z-score marked the tallest bars. Both are deleted,
 * and these tests exist to keep them deleted. On screen a guess and a finding
 * are the same red mark, so a query with no rules came up with rows already
 * flagged - an inference nobody made, presented as a finding.
 *
 * The rule-driven path lives in flagRules.test.ts.
 */

const FRAUD_SHAPED = {
  columns: ["is_fraud", "amount"],
  rows: [
    [1, 10],
    [0, 20],
  ],
  valueColumn: "amount",
};

describe("with no rules", () => {
  it("does not believe a column just because it is called is_fraud", () => {
    const result = detectRowAnomalies(FRAUD_SHAPED);
    expect(result.flags).toEqual([false, false]);
    expect(result.reason).toBe("none");
  });

  it.each(["is_flagged", "suspicious", "fraud", "is_anomaly"])(
    "ignores the conventional name %s",
    (name) => {
      const result = detectRowAnomalies({
        columns: [name, "amount"],
        rows: [
          [1, 10],
          [0, 20],
        ],
        valueColumn: "amount",
      });
      expect(result.flags).toEqual([false, false]);
    },
  );

  it("does not mark a screaming outlier", () => {
    // 9000 among ones is exactly what the old z-score existed to catch.
    const result = detectRowAnomalies({
      columns: ["amount"],
      rows: [[1], [1], [1], [1], [1], [9000]],
      valueColumn: "amount",
    });
    expect(result.flags.some(Boolean)).toBe(false);
    expect(result.reason).toBe("none");
  });

  it("treats an outcome carrying no rules the same as no outcome at all", () => {
    // Every ruleless query sends EMPTY_FLAGS; a brand-new unsaved one sends
    // nothing. Both must come back clean.
    for (const flags of [undefined, EMPTY_FLAGS]) {
      const result = detectRowAnomalies({ ...FRAUD_SHAPED, flags });
      expect(result.flags).toEqual([false, false]);
      expect(result.reason).toBe("none");
    }
  });

  it("names no source, because nothing decided anything", () => {
    expect(detectRowAnomalies(FRAUD_SHAPED).source).toBeNull();
  });

  it("still returns label arrays the length of the rows", () => {
    // TableView indexes these positionally, so a short array is a silent
    // undefined at render time rather than an error here.
    const result = detectRowAnomalies(FRAUD_SHAPED);
    expect(result.ruleNames).toHaveLength(2);
    expect(result.severities).toHaveLength(2);
  });

  it("handles an empty result set", () => {
    const result = detectRowAnomalies({ columns: ["amount"], rows: [] });
    expect(result.flags).toEqual([]);
  });
});
