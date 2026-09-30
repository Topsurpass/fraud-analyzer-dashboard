/**
 * The example queries, one per chart type, on the payments-switch table
 * `fundgate_transactions`. Shared by `scripts/seed-chart-examples.mjs` (which
 * saves them to an engine) and `scripts/sync-query-docs.mjs` (which writes their
 * SQL into docs/query-cookbook.md), so the guide can never show a query that is
 * not the one that runs.
 *
 * See the notes at the top of seed-chart-examples.mjs for the two habits every
 * query here shares: windows anchored on the data's newest row, and ORDER BY time.
 */

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
export function examples() {
  return [
    {
      name: "Guide: Approved vs declined, every 10 minutes",
      chart: "line",
      description:
        "LINE: a trend over time, one line per series. Use it for 'is this going up, and is one group behaving differently?'. Returns one row per (time bucket, outcome): x = bucket, y = transactions, series = outcome. A series column turns one line into several.",
      sql: `WITH ${REF},
${windowed(10, 12)}
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
      sql: `WITH ${REF},
${windowed(10, 12)},
slots AS (SELECT g AS k FROM generate_series(0, 11) g)
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
      sql: `WITH ${REF},
${windowed(30, 4)},
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
      sql: `WITH ${REF},
${windowed(10, 12)},
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
      sql: `WITH ${REF},
${windowed(30, 4)},
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
      sql: `WITH ${REF},
${windowed(10, 12)}
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
      sql: `WITH ${REF},
${windowed(10, 12)}
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

