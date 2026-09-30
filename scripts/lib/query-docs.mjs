/**
 * Keeps docs/query-cookbook.md honest.
 *
 * The prose in the cookbook is written by hand; the parts that must match the
 * running examples (the SQL, the chart field mapping, the flag rules) sit between
 * marker comments and are generated from `chart-examples.mjs`:
 *
 *   <!-- example:line -->  ...generated...  <!-- /example:line -->
 *
 * `renderDoc` returns the document with every marked block regenerated, so
 * `sync-query-docs.mjs` can rewrite the file and the test can assert that the file
 * on disk already equals the result (a stale doc fails the build).
 */

/** The value a rule placeholder stands for, in words, since it is read off the data at seed time. */
function describeValue(value, column) {
  return /^HIGH_/.test(value) ? `a high value of ${column} (read off your data when seeded)` : value;
}

const OPERATOR_WORDS = {
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  eq: "=",
  neq: "!=",
  starts_with: "starts with",
  contains: "contains",
  in_list: "is in list",
  not_in_list: "is not in list",
};

function conditionText(c) {
  const op = OPERATOR_WORDS[c.operator] ?? c.operator;
  if (c.operator === "in_list" || c.operator === "not_in_list") return `\`${c.column_name}\` ${op} "${c.list}"`;
  return `\`${c.column_name}\` ${op} ${/^HIGH_/.test(c.value) ? describeValue(c.value, c.column_name) : `\`${c.value}\``}`;
}

/** The generated block for one example: mapping, SQL and rules. */
export function exampleBlock(def) {
  const chart = def.charts[0];
  const lines = [];
  lines.push(`Saved as **${def.name}**, drawn as \`${chart.chart_type}\`.`, "");
  lines.push("What the chart reads from the result:", "");
  lines.push("| Chart field | Column |", "| --- | --- |");
  for (const field of ["x_field", "y_field", "series_field"]) {
    if (chart[field]) lines.push(`| \`${field}\` | \`${chart[field]}\` |`);
  }
  if (chart.surge_threshold_pct) {
    lines.push(`| \`surge_threshold_pct\` | ${chart.surge_threshold_pct} (percent change worth calling out) |`);
  }
  if (!chart.x_field && !chart.y_field && !chart.series_field) lines.push("| (none) | every column is shown as returned |");
  lines.push("", "```sql", def.sql.trim(), "```", "");
  if (def.rules.length > 0) {
    lines.push("Rules the example adds (a row is marked when **all** of a rule's conditions match):", "");
    for (const rule of def.rules) {
      lines.push(`- **${rule.name}** (${rule.severity}): ${rule.conditions.map(conditionText).join(" and ")}`);
    }
  } else {
    lines.push("No rules: a number card shows one figure and has no rows to mark.");
  }
  return lines.join("\n");
}

/** Regenerate every `<!-- example:NAME -->` block in `text` from the examples. */
export function renderDoc(text, examples) {
  const byChart = new Map(examples.map((e) => [e.chart, e]));
  return text.replace(
    /<!-- example:([a-z_]+) -->[\s\S]*?<!-- \/example:\1 -->/g,
    (_whole, name) => {
      const def = byChart.get(name);
      if (!def) throw new Error(`docs mention example "${name}", which does not exist`);
      return `<!-- example:${name} -->\n${exampleBlock(def)}\n<!-- /example:${name} -->`;
    },
  );
}
