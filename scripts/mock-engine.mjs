#!/usr/bin/env node
/**
 * Dev-only: a tiny stand-in for the Fraud Analyzer Engine, so the dashboard can
 * be signed into and looked at without a database, a real account or the
 * engine repo running. Serves deterministic fixtures for every chart type.
 *
 *   node scripts/mock-engine.mjs [--port=8100]
 *   ENGINE_BASE_URL=http://127.0.0.1:8100 npm run dev -- --port 3100
 *   node scripts/shoot.mjs ./shots --base=http://127.0.0.1:3100 \
 *        --engine=http://127.0.0.1:8100 --password=demo --routes=/,/dashboards/d1
 *
 * Any email and the password "demo" sign in. Nothing here is used by tests or
 * production code.
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const port = Number(
  process.argv.find((a) => a.startsWith("--port="))?.split("=")[1] ?? 8100,
);

/** How long the mock keeps a result before "running" the query again. */
const POLL_MS = Number(process.env.MOCK_POLL_MS ?? 5000);

const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

const user = {
  id: "u1",
  email: "ada@fraudguard.io",
  full_name: "Ada Lovelace",
  // MOCK_ROLE=analyst signs in as an analyst, so the 403 a non-owner gets on
  // someone else's list can be looked at.
  role: process.env.MOCK_ROLE === "analyst" ? "analyst" : "admin",
  is_active: true,
  must_change_password: false,
  last_login_at: iso(3_600_000),
  created_at: iso(86_400_000 * 40),
};

const connections = [
  ["c1", "Payments (prod)", "postgres", "ok"],
  ["c2", "Card authorisations", "postgres", "ok"],
  ["c3", "Ledger replica", "mysql", "ok"],
  ["c4", "Chargebacks", "postgres", "failed"],
].map(([id, name, db_type, status]) => ({
  id,
  name,
  db_type,
  host: `${id}.db.internal`,
  port: db_type === "mysql" ? 3306 : 5432,
  database: name.split(" ")[0].toLowerCase(),
  username: "readonly",
  sqlite_path: null,
  ssl_mode: "require",
  ssl_root_cert: null,
  paused: false,
  status,
  last_tested_at: iso(120_000),
  last_test_error: status === "failed" ? "timeout expired connecting to host" : null,
  created_at: iso(86_400_000 * 30),
  updated_at: iso(120_000),
}));

/* Deterministic pseudo-random so screenshots do not flicker between runs. */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function hours(n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(NOW - (n - i) * 3_600_000);
    return `${String(d.getHours()).padStart(2, "0")}:00`;
  });
}

const rand = rng(7);
const labels = hours(24);
const approved = labels.map((l, i) => [l, Math.round(1800 + Math.sin(i / 3) * 420 + rand() * 160)]);
const declined = labels.map((l, i) => [l, Math.round(260 + Math.cos(i / 4) * 70 + rand() * 40 + (i === 17 ? 330 : 0))]);
const flaggedSeries = labels.map((l, i) => [l, Math.round(24 + rand() * 18 + (i > 15 ? (i - 15) * 9 : 0))]);

const countries = ["NG", "US", "GB", "BR", "IN", "DE", "RO", "VN"];
const merchants = ["Northwind Air", "Lumen Telecom", "Kite Games", "Orbit Fuel", "Hexa Crypto", "Pluto Eats", "Mosaic Retail", "Zenith Travel"];
const tx = Array.from({ length: 140 }, (_, i) => {
  const r = rng(i * 13 + 5);
  const amount = Math.round((r() * r() * 4800 + 12) * 100) / 100;
  const risk = Math.min(99, Math.round(r() * 60 + (amount > 2000 ? 35 : 0)));
  return [
    `TX-${48200 + i}`,
    merchants[Math.floor(r() * merchants.length)],
    countries[Math.floor(r() * countries.length)],
    amount,
    risk,
    risk > 80 ? "blocked" : risk > 55 ? "review" : "approved",
    iso(i * 97_000),
  ];
});

