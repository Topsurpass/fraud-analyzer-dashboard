import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHART_TYPES } from "@/contracts/api";
import { examples } from "../../../scripts/lib/chart-examples.mjs";
import { renderDoc } from "../../../scripts/lib/query-docs.mjs";

/**
 * The example queries double as the documentation: docs/query-cookbook.md takes
 * its SQL, field mapping and rules from them. These tests keep three promises:
 * the guide is never stale, every chart type has a worked example, and each
 * example follows the habits the guide teaches (so it cannot quietly stop being a
 * good model to copy).
 */

type Example = {
  name: string;
  chart: string;
  sql: string;
  charts: { chart_type: string; x_field?: string; y_field?: string; series_field?: string }[];
  rules: { conditions: { column_name: string }[] }[];
};

const all = examples() as Example[];
// Tests run from the project root.
const doc = readFileSync(join(process.cwd(), "docs/query-cookbook.md"), "utf8");

describe("the query cookbook", () => {
  it("is in sync with the examples (run `node scripts/sync-query-docs.mjs` if this fails)", () => {
    expect(renderDoc(doc, all)).toBe(doc);
  });

  it("has a worked example for every chart type, and only those", () => {
    expect(all.map((e) => e.chart).sort()).toEqual([...CHART_TYPES].sort());
  });

  it("has a section and a generated block for every chart type", () => {
    for (const type of CHART_TYPES) {
      expect(doc, `heading for ${type}`).toContain(`### \`${type}\``);
      expect(doc, `generated block for ${type}`).toContain(`<!-- example:${type} -->`);
      expect(doc, `generated block end for ${type}`).toContain(`<!-- /example:${type} -->`);
    }
  });

  it("states the mapping of every field in the at-a-glance table", () => {
    const glance = doc.slice(doc.indexOf("## At a glance"), doc.indexOf("## Choosing a chart"));
    for (const type of CHART_TYPES) expect(glance, type).toContain(`\`${type}\``);
  });

  it("refuses a block for an example that does not exist", () => {
    expect(() => renderDoc("<!-- example:nope -->\n<!-- /example:nope -->", all)).toThrow(
      /does not exist/,
    );
  });
});

describe("each example", () => {
  it("draws exactly the chart type it is filed under", () => {
    for (const e of all) expect(e.charts.map((c) => c.chart_type), e.name).toEqual([e.chart]);
  });

  it("returns the columns its chart reads, under those names", () => {
    // A chart field naming a column the query does not return is the commonest
    // reason for an empty chart; every mapped name must be an alias in the SQL.
    for (const e of all) {
      const chart = e.charts[0];
      for (const field of [chart.x_field, chart.y_field, chart.series_field]) {
        if (!field) continue;
        expect(e.sql, `${e.name}: ${field}`).toMatch(new RegExp(`\\bAS ${field}\\b`, "i"));
      }
    }
  });

  it("guards on columns the query returns", () => {
    for (const e of all) {
      const chart = e.charts[0];
      const returned = [chart.x_field, chart.y_field, chart.series_field].filter(Boolean);
      for (const rule of e.rules) {
        for (const condition of rule.conditions) {
          const known =
            returned.includes(condition.column_name) ||
            new RegExp(`\\bAS ${condition.column_name}\\b|\\b${condition.column_name}\\b`, "i").test(e.sql);
          expect(known, `${e.name}: rule column ${condition.column_name}`).toBe(true);
        }
      }
    }
  });

  it("measures time from the data, never from NOW()", () => {
    for (const e of all) expect(e.sql, e.name).not.toMatch(/\bnow\s*\(/i);
  });

  it("orders its rows, oldest first where there is time", () => {
    for (const e of all) {
      // A single figure has nothing to order.
      if (e.chart === "number") continue;
      expect(e.sql, e.name).toMatch(/ORDER BY/i);
    }
  });

  it("never has exactly one CTE, which the engine's SELECT-only guard rejects", () => {
    for (const e of all) {
      if (!/^\s*WITH\b/i.test(e.sql)) continue;
      const ctes = e.sql.match(/\b\w+ AS \(\s*(SELECT|\n)/gi) ?? [];
      expect(ctes.length, e.name).toBeGreaterThanOrEqual(2);
    }
  });

  it("is a bounded read: a limit, a window, or one aggregated row", () => {
    for (const e of all) {
      expect(/LIMIT \d+|INTERVAL|generate_series|GROUP BY/i.test(e.sql), e.name).toBe(true);
      expect(e.sql, e.name).not.toMatch(/\b(insert|update|delete|drop|alter|truncate)\b/i);
    }
  });
});
