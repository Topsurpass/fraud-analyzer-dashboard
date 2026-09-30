#!/usr/bin/env node
/**
 * Example queries, one per chart type, written against the payments-switch
 * table `fundgate_transactions`: what to select, which chart fits, and how the
 * chart's fields map onto the columns. Meant to be read as much as run.
 *
 *   FAE_EMAIL=you@example.com FAE_PW=... node scripts/seed-chart-examples.mjs --dry
 *   FAE_EMAIL=you@example.com FAE_PW=... node scripts/seed-chart-examples.mjs
 *
 * `--dry` previews every query (rows, timing, first rows) and writes nothing.
 * Without it, each query, its chart, its flag rules and one dashboard are
 * created, or updated in place if they already exist (matched by name, so the
 * script is safe to run twice). Everything it makes is named "Guide: ..." so it
 * can be found, and deleted, as a set. The password is read from the
 * environment and never written anywhere.
 *
 * Flags:
 *   --engine=<url>       engine base URL        (default http://127.0.0.1:8000)
 *   --connection=<name>  connection to query    (default "Simulation DB switch")
 *   --dry                preview only
 *
 * Two habits every query below shares, worth copying:
 *
 *  1. Time windows hang off the data's own newest row, not NOW(). The database
 *     clock and the timestamps in a table are often in different zones, and a
 *     simulation or a stalled feed has no rows near "now" at all: a window
 *     relative to NOW() then returns nothing and the chart looks broken. A
 *     window relative to MAX(timestamp) always has data in it.
 *  2. Always ORDER BY time, oldest first. Charts draw rows in the order the
 *     query returns them, and the period charts (compare, movers, compare_grid)
 *     split the result by position into "previous" and "current".
 */