const runs = {
  volume: {
    columns: ["hour", "approved", "declined"],
    rows: labels.map((l, i) => [l, approved[i][1], declined[i][1]]),
  },
  flagged: {
    columns: ["hour", "flagged"],
    rows: flaggedSeries,
  },
  mix: {
    columns: ["outcome", "count"],
    rows: [["approved", 41820], ["review", 3290], ["declined", 5610], ["blocked", 842], ["refunded", 611], ["disputed", 204]],
  },
  // Long form: one row per hour and outcome, for the stacked bar.
  stack: {
    columns: ["hour", "outcome", "count"],
    rows: labels.slice(-12).flatMap((l, i) => [
      [l, "approved", Math.round(1500 + Math.sin(i / 2) * 300)],
      [l, "review", Math.round(120 + i * 6)],
      [l, "declined", Math.round(200 + Math.cos(i / 3) * 60 + (i > 8 ? 160 : 0))],
    ]),
  },
  // Wide form: a count and a rate per hour, the case two axes exist for.
  biaxial: {
    columns: ["hour", "approved", "decline_rate_pct"],
    rows: labels.slice(-12).map((l, i) => [
      l,
      Math.round(1500 + Math.sin(i / 2) * 300),
      Math.round((6 + Math.cos(i / 3) * 2 + (i > 8 ? 5 : 0)) * 10) / 10,
    ]),
  },
  kpi: { columns: ["flagged_today"], rows: [[318]] },
  volumeKpi: { columns: ["volume_usd"], rows: [[4829113]] },
  table: {
    columns: ["transaction", "merchant", "country", "amount", "risk_score", "decision", "created_at"],
    rows: tx,
  },
  heat: {
    columns: ["hour", "country", "flags"],
    rows: countries.flatMap((c, ci) =>
      ["00-04", "04-08", "08-12", "12-16", "16-20", "20-24"].map((h, hi) => [h, c, Math.round(rng(ci * 9 + hi + 3)() * 40)]),
    ),
  },
};

const chartDefs = [
  // id, query, name, type, x, y, series, run
  ["ch_kpi", "q_kpi", "Flagged today", "number", null, "flagged_today", null, "kpi"],
  ["ch_vol_kpi", "q_volkpi", "Processed volume (USD)", "number", null, "volume_usd", null, "volumeKpi"],
  ["ch_volume", "q_volume", "Transaction volume by hour", "line", "hour", "approved", null, "volume"],
  ["ch_flagged", "q_flagged", "Flagged transactions", "bar", "hour", "flagged", null, "flagged"],
  ["ch_mix", "q_mix", "Decision mix", "pie", "outcome", "count", null, "mix"],
  ["ch_table", "q_table", "Highest risk transactions", "table", null, null, null, "table"],
  ["ch_heat", "q_heat", "Flags by country and time", "heatmap", "hour", "flags", "country", "heat"],
  ["ch_movers", "q_heat", "Biggest movers by country", "movers", "hour", "flags", "country", "heat"],
  ["ch_compare", "q_heat", "This window vs last", "compare", "hour", "flags", null, "heat"],
  ["ch_stack", "q_stack", "Outcomes by hour (stacked)", "stacked_bar", "hour", "count", "outcome", "stack"],
  ["ch_biaxial", "q_biaxial", "Volume vs decline rate", "biaxial_bar", "hour", "approved", "decline_rate_pct", "biaxial"],
  ["ch_grid", "q_heat", "Every country, side by side", "compare_grid", "hour", "flags", "country", "heat"],
];

const queryDefs = [
  ["q_kpi", "c1", "Flagged today"],
  ["q_volkpi", "c1", "Processed volume"],
  ["q_volume", "c1", "Transaction volume"],
  ["q_flagged", "c2", "Flagged by hour"],
  ["q_mix", "c2", "Decision mix"],
  ["q_table", "c1", "Risk review queue"],
  ["q_heat", "c2", "Flags by country"],
  ["q_stack", "c1", "Outcomes by hour"],
  ["q_biaxial", "c1", "Volume and decline rate"],
];

