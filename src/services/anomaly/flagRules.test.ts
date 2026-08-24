import { describe, expect, it } from "vitest";
import type { FlagOutcome } from "@/contracts/api";
import { EMPTY_FLAGS } from "@/contracts/api";
import {
  detectRowAnomalies,
  highestSeverity,
  maskFromFlagOutcome,
} from "@/services/anomaly";

/**
 * Server-supplied flag rules against the two heuristics they replace.
 *
 * The heuristics still exist and still matter for a query with no rules. What
 * must never happen is a rule the analyst wrote losing to a guess about column
 * names or a z-score.
 */

function outcome(partial: Partial<FlagOutcome>): FlagOutcome {
  return { ...EMPTY_FLAGS, ...partial };
}

const LARGE = {
  id: "r1",
  name: "Large transfer",
  severity: "high" as const,
  matched: 1,
};

describe("maskFromFlagOutcome", () => {
  it("expands the sparse wire format into a full-length mask", () => {
    const mask = maskFromFlagOutcome(
      outcome({ flagged_count: 1, rows: [{ index: 2, rule_ids: ["r1"] }], rules: [LARGE] }),
      5,
    );
    expect(mask.flags).toEqual([false, false, true, false, false]);
    expect(mask.reason).toBe("flag-rule");
  });

  it("carries the rule name and severity for the flagged row only", () => {
    const mask = maskFromFlagOutcome(
      outcome({ rows: [{ index: 1, rule_ids: ["r1"] }], rules: [LARGE] }),
      3,
    );
    expect(mask.ruleNames).toEqual([[], ["Large transfer"], []]);
    expect(mask.severities).toEqual([null, "high", null]);
  });

  it("records every rule that caught the same row", () => {
    const second = { id: "r2", name: "Odd hour", severity: "low" as const, matched: 1 };
    const mask = maskFromFlagOutcome(
      outcome({ rows: [{ index: 0, rule_ids: ["r1", "r2"] }], rules: [LARGE, second] }),
      1,
    );
    expect(mask.ruleNames[0]).toEqual(["Large transfer", "Odd hour"]);
  });

  it("reports the highest severity when several rules match one row", () => {
    const low = { id: "r2", name: "Quiet", severity: "low" as const, matched: 1 };
    const mask = maskFromFlagOutcome(
      outcome({ rows: [{ index: 0, rule_ids: ["r2", "r1"] }], rules: [LARGE, low] }),
      1,
    );
    expect(mask.severities[0]).toBe("high");
  });

  it("drops a row index past the end rather than painting the wrong row", () => {
    // Happens when the outcome and the rows came from different runs. Silently
    // marking row 0 because row 9 does not exist would be worse than nothing.
    const mask = maskFromFlagOutcome(
      outcome({ rows: [{ index: 9, rule_ids: ["r1"] }], rules: [LARGE] }),
      3,
    );
    expect(mask.flags).toEqual([false, false, false]);
  });

  it("ignores a rule id the outcome does not describe", () => {
    const mask = maskFromFlagOutcome(
      outcome({ rows: [{ index: 0, rule_ids: ["gone"] }], rules: [LARGE] }),
      1,
    );
    expect(mask.flags[0]).toBe(true);
    expect(mask.ruleNames[0]).toEqual([]);
    expect(mask.severities[0]).toBeNull();
  });
});

describe("highestSeverity", () => {
  it("ranks high over medium over low", () => {
    expect(highestSeverity(["low", "high", "medium"])).toBe("high");
    expect(highestSeverity(["low", "medium"])).toBe("medium");
    expect(highestSeverity(["low"])).toBe("low");
  });

  it("is null for nothing", () => {
    expect(highestSeverity([])).toBeNull();
  });
});

describe("priority against the heuristics", () => {
  it("rules beat a conventionally-named boolean flag column", () => {
    // is_fraud says rows 0 and 1; the analyst's rule says row 2 only.
    const columns = ["is_fraud", "amount"];
    const rows = [
      [1, 10],
      [1, 20],
      [0, 30],
    ];
    const result = detectRowAnomalies({
      columns,
      rows,
      valueColumn: "amount",
      flags: outcome({ rows: [{ index: 2, rule_ids: ["r1"] }], rules: [LARGE] }),
    });
    expect(result.reason).toBe("flag-rule");
    expect(result.flags).toEqual([false, false, true]);
  });

  it("rules beat the outlier test", () => {
    const columns = ["amount"];
    // 9000 is a screaming outlier; the rule deliberately picks a different row.
    const rows = [[1], [1], [1], [1], [1], [9000]];
    const result = detectRowAnomalies({
      columns,
      rows,
      valueColumn: "amount",
      flags: outcome({ rows: [{ index: 0, rule_ids: ["r1"] }], rules: [LARGE] }),
    });
    expect(result.reason).toBe("flag-rule");
    expect(result.flags).toEqual([true, false, false, false, false, false]);
  });

  it("a query with rules that matched nothing flags nothing", () => {
    // Not the same as having no rules: the analyst said what counts and the
    // answer was "none of these". Falling back to a guess would contradict them.
    const columns = ["is_fraud", "amount"];
    const rows = [
      [1, 10],
      [1, 9000],
    ];
    const result = detectRowAnomalies({
      columns,
      rows,
      valueColumn: "amount",
      flags: outcome({ rules: [{ ...LARGE, matched: 0 }] }),
    });
    expect(result.reason).toBe("flag-rule");
    expect(result.flags).toEqual([false, false]);
  });

  it("an outcome with no rules leaves the heuristics switched on", () => {
    // Every query without rules sends this, so treating it as "flagged nothing"
    // would silently disable flag-column detection for the whole app.
    const columns = ["is_fraud", "amount"];
    const rows = [
      [1, 10],
      [0, 20],
    ];
    const result = detectRowAnomalies({
      columns,
      rows,
      valueColumn: "amount",
      flags: EMPTY_FLAGS,
    });
    expect(result.reason).toBe("flag-column");
    expect(result.flags).toEqual([true, false]);
  });

  it("no flags field at all behaves exactly as before", () => {
    const result = detectRowAnomalies({
      columns: ["is_fraud"],
      rows: [[1], [0]],
    });
    expect(result.reason).toBe("flag-column");
    expect(result.flags).toEqual([true, false]);
  });

  it("every path returns label arrays the length of the rows", () => {
    // TableView indexes these positionally, so a short array is a silent
    // undefined at render time rather than an error here.
    const rows = [[1], [0], [1]];
    for (const flags of [undefined, EMPTY_FLAGS]) {
      const result = detectRowAnomalies({ columns: ["is_fraud"], rows, flags });
      expect(result.ruleNames).toHaveLength(rows.length);
      expect(result.severities).toHaveLength(rows.length);
    }
  });
});
