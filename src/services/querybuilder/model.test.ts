import { describe, expect, it } from "vitest";
import type { FlagRule, QueryChartInput } from "@/contracts/api";
import {
  computeBlockers,
  computeOutline,
  computeWarnings,
  isPristineChart,
  scheduleSentence,
  suggestChart,
  type BuilderInput,
} from "./model";

const chart = (over: Partial<QueryChartInput> = {}): QueryChartInput => ({
  name: "Chart 1",
  chart_type: "bar",
  x_field: "country",
  y_field: "declines",
  series_field: "",
  ...over,
});
const rule = (over: Partial<FlagRule> = {}): FlagRule => ({
  name: "Big",
  severity: "high",
  enabled: true,
  conditions: [{ column_name: "amount", operator: "gte", value: "100" }],
  ...over,
});
const input = (over: Partial<BuilderInput> = {}): BuilderInput => ({
  name: "Declines",
  sql: "SELECT 1",
  hasPreview: true,
  previewStale: false,
  previewFailed: false,
  previewRows: 12,
  charts: [chart()],
  columns: ["country", "declines"],
  rules: [],
  pollInterval: "",
  ...over,
});
const state = (over: Partial<BuilderInput>, id: string) =>
  computeOutline(input(over)).find((part) => part.id === id)!;

describe("computeBlockers", () => {
  it("is empty for a complete query", () => {
    expect(computeBlockers(input())).toEqual([]);
  });

  it("names a missing name and missing SQL, pointing at their fields", () => {
    const blockers = computeBlockers(input({ name: "  ", sql: "" }));
    expect(blockers.map((b) => b.text)).toEqual(["Give the query a name", "Write the SQL"]);
    expect(blockers.map((b) => b.target)).toEqual(["query-name", "query-sql"]);
  });

  it("blocks on a chart with no name or a duplicate name, which the engine would refuse", () => {
    expect(computeBlockers(input({ charts: [chart({ name: "" })] }))[0]).toMatchObject({ part: "charts" });
    const twice = computeBlockers(input({ charts: [chart(), chart()] }));
    expect(twice).toHaveLength(1);
    expect(twice[0].text).toContain("already called");
  });

  it("does not block on a chart missing an axis: that is a warning", () => {
    const missing = input({ charts: [chart({ y_field: "" })] });
    expect(computeBlockers(missing)).toEqual([]);
    expect(computeWarnings(missing)).toHaveLength(1);
    expect(computeWarnings(missing)[0].part).toBe("charts");
  });

  it("blocks on an incomplete rule, and says which one", () => {
    const blockers = computeBlockers(input({ rules: [rule({ name: "" })] }));
    expect(blockers).toHaveLength(1);
    expect(blockers[0].part).toBe("rules");
    expect(blockers[0].text).toBe("Rule 1: A rule needs a name.");
  });

  it("blocks on a condition with no column, naming the rule", () => {
    const empty = rule({ name: "Big", conditions: [{ column_name: "", operator: "gte", value: "" }] });
    expect(computeBlockers(input({ rules: [empty] })).map((b) => b.text)).toEqual(["Rule “Big”: Pick a column."]);
  });

  it("blocks on a comparison with no value", () => {
    const noValue = rule({ name: "Big", conditions: [{ column_name: "amount", operator: "gte", value: "" }] });
    expect(computeBlockers(input({ rules: [noValue] }))[0].text).toContain("needs a value");
  });

  it("blocks on an interval of zero, and not on none", () => {
    expect(computeBlockers(input({ pollInterval: "0" }))[0]).toMatchObject({ part: "schedule", target: "query-poll" });
    expect(computeBlockers(input({ pollInterval: "" }))).toEqual([]);
    expect(computeBlockers(input({ pollInterval: "5000" }))).toEqual([]);
  });

  it("lists everything at once, in the order a person fixes it", () => {
    const blockers = computeBlockers(input({ name: "", sql: "", rules: [rule({ name: "" })], pollInterval: "0" }));
    expect(blockers.map((b) => b.part)).toEqual(["query", "query", "rules", "schedule"]);
  });
});

describe("computeOutline: query and results", () => {
  it("starts with everything still to do", () => {
    const outline = computeOutline(input({ name: "", sql: "", hasPreview: false, charts: [chart()], columns: [] }));
    expect(outline.map((part) => part.id)).toEqual(["query", "results", "charts", "rules", "schedule"]);
    expect(state({ name: "", sql: "", hasPreview: false, columns: [] }, "query")).toMatchObject({ state: "todo", note: "Write the SQL" });
    expect(state({ sql: "", hasPreview: false, columns: [] }, "results").state).toBe("todo");
  });

  it("asks for a name once there is SQL", () => {
    expect(state({ name: "" }, "query")).toMatchObject({ state: "attention", note: "Needs a name" });
  });

  it("says to run a preview, then how many rows came back", () => {
    expect(state({ hasPreview: false, columns: [] }, "results")).toMatchObject({ state: "todo", note: "Run a preview" });
    expect(state({}, "results")).toMatchObject({ state: "done", note: "12 rows" });
    expect(state({ previewRows: 1 }, "results").note).toBe("1 row");
  });

  it("flags results as out of date after the SQL changes, and a failed preview", () => {
    expect(state({ previewStale: true }, "results")).toMatchObject({ state: "attention", note: "Out of date" });
    expect(state({ previewFailed: true, hasPreview: false }, "results")).toMatchObject({ state: "attention", note: "Preview failed" });
  });
});