const charts = chartDefs.map(([id, query_id, name, chart_type, x, y, s], i) => ({
  id,
  query_id,
  name,
  position: i,
  chart_type,
  x_field: x,
  y_field: y,
  series_field: s,
  surge_threshold_pct: null,
  is_public: false,
  published_by: null,
  published_at: null,
  created_at: iso(86_400_000),
  updated_at: iso(86_400_000),
}));

const queries = queryDefs.map(([id, connection_id, name]) => ({
  id,
  connection_id,
  name,
  description: null,
  sql_text: "select 1",
  table_hint: null,
  row_limit: 1000,
  poll_interval_ms: POLL_MS,
  // Three queries are the signed-in user's; the rest belong to somebody else,
  // so an analyst sees the difference between rules they can and cannot name.
  owner_id: ["q_table", "q_flagged", "q_mix"].includes(id) ? "u1" : "u2",
  charts: charts.filter((c) => c.query_id === id),
  created_at: iso(86_400_000),
  updated_at: iso(86_400_000),
}));

const FLAG_ROWS = tx.filter((r) => r[4] > 80).map((_, i) => i);

/*
 * A stand-in for the engine's result cache, enough to test a client's timer.
 *
 * Like the real engine it runs a query at most once per interval and answers
 * every other poll from its cache, and it reports when the result was produced
 * (`executed_at`) on every answer. `GET /__executions` says how many times each
 * query "ran", which is the number a poll timer must not inflate.
 *   MOCK_POLL_MS=300000 node scripts/mock-engine.mjs   # a five-minute interval
 */
const ranAt = new Map();
const executions = new Map();
function lastRun(queryId, { force = false } = {}) {
  const now = Date.now();
  const last = ranAt.get(queryId);
  if (force || last === undefined || now - last >= POLL_MS) {
    ranAt.set(queryId, now);
    executions.set(queryId, (executions.get(queryId) ?? 0) + 1);
  }
  return ranAt.get(queryId);
}

function runFor(queryId, options) {
  const defs = chartDefs.filter((c) => c[1] === queryId);
  const data = runs[defs[0][7]];
  // Which rows each query's rules flag, so every chart type has marks to show.
  const hit = (predicate, ruleIds = () => ["r1"]) =>
    data.rows
      .map((row, index) => (predicate(row, index) ? { index, rule_ids: ruleIds(index), fingerprint: `f${queryId}${index}` } : null))
      .filter(Boolean);
  const flagRows =
    queryId === "q_table"
      ? hit((r) => r[4] > 80)
      : queryId === "q_flagged"
        ? hit((_r, i) => i >= 18, (i) => (i >= 21 ? ["r1", "r2"] : ["r2"]))
        : queryId === "q_mix"
          ? hit((r) => r[0] === "blocked" || r[0] === "disputed")
          : queryId === "q_stack"
            ? hit((r, i) => r[1] === "declined" && i >= 27)
            : queryId === "q_biaxial"
              ? hit((_r, i) => i >= 9)
              : queryId === "q_heat"
            ? hit((r) => r[1] === "NG" && r[0] >= "12")
            : [];
  const RULES = {
    q_table: [{ id: "r1", name: "Risk over 80", severity: "high" }],
    q_flagged: [
      { id: "r1", name: "Velocity spike", severity: "high" },
      { id: "r2", name: "Night-time surge", severity: "medium" },
    ],
    q_mix: [{ id: "r1", name: "Blocked by issuer", severity: "high" }],
    q_heat: [{ id: "r1", name: "Hot country window", severity: "medium" }],
    q_stack: [{ id: "r1", name: "Decline surge", severity: "high" }],
    q_biaxial: [{ id: "r1", name: "Decline rate over 10%", severity: "high" }],
  };
  return {
    query_id: queryId,
    executed_at: new Date(lastRun(queryId, options)).toISOString(),
    duration_ms: 18 + (queryId.length % 7) * 11,
    row_count: data.rows.length,
    truncated: false,
    data_hash: createHash("sha1").update(queryId).digest("hex"),
    columns: data.columns,
    rows: data.rows,
    charts: defs.map(([id, , name, type, x, y, s]) => ({
      id,
      name,
      type,
      x_field: x,
      y_field: y,
      series_field: s,
      surge_threshold_pct: 25,
      warnings: [],
    })),
    flags: {
      flagged_count: flagRows.length,
      rows: flagRows,
      rules: (RULES[queryId] ?? []).map((rule) => ({
        ...rule,
        matched: flagRows.filter((row) => row.rule_ids.includes(rule.id)).length,
      })),
      warnings: [],
      dismissed_count: 0,
    },
    poll_interval_ms: POLL_MS,
    changed: true,
  };
}

