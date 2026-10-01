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

import { examples } from "./lib/chart-examples.mjs";

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