describe("computeOutline: charts, rules, schedule", () => {
  it("holds the charts back until a preview has given it columns", () => {
    expect(state({ hasPreview: false, columns: [], charts: [chart()] }, "charts")).toMatchObject({ state: "todo", note: "Needs a preview first" });
  });

  it("asks for a chart when there are none", () => {
    expect(state({ charts: [] }, "charts")).toMatchObject({ state: "attention", note: "Add a chart" });
  });

  it("is done with charts that are complete, and says what is missing otherwise", () => {
    expect(state({}, "charts")).toMatchObject({ state: "done", note: "1 chart" });
    expect(state({ charts: [chart({ y_field: "" })] }, "charts").state).toBe("attention");
    expect(state({ charts: [chart(), chart({ name: "Chart 2" })] }, "charts").note).toBe("2 charts");
  });

  it("treats rules as optional until there is one", () => {
    expect(state({ rules: [] }, "rules")).toMatchObject({ state: "optional", note: "Optional" });
    expect(state({ rules: [rule()] }, "rules")).toMatchObject({ state: "done", note: "1 rule" });
    expect(state({ rules: [rule({ name: "" })] }, "rules").state).toBe("attention");
  });

  it("is done for the schedule unless the interval is zero", () => {
    expect(state({}, "schedule")).toMatchObject({ state: "done", note: "Default" });
    expect(state({ pollInterval: "60000" }, "schedule")).toMatchObject({ state: "done", note: "Set" });
    expect(state({ pollInterval: "0" }, "schedule").state).toBe("attention");
  });
});

describe("scheduleSentence", () => {
  it("says it in words", () => {
    expect(scheduleSentence("")).toBe("Uses the engine's default interval");
    expect(scheduleSentence("300000")).toBe("Runs at most once every 5 minutes");
    expect(scheduleSentence("3600000")).toBe("Runs at most once every 1 hour");
    expect(scheduleSentence("0")).toBe("Needs an interval above zero");
  });
});

describe("suggestChart", () => {
  it("offers nothing without rows or columns", () => {
    expect(suggestChart([], [])).toBeNull();
    expect(suggestChart(["a"], [])).toBeNull();
  });

  it("suggests a number for one row with a figure", () => {
    expect(suggestChart(["success_rate_pct"], [[52.1]])).toMatchObject({ chart_type: "number", y_field: "success_rate_pct" });
  });

  it("suggests a line for a time column and a number, split by a label if there is one", () => {
    const plain = suggestChart(["bucket", "transactions"], [["07:44", 146], ["07:54", 134]]);
    expect(plain).toMatchObject({ chart_type: "line", x_field: "bucket", y_field: "transactions", series_field: "" });
    const split = suggestChart(["bucket", "outcome", "transactions"], [["07:44", "approved", 146], ["07:44", "declined", 92]]);
    expect(split).toMatchObject({ chart_type: "line", series_field: "outcome" });
  });

  it("recognises dates by their values when the name gives nothing away", () => {
    expect(suggestChart(["x", "n"], [["2026-10-01", 1], ["2026-10-02", 2]])?.chart_type).toBe("line");
  });

  it("suggests a bar for a label and a number", () => {
    expect(suggestChart(["bank", "failed"], [["011", 320], ["232", 311]])).toMatchObject({ chart_type: "bar", x_field: "bank", y_field: "failed" });
  });

  it("suggests stacked bars for two labels and a number", () => {
    expect(suggestChart(["bank", "outcome", "n"], [["011", "approved", 3], ["011", "declined", 1]])).toMatchObject({ chart_type: "stacked_bar", series_field: "outcome" });
  });

  it("treats codes with a leading zero as labels, not quantities", () => {
    // A bank code and a response code are things to group by.
    const bar = suggestChart(["bank", "response_code", "failed"], [["011", "00", 320], ["232", "05", 311]]);
    expect(bar).toMatchObject({ chart_type: "stacked_bar", x_field: "bank", series_field: "response_code", y_field: "failed" });
    expect(suggestChart(["amount"], [["0.5"]])?.chart_type).toBe("number");
  });

  it("reads numbers that arrive as text", () => {
    expect(suggestChart(["bank", "failed"], [["011", "320"], ["232", "311.5"]])?.chart_type).toBe("bar");
  });

  it("says nothing when there is no label or no number to draw", () => {
    expect(suggestChart(["a", "b"], [["x", "y"], ["z", "w"]])).toBeNull();
    expect(suggestChart(["a", "b"], [[1, 2], [3, 4]])).toBeNull();
  });

  it("always gives a reason a person can judge it by", () => {
    expect(suggestChart(["bank", "failed"], [["011", 320], ["232", 311]])?.reason).toContain("failed");
  });
});

describe("isPristineChart", () => {
  it("is true only for the untouched starting table", () => {
    expect(isPristineChart(chart({ chart_type: "table", x_field: "", y_field: "", series_field: "" }))).toBe(true);
    expect(isPristineChart(chart({ chart_type: "table", x_field: "a", y_field: "", series_field: "" }))).toBe(false);
    expect(isPristineChart(chart())).toBe(false);
  });
});