const dashboards = [
  {
    id: "d1",
    name: "Live fraud overview",
    chart_ids: charts.map((c) => c.id),
    charts,
    owner_id: "u1",
    owner_name: user.full_name,
    owner_email: user.email,
    created_at: iso(86_400_000 * 5),
    updated_at: iso(3_600_000),
  },
  {
    id: "d2",
    name: "Card testing watch",
    chart_ids: ["ch_flagged", "ch_mix"],
    charts: charts.filter((c) => ["ch_flagged", "ch_mix"].includes(c.id)),
    owner_id: "u1",
    owner_name: user.full_name,
    owner_email: user.email,
    created_at: iso(86_400_000 * 3),
    updated_at: iso(3_600_000),
  },
];

const flaggedSummary = {
  connections: [
    { connection_id: "c1", connection_name: "Payments (prod)", flagged_count: FLAG_ROWS.length, severity: "high", newest_first_seen_at: iso(600_000) },
    { connection_id: "c2", connection_name: "Card authorisations", flagged_count: 12, severity: "medium", newest_first_seen_at: iso(1_800_000) },
  ],
  queries: [
    { query_id: "q_table", connection_id: "c1", flagged_count: FLAG_ROWS.length, severity: "high", newest_first_seen_at: iso(600_000) },
    { query_id: "q_flagged", connection_id: "c2", flagged_count: 12, severity: "medium", newest_first_seen_at: iso(1_800_000) },
  ],
  flagged_count: FLAG_ROWS.length + 12,
  newest_first_seen_at: iso(600_000),
};

const users = [
  user,
  { ...user, id: "u2", email: "grace@fraudguard.io", full_name: "Grace Hopper", role: "analyst" },
  { ...user, id: "u3", email: "alan@fraudguard.io", full_name: "Alan Turing", role: "analyst", is_active: false },
];

/* ----------------------------------------------------------------- lists
 * In memory, like everything here. Mirrors the engine's rules closely enough
 * that the pages behave the same against it: names are unique ignoring case,
 * items are de-duplicated on a trimmed, case-folded (or numeric) key, and a
 * list that a saved flag rule references cannot be deleted.
 */
const itemLists = [
  {
    id: "l1",
    name: "Blocked terminals",
    description: "Terminals pulled after the August chargeback wave.",
    items: ["T-1041", "T-1042", "T-2207"],
    created_by: "u1",
    created_at: iso(86_400_000 * 6),
    updated_at: iso(86_400_000 * 2),
  },
  {
    id: "l2",
    name: "High-risk countries",
    description: null,
    items: ["KP", "IR", "SY"],
    created_by: "u2",
    created_at: iso(86_400_000 * 4),
    updated_at: iso(86_400_000 * 4),
  },
];
let nextListId = 3;

/** Flag rules saved through PUT, by query id. Enough to know what uses a list. */
const savedRules = new Map();

/*
 * The engine keys items with Python's Decimal: decimal literals only (no hex,
 * no "Infinity"), compared by value. Same rule as `itemKey` in
 * src/components/lists/items.ts, so duplicates_dropped agrees with the form.
 */
const DECIMAL = /^([+-]?)(\d+(?:_\d+)*)?(?:\.(\d+(?:_\d+)*)?)?(?:[eE]([+-]?\d+))?$/;
function listKey(item) {
  const text = item.trim();
  const m = DECIMAL.exec(text);
  if (m && (m[2] || m[3])) {
    const whole = (m[2] ?? "").replaceAll("_", "");
    const fraction = (m[3] ?? "").replaceAll("_", "");
    const digits = (whole + fraction).replace(/^0+/, "");
    if (digits === "") return "n:0";
    const trimmed = digits.replace(/0+$/, "");
    const power = Number(m[4] ?? "0") - fraction.length + (digits.length - trimmed.length);
    return `n:${m[1] === "-" ? "-" : ""}${trimmed}e${power}`;
  }
  return `s:${text.toUpperCase().toLowerCase()}`;
}