const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [key, value] = raw.replace(/^--/, "").split("=");
    return [key, value ?? true];
  }),
);
const DRY = args.has("dry");
const ENGINE = String(args.get("engine") ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
const CONNECTION = String(args.get("connection") ?? "Simulation DB switch");
const POLL_MS = 30_000;

/* ------------------------------------------------------------ SQL helpers */

/** The newest row's timestamp: every window below is measured back from it. */
const REF = `ref AS (SELECT MAX(transaction_date_time) AS now_ts FROM fundgate_transactions)`;

/**
 * Rows of the last `count` windows of `minutes`, each tagged with `k`: 0 is the
 * newest window, `count - 1` the oldest. Equal-length windows ending exactly at
 * the newest row, so the oldest one is never a partial bucket.
 */
const windowed = (minutes, count) => `tx AS (
  SELECT t.*, ref.now_ts,
         FLOOR(EXTRACT(EPOCH FROM (ref.now_ts - t.transaction_date_time)) / ${minutes * 60})::int AS k
  FROM fundgate_transactions t, ref
  WHERE t.transaction_date_time > ref.now_ts - INTERVAL '${minutes * count} minutes'
)`;

/** A window's label: the clock time it starts at. */
const windowLabel = (minutes) =>
  `to_char(now_ts - (k + 1) * INTERVAL '${minutes} minutes', 'HH24:MI')`;

/** ISO 8583 response codes seen in this table, in words an analyst can read. */
const OUTCOME = `CASE response_code
    WHEN '00' THEN 'Approved'
    WHEN '05' THEN 'Do not honour (05)'
    WHEN '12' THEN 'Invalid transaction (12)'
    WHEN '14' THEN 'Invalid account (14)'
    WHEN '51' THEN 'Insufficient funds (51)'
    WHEN '91' THEN 'Issuer inoperative (91)'
    ELSE 'Other (' || response_code || ')'
  END`;

/* --------------------------------------------------------------- examples */

/**
 * `rules` use column names from the query's own result, not from the table: a
 * rule sees what the chart sees. `list` names a saved list for `in_list`.
 */
function examples() {
  return [
    {
      name: "Guide: Approved vs declined, every 10 minutes",
      chart: "line",
      description:
        "LINE: a trend over time, one line per series. Use it for 'is this going up, and is one group behaving differently?'. Returns one row per (time bucket, outcome): x = bucket, y = transactions, series = outcome. A series column turns one line into several.",
      sql: `WITH ${REF}, ${windowed(10, 12)}
SELECT ${windowLabel(10)} AS bucket,
       CASE WHEN response_code = '00' THEN 'approved' ELSE 'declined' END AS outcome,
       COUNT(*) AS transactions
FROM tx
GROUP BY k, now_ts, outcome
ORDER BY k DESC, outcome`,
      charts: [
        { name: "Approved vs declined", chart_type: "line", x_field: "bucket", y_field: "transactions", series_field: "outcome" },
      ],
      rules: [
        { name: "Declines spike in a bucket", severity: "medium", conditions: [
          { column_name: "outcome", operator: "eq", value: "declined" },
          { column_name: "transactions", operator: "gte", value: "HIGH_DECLINE_BUCKET" },
        ] },
      ],
    },
    {
      name: "Guide: Banks with the most declines",
      chart: "bar",
      description:
        "BAR: compare a measure across categories, biggest first. Use it for rankings: which bank, terminal or merchant has the most of something. Returns one row per category: x = bank, y = failed. Sort by the measure and LIMIT so the chart stays readable.",
      sql: `SELECT bankcode AS bank,
       COUNT(*) FILTER (WHERE response_code <> '00') AS failed
FROM fundgate_transactions
GROUP BY bankcode
ORDER BY failed DESC
LIMIT 12`,
      charts: [{ name: "Declines by bank", chart_type: "bar", x_field: "bank", y_field: "failed" }],
      rules: [
        { name: "Bank failing heavily", severity: "medium", conditions: [
          { column_name: "failed", operator: "gte", value: "HIGH_BANK_FAILS" },
        ] },
      ],
    },
    {
      name: "Guide: Why transactions fail",
      chart: "pie",
      description:
        "PIE: parts of a whole. Use it only when the categories add up to something meaningful and there are few of them (up to about 5; the rest folds into 'Other'). Returns one row per category: x = outcome, y = transactions. Here every response code becomes a named slice.",
      sql: `SELECT ${OUTCOME} AS outcome,
       COUNT(*) AS transactions
FROM fundgate_transactions
GROUP BY response_code
ORDER BY transactions DESC`,
      charts: [{ name: "Response code mix", chart_type: "pie", x_field: "outcome", y_field: "transactions" }],
      rules: [
        { name: "Issuer or switch down", severity: "high", conditions: [
          { column_name: "outcome", operator: "starts_with", value: "Issuer inoperative" },
        ] },
      ],
    },
    {
      name: "Guide: Approval rate, last 30 minutes",
      chart: "number",
      description:
        "NUMBER: one headline figure. Use it for the single thing you would check first. Returns ONE row with ONE numeric column: y = success_rate_pct. More rows are ignored (the card says how many were hidden), so aggregate in SQL.",
      // A subselect, not a one-CTE `WITH`: the engine's SELECT-only guard
      // rejects a query with exactly one CTE (see docs/query-cookbook.md).
      sql: `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE response_code = '00') / NULLIF(COUNT(*), 0), 1) AS success_rate_pct
FROM fundgate_transactions
WHERE transaction_date_time > (SELECT MAX(transaction_date_time) FROM fundgate_transactions) - INTERVAL '30 minutes'`,
      charts: [{ name: "Approval rate (30 min)", chart_type: "number", y_field: "success_rate_pct" }],
      rules: [],
    },
    {
      name: "Guide: Largest transactions",
      chart: "table",
      description:
        "TABLE: the raw rows, for review. Use it when someone has to read each record and act on it: it is the view flag rules mark row by row, and the one to search and sort. No fields to map; select exactly the columns a reviewer needs, newest or largest first, and LIMIT it.",
      sql: `SELECT id,
       transaction_date_time AS at,
       terminal_id,
       originator_account_name AS originator,
       beneficiary_account_name AS beneficiary,
       bankcode AS bank,
       amount,
       response_code
FROM fundgate_transactions
ORDER BY amount DESC
LIMIT 100`,
      charts: [{ name: "Largest transactions", chart_type: "table" }],
      rules: [
        { name: "Very large transfer", severity: "high", conditions: [
          { column_name: "amount", operator: "gte", value: "HIGH_AMOUNT" },
        ] },
        { name: "Issuer inoperative (91)", severity: "medium", conditions: [
          { column_name: "response_code", operator: "eq", value: "91" },
        ] },
        { name: "Terminal on the watchlist", severity: "high", conditions: [
          { column_name: "terminal_id", operator: "in_list", list: "MFBs Terminal" },
        ] },
      ],
    },
    {
      name: "Guide: Volume, this hour against the last",
      chart: "compare",
      description:
        "COMPARE: one measure over two consecutive windows, laid on top of each other, so the gap is what you read. Write a query that returns TWICE the window you care about (here 12 ten-minute buckets = 2 hours); the older half is 'previous', the newer half 'current', split by row position. Zero-fill with generate_series so both halves are the same length. x = bucket, y = transactions.",
      sql: `WITH ${REF}, ${windowed(10, 12)}, slots AS (SELECT g AS k FROM generate_series(0, 11) g)
SELECT to_char((SELECT now_ts FROM ref) - (s.k + 1) * INTERVAL '10 minutes', 'HH24:MI') AS bucket,
       COUNT(tx.k) AS transactions
FROM slots s
LEFT JOIN tx ON tx.k = s.k
GROUP BY s.k
ORDER BY s.k DESC`,
      charts: [{ name: "Volume now vs previous", chart_type: "compare", x_field: "bucket", y_field: "transactions" }],
      rules: [
        { name: "Busy bucket", severity: "low", conditions: [
          { column_name: "transactions", operator: "gte", value: "HIGH_BUCKET" },
        ] },
      ],
    },
    {
      name: "Guide: Terminals that moved most",
      chart: "movers",
      description:
        "MOVERS: the same two windows as COMPARE, but totalled per category and ranked by change, so it names the suspect: 'which terminal moved', not 'did it move'. Returns one row per (window, terminal): x = window, y = transactions, series = terminal. Four 30-minute windows: the older two are 'previous', the newer two 'current'.",
      sql: `WITH ${REF}, ${windowed(30, 4)},
top AS (SELECT terminal_id FROM tx GROUP BY terminal_id ORDER BY COUNT(*) DESC LIMIT 15)
SELECT ${windowLabel(30)} AS window_start,
       terminal_id AS terminal,
       COUNT(*) AS transactions
FROM tx
WHERE terminal_id IN (SELECT terminal_id FROM top)
GROUP BY k, now_ts, terminal_id
ORDER BY k DESC, terminal_id`,
      charts: [
        { name: "Terminal movers", chart_type: "movers", x_field: "window_start", y_field: "transactions", series_field: "terminal", surge_threshold_pct: 25 },
      ],
      rules: [
        { name: "Terminal surge", severity: "medium", conditions: [
          { column_name: "transactions", operator: "gte", value: "HIGH_MOVER_WINDOW" },
        ] },
        // Marks a row only when a listed terminal is in the result: a list is a
        // watchlist you maintain once and reuse, not a filter on the query.
        { name: "Watchlist terminal active", severity: "high", conditions: [
          { column_name: "terminal", operator: "in_list", list: "MFBs Terminal" },
        ] },
      ],
    },
    {
      name: "Guide: Each terminal's rhythm",
      chart: "compare_grid",
      description:
        "COMPARE_GRID: one COMPARE panel per category, as small multiples. MOVERS says who changed; this shows HOW: a terminal changing its rhythm rather than its level. Same query shape as MOVERS (x = window, y = transactions, series = terminal) with smaller windows so each panel has a curve. Keep the category count low (8 here).",
      sql: `WITH ${REF}, ${windowed(10, 12)},
top AS (SELECT terminal_id FROM tx GROUP BY terminal_id ORDER BY COUNT(*) DESC LIMIT 8)
SELECT ${windowLabel(10)} AS window_start,
       terminal_id AS terminal,
       COUNT(*) AS transactions
FROM tx
WHERE terminal_id IN (SELECT terminal_id FROM top)
GROUP BY k, now_ts, terminal_id
ORDER BY k DESC, terminal_id`,
      charts: [
        { name: "Terminal rhythm", chart_type: "compare_grid", x_field: "window_start", y_field: "transactions", series_field: "terminal", surge_threshold_pct: 30 },
      ],
      rules: [
        { name: "Terminal burst", severity: "medium", conditions: [
          { column_name: "transactions", operator: "gte", value: "HIGH_TERMINAL_WINDOW" },
        ] },
      ],
    },
    {
      name: "Guide: Where and when declines cluster",
      chart: "heatmap",
      description:
        "HEATMAP: a category against time, coloured by the measure. Use it to find the odd row or odd hour among many categories, which fifty line charts cannot show. One row per (bank, time bucket): x = window (columns), series = bank (rows), y = failed. Limit the categories and buckets so cells stay readable.",
      sql: `WITH ${REF}, ${windowed(30, 4)},
top AS (SELECT bankcode FROM tx WHERE response_code <> '00' GROUP BY bankcode ORDER BY COUNT(*) DESC LIMIT 12)
SELECT ${windowLabel(30)} AS window_start,
       bankcode AS bank,
       COUNT(*) FILTER (WHERE response_code <> '00') AS failed
FROM tx
WHERE bankcode IN (SELECT bankcode FROM top)
GROUP BY k, now_ts, bankcode
ORDER BY k DESC, bankcode`,
      charts: [
        { name: "Declines by bank and time", chart_type: "heatmap", x_field: "window_start", y_field: "failed", series_field: "bank" },
      ],
      rules: [
        { name: "Bank failing hard in a window", severity: "high", conditions: [
          { column_name: "failed", operator: "gte", value: "HIGH_HEAT_CELL" },
        ] },
      ],
    },
    {
      name: "Guide: Outcomes per 10 minutes, stacked",
      chart: "stacked_bar",
      description:
        "STACKED BAR: the total AND what it is made of, in one column. Use it when parts matter as much as the whole, over time or across categories. Same shape as a multi-series bar: one row per (bucket, part): x = bucket, y = transactions, series = the part being stacked (3 groups here). No series column would give a plain bar.",
      sql: `WITH ${REF}, ${windowed(10, 12)}
SELECT ${windowLabel(10)} AS bucket,
       CASE WHEN response_code = '00' THEN 'Approved'
            WHEN response_code = '51' THEN 'Insufficient funds'
            ELSE 'Other declines' END AS outcome,
       COUNT(*) AS transactions
FROM tx
GROUP BY k, now_ts, outcome
ORDER BY k DESC, outcome`,
      charts: [
        { name: "Outcomes stacked", chart_type: "stacked_bar", x_field: "bucket", y_field: "transactions", series_field: "outcome" },
      ],
      rules: [
        { name: "Insufficient-funds surge", severity: "medium", conditions: [
          { column_name: "outcome", operator: "eq", value: "Insufficient funds" },
          { column_name: "transactions", operator: "gte", value: "HIGH_FUNDS_BUCKET" },
        ] },
      ],
    },
    {
      name: "Guide: Volume against decline rate",
      chart: "biaxial_bar",
      description:
        "TWO-AXIS BAR: two measures on different scales, each on its own axis, so a count in the thousands and a percentage under 100 are both readable. Wide form, ONE row per bucket with a column per measure: x = bucket, y_field = left-axis column (transactions), series_field = RIGHT-axis column (decline_rate_pct). The series field is the second measure here, not a split.",
      sql: `WITH ${REF}, ${windowed(10, 12)}
SELECT ${windowLabel(10)} AS bucket,
       COUNT(*) AS transactions,
       ROUND(100.0 * COUNT(*) FILTER (WHERE response_code <> '00') / COUNT(*), 1) AS decline_rate_pct
FROM tx
GROUP BY k, now_ts
ORDER BY k DESC`,
      charts: [
        { name: "Volume vs decline rate", chart_type: "biaxial_bar", x_field: "bucket", y_field: "transactions", series_field: "decline_rate_pct" },
      ],
      rules: [
        { name: "Decline rate over threshold", severity: "high", conditions: [
          { column_name: "decline_rate_pct", operator: "gte", value: "HIGH_RATE" },
        ] },
      ],
    },
  ];
}

/* ------------------------------------------------------------------- run */

const email = process.env.FAE_EMAIL;
const password = process.env.FAE_PW;
if (!email || !password) {
  console.error("Set FAE_EMAIL and FAE_PW in the environment (they are never written to disk).");
  process.exit(2);
}

async function call(method, path, body, token) {
  const response = await fetch(ENGINE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: response.status, ok: response.ok, json, text };
}

const login = await call("POST", "/auth/login", { email, password });
if (!login.ok) {
  console.error(`sign-in failed (${login.status}): ${login.json?.message ?? login.text}`);
  process.exit(2);
}
const token = login.json.token;
const api = (method, path, body) => call(method, path, body, token);

const connections = (await api("GET", "/connections")).json;
const connection = connections.find((c) => c.name === CONNECTION);
if (!connection) {
  console.error(`no connection named "${CONNECTION}". Have: ${connections.map((c) => c.name).join(", ")}`);
  process.exit(2);
}
const lists = (await api("GET", "/lists")).json;
const listId = (name) => lists.find((l) => l.name === name)?.id;

/** Thresholds are read off the data, so a rule flags the top of THIS result
 *  rather than a number that only made sense on someone else's. */
function tune(sql) { return sql; }

const thresholds = {};
const defs = examples();

console.log(`${DRY ? "DRY RUN " : ""}on ${connection.name} (${connection.db_type}), signed in as ${email}\n`);

const previews = new Map();
for (const def of defs) {
  const res = await api("POST", `/connections/${connection.id}/query/preview`, { sql_text: tune(def.sql), row_limit: 2000 });
  previews.set(def.name, res);
  console.log(`${res.ok ? "ok  " : "FAIL"} ${def.chart.padEnd(13)} ${def.name}`);
  if (!res.ok) {
    console.log("     " + (res.json?.message ?? res.text).slice(0, 300));
    continue;
  }
  const { columns, rows, row_count, duration_ms } = res.json;
  console.log(`     ${row_count} rows, ${duration_ms} ms | ${columns.join(", ")}`);
  if (DRY) for (const row of rows.slice(0, 4)) console.log("       " + row.join(" | "));
}

/** The value a fraction of the way up a column, for rule thresholds. */
function quantile(defName, column, q, where) {
  const res = previews.get(defName)?.json;
  if (!res) return null;
  const index = res.columns.indexOf(column);
  // `where` narrows to the rows the rule will actually apply to: a rule on
  // "insufficient funds" must be sized against those rows, not against the
  // approved ones that dwarf them.
  const rows = where ? res.rows.filter((r) => where(Object.fromEntries(res.columns.map((c, i) => [c, r[i]])))) : res.rows;
  const values = rows.map((r) => Number(r[index])).filter(Number.isFinite).sort((a, b) => a - b);
  if (values.length === 0) return null;
  return values[Math.min(values.length - 1, Math.floor(q * values.length))];
}

// Each placeholder in `rules` is a high quantile of the column it guards,
// measured over the rows the rule applies to.
const T = (name, column, q, where) => String(Math.round((quantile(name, column, q, where) ?? 0) * 10) / 10);
thresholds.HIGH_DECLINE_BUCKET = T("Guide: Approved vs declined, every 10 minutes", "transactions", 0.8, (r) => r.outcome === "declined");
thresholds.HIGH_BANK_FAILS = T("Guide: Banks with the most declines", "failed", 0.7);
thresholds.HIGH_BUCKET = T("Guide: Volume, this hour against the last", "transactions", 0.75);
thresholds.HIGH_TERMINAL_WINDOW = T("Guide: Each terminal's rhythm", "transactions", 0.95);
thresholds.HIGH_MOVER_WINDOW = T("Guide: Terminals that moved most", "transactions", 0.9);
thresholds.HIGH_HEAT_CELL = T("Guide: Where and when declines cluster", "failed", 0.9);
thresholds.HIGH_FUNDS_BUCKET = T("Guide: Outcomes per 10 minutes, stacked", "transactions", 0.8, (r) => r.outcome === "Insufficient funds");
thresholds.HIGH_RATE = T("Guide: Volume against decline rate", "decline_rate_pct", 0.75);
thresholds.HIGH_AMOUNT = T("Guide: Largest transactions", "amount", 0.9);

console.log("\nrule thresholds read from the data:", JSON.stringify(thresholds));
if (DRY) {
  console.log("\n--dry: nothing was written.");
  process.exit(0);
}

const failed = [...previews].filter(([, r]) => !r.ok).map(([n]) => n);
if (failed.length) {
  console.error("\nnot writing: these queries failed to preview:\n  " + failed.join("\n  "));
  process.exit(1);
}

/* --------------------------------------------------------- write them all */

console.log("");
const existing = (await api("GET", `/connections/${connection.id}/queries`)).json;
const byName = new Map(existing.map((q) => [q.name, q]));
const chartIds = [];

for (const def of defs) {
  const spec = {
    name: def.name,
    description: def.description,
    sql_text: def.sql,
    row_limit: 2000,
    poll_interval_ms: POLL_MS,
  };
  let query = byName.get(def.name);
  const write = query
    ? await api("PUT", `/queries/${query.id}`, spec)
    : await api("POST", `/connections/${connection.id}/queries`, spec);
  if (!write.ok) {
    console.error(`FAIL save ${def.name}: ${write.json?.message ?? write.text}`);
    process.exit(1);
  }
  query = write.json;

  const charts = await api("PUT", `/queries/${query.id}/charts`, { charts: def.charts });
  if (!charts.ok) {
    console.error(`FAIL charts ${def.name}: ${charts.json?.message ?? charts.text}`);
    process.exit(1);
  }
  chartIds.push(...charts.json.charts.map((c) => c.id));

  const rules = def.rules.map((rule) => ({
    name: rule.name,
    severity: rule.severity,
    enabled: true,
    conditions: rule.conditions.map((c) => {
      if (c.operator === "in_list" || c.operator === "not_in_list") {
        const id = listId(c.list);
        if (!id) throw new Error(`no list named "${c.list}"`);
        return { column_name: c.column_name, operator: c.operator, list_id: id };
      }
      return {
        column_name: c.column_name,
        operator: c.operator,
        value: c.value in thresholds ? thresholds[c.value] : c.value,
      };
    }),
  }));
  const saved = await api("PUT", `/queries/${query.id}/flag-rules`, { rules });
  if (!saved.ok) {
    console.error(`FAIL rules ${def.name}: ${saved.json?.message ?? saved.text}`);
    process.exit(1);
  }
  console.log(`${query ? "saved" : "saved"}  ${def.chart.padEnd(13)} ${def.name}  (${rules.length} rule${rules.length === 1 ? "" : "s"})`);
}

const DASHBOARD = "Guide: one of every chart";
const dashboards = (await api("GET", "/dashboards")).json;
const board = dashboards.find((d) => d.name === DASHBOARD);
const result = board
  ? await api("PUT", `/dashboards/${board.id}`, { name: DASHBOARD, chart_ids: chartIds })
  : await api("POST", "/dashboards", { name: DASHBOARD, chart_ids: chartIds });
console.log(result.ok ? `\ndashboard "${DASHBOARD}" ${board ? "updated" : "created"} with ${chartIds.length} charts` : `\nFAIL dashboard: ${result.text}`);