const MAX_LIST_ITEMS = Number(process.env.MOCK_MAX_LIST_ITEMS ?? 20_000);

const mayChange = (list) => user.role === "admin" || list.created_by === user.id;

/**
 * Rules referencing a list, split like the engine: the ones on queries the
 * caller can see are named, the rest are only counted. An admin sees all.
 */
function rulesUsing(listId) {
  const rules = [];
  let hidden = 0;
  for (const [queryId, saved] of savedRules) {
    const query = queries.find((q) => q.id === queryId);
    const visible = user.role === "admin" || query?.owner_id === user.id;
    for (const rule of saved) {
      if (!rule.conditions.some((c) => c.list_id === listId)) continue;
      if (visible) {
        rules.push({ rule_name: rule.name, query_id: queryId, query_name: query?.name ?? queryId });
      } else {
        hidden += 1;
      }
    }
  }
  return { rules, hidden };
}

const listSummary = (list) => ({
  id: list.id,
  name: list.name,
  description: list.description,
  item_count: list.items.length,
  rule_count: (({ rules, hidden }) => rules.length + hidden)(rulesUsing(list.id)),
  created_by: list.created_by,
  created_at: list.created_at,
  updated_at: list.updated_at,
});

const listRead = (list) => ({ ...listSummary(list), items: list.items });

/** Returns an error response for a bad write body, or the cleaned fields. */
function cleanListBody(raw, ignoreId) {
  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return { error: [422, "REQUEST_VALIDATION_ERROR", "Body is not JSON."] };
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { error: [422, "REQUEST_VALIDATION_ERROR", "name: field required"] };
  if (!Array.isArray(body.items)) return { error: [422, "REQUEST_VALIDATION_ERROR", "items: field required"] };
  if (itemLists.some((l) => l.id !== ignoreId && l.name.toLowerCase() === name.toLowerCase())) {
    return { error: [409, "LIST_NAME_TAKEN", "A list with that name already exists."] };
  }
  if (body.items.length > MAX_LIST_ITEMS) {
    return {
      error: [
        422,
        "REQUEST_VALIDATION_ERROR",
        `A list can hold at most ${MAX_LIST_ITEMS} items; this one has ${body.items.length}.`,
      ],
    };
  }
  const seen = new Set();
  const items = [];
  for (const item of body.items.map((i) => String(i).trim()).filter(Boolean)) {
    if (!seen.has(listKey(item))) {
      seen.add(listKey(item));
      items.push(item);
    }
  }
  const received = body.items.length;
  return {
    fields: { name, description: body.description?.trim() || null, items },
    counts: { received, kept: items.length, duplicates_dropped: received - items.length },
  };
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const path = url.pathname;
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (path === "/health") return send(res, 200, { status: "ok" });
    if (path === "/__executions") return send(res, 200, Object.fromEntries(executions));
    if (path === "/ready") return send(res, 200, { status: "ready" });
    if (path === "/auth/login") {
      const creds = JSON.parse(body || "{}");
      if (creds.password !== "demo") {
        return send(res, 401, { error_code: "INVALID_CREDENTIALS", message: "Wrong email or password.", detail: null });
      }
      return send(res, 200, { token: "mock-token", user });
    }
    if (path === "/auth/logout") return send(res, 204);
    if (path === "/auth/me") return send(res, 200, user);
    // A long flagged page: three queries of forty rows each, so the page has
    // to scroll. `scripts/check-layout.mjs` needs this to mean anything.
    const flaggedMatch = path.match(/^\/connections\/([^/]+)\/flagged$/);
    if (flaggedMatch) {
      const sections = ["Declined spike", "Card testing", "Large amounts"].map((name, s) => {
        const rules = [{ id: `r${s}`, name: `${name} rule`, severity: s === 0 ? "high" : "medium", matched: 40 }];
        const rows = Array.from({ length: 40 }, (_, i) => ({
          index: i + 1,
          rule_ids: [`r${s}`],
          rule_names: [`${name} rule`],
          values: [`TX-${s}${String(i).padStart(4, "0")}`, `Merchant ${i % 7}`, 100 + i * 13],
          fingerprint: `fp-${s}-${i}`,
          severity: s === 0 ? "high" : "medium",
          first_seen_at: iso(3_600_000 + i * 60_000),
          last_seen_at: iso(60_000),
        }));
        return {
          query_id: `q_flag_${s}`,
          query_name: name,
          columns: ["transaction", "merchant", "amount"],
          rows,
          rules,
          warnings: [],
          flagged_count: rows.length,
          dismissed_count: 0,
          executed_at: iso(60_000),
          stale: false,
          error_code: null,
          error_message: null,
        };
      });
      return send(res, 200, {
        connection_id: flaggedMatch[1],
        queries: sections,
        flagged_count: 120,
        dismissed_count: 0,
        refreshed: false,
        refresh_truncated: false,
      });
    }
    if (path === "/connections") return send(res, 200, connections);
    if (path === "/dashboards") return send(res, 200, dashboards);
    if (path.startsWith("/dashboards/")) {
      const found = dashboards.find((d) => d.id === path.split("/")[2]);
      return found ? send(res, 200, found) : send(res, 404, { message: "not found" });
    }
    if (path === "/flagged/summary") return send(res, 200, flaggedSummary);
    if (path === "/queries") {
      const ids = url.searchParams.get("ids");
      const wanted = ids ? ids.split(",") : null;
      return send(res, 200, wanted ? queries.filter((q) => wanted.includes(q.id) || q.charts.some((c) => wanted.includes(c.id))) : queries);
    }
    // Honour since_hash like the real engine, so a repeat poll is "unchanged"
    // and cards sit in their calm state instead of flashing "changed".
    const answer = (queryId, force = url.searchParams.get("force") === "true") => {
      const run = runFor(queryId, { force });
      if (url.searchParams.get("since_hash") === run.data_hash) {
        return {
          query_id: queryId,
          changed: false,
          data_hash: run.data_hash,
          poll_interval_ms: POLL_MS,
          from_cache: true,
          executed_at: run.executed_at,
        };
      }
      return run;
    };
    let m = path.match(/^\/queries\/charts\/([^/]+)\/poll$/);
    if (m) {
      const chart = charts.find((c) => c.id === m[1]);
      return chart ? send(res, 200, answer(chart.query_id)) : send(res, 404, { message: "no chart" });
    }
    m = path.match(/^\/queries\/([^/]+)\/(poll|run)$/);
    if (m) return send(res, 200, answer(m[1], m[2] === "run" || url.searchParams.get("force") === "true"));
    m = path.match(/^\/connections\/([^/]+)\/queries$/);
    if (m) return send(res, 200, queries.filter((q) => q.connection_id === m[1]));
    m = path.match(/^\/connections\/([^/]+)$/);
    if (m) {
      const found = connections.find((c) => c.id === m[1]);
      return found ? send(res, 200, found) : send(res, 404, { message: "not found" });
    }
    m = path.match(/^\/queries\/([^/]+)\/flag-rules$/);
    if (m && req.method === "PUT") {
      const put = JSON.parse(body || "{}").rules ?? [];
      const missing = put
        .flatMap((r) => r.conditions)
        .find((c) => c.list_id && !itemLists.some((l) => l.id === c.list_id));
      if (missing) {
        return send(res, 404, {
          error_code: "LIST_NOT_FOUND",
          message: `No list with id '${missing.list_id}'.`,
          detail: null,
        });
      }
      const stamp = new Date().toISOString();
      const rules = put.map((rule, position) => ({
        id: `fr_${m[1]}_${position}`,
        query_id: m[1],
        name: rule.name,
        severity: rule.severity,
        enabled: rule.enabled,
        position,
        conditions: rule.conditions.map((c, i) => {
          const list = c.list_id ? itemLists.find((l) => l.id === c.list_id) : null;
          return {
            id: `fc_${m[1]}_${position}_${i}`,
            position: i,
            column_name: c.column_name,
            operator: c.operator,
            value: list ? null : (c.value ?? null),
            value2: list ? null : (c.value2 ?? null),
            list_id: list ? list.id : null,
            list_name: list ? list.name : null,
          };
        }),
        created_at: stamp,
        updated_at: stamp,
      }));
      savedRules.set(m[1], rules);
      return send(res, 200, { query_id: m[1], rules });
    }
    if (m) return send(res, 200, { query_id: m[1], rules: savedRules.get(m[1]) ?? [] });
    if (path === "/lists") {
      if (req.method === "POST") {
        const cleaned = cleanListBody(body, null);
        if (cleaned.error) return send(res, cleaned.error[0], { error_code: cleaned.error[1], message: cleaned.error[2], detail: null });
        const stamp = new Date().toISOString();
        const list = { id: `l${nextListId++}`, ...cleaned.fields, created_by: user.id, created_at: stamp, updated_at: stamp };
        itemLists.push(list);
        return send(res, 201, { ...listRead(list), ...cleaned.counts });
      }
      return send(res, 200, itemLists.map(listSummary));
    }
    m = path.match(/^\/lists\/([^/]+)$/);
    if (m) {
      const list = itemLists.find((l) => l.id === m[1]);
      if (!list) return send(res, 404, { error_code: "LIST_NOT_FOUND", message: "No such list.", detail: null });
      const forbidden = () =>
        send(res, 403, {
          error_code: "FORBIDDEN",
          message: "Only the person who created this list, or an admin, can change it.",
          detail: { list_id: list.id },
        });
      if (req.method === "PUT") {
        if (!mayChange(list)) return forbidden();
        const cleaned = cleanListBody(body, list.id);
        if (cleaned.error) return send(res, cleaned.error[0], { error_code: cleaned.error[1], message: cleaned.error[2], detail: null });
        Object.assign(list, cleaned.fields, { updated_at: new Date().toISOString() });
        return send(res, 200, { ...listRead(list), ...cleaned.counts });
      }
      if (req.method === "DELETE") {
        if (!mayChange(list)) return forbidden();
        const { rules, hidden } = rulesUsing(list.id);
        if (rules.length + hidden > 0) {
          // Same wording as the engine, hidden count included.
          const names = [...new Set(rules.map((r) => r.rule_name))].sort().join(", ");
          let message = `List '${list.name}' is used by`;
          if (rules.length > 0) message += `: ${names}`;
          if (hidden > 0) {
            message += `${rules.length > 0 ? " and " : ": "}${hidden} rule${hidden === 1 ? "" : "s"} on queries you cannot see`;
          }
          return send(res, 409, {
            error_code: "LIST_IN_USE",
            message: `${message}. Remove it from those rules first.`,
            detail: { list_id: list.id, rules, hidden_rule_count: hidden },
          });
        }
        itemLists.splice(itemLists.indexOf(list), 1);
        return send(res, 204);
      }
      return send(res, 200, listRead(list));
    }
    m = path.match(/^\/queries\/([^/]+)\/logs$/);
    if (m) return send(res, 200, []);
    if (path === "/users") return send(res, 200, users);
    if (path === "/audit-log") {
      return send(res, 200, [
        { id: "a1", actor_id: "u1", actor_email: user.email, action: "user_created", target_type: "user", target_id: "u2", detail: { email: "grace@fraudguard.io" }, created_at: iso(86_400_000) },
        { id: "a2", actor_id: "u1", actor_email: user.email, action: "user_deactivated", target_type: "user", target_id: "u3", detail: null, created_at: iso(3_600_000) },
      ]);
    }
    return send(res, 404, { error_code: "NOT_FOUND", message: `mock engine has no ${path}`, detail: null });
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`mock engine on http://127.0.0.1:${port} (password: demo)`);
});
