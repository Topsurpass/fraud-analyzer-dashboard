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

const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

const user = {
  id: "u1",
  email: "ada@fraudguard.io",
  full_name: "Ada Lovelace",
  role: "admin",
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
  poll_interval_ms: 5000,
  charts: charts.filter((c) => c.query_id === id),
  created_at: iso(86_400_000),
  updated_at: iso(86_400_000),
}));

const FLAG_ROWS = tx.filter((r) => r[4] > 80).map((_, i) => i);

function runFor(queryId) {
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
  };
  return {
    query_id: queryId,
    executed_at: iso(2000),
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
    poll_interval_ms: 5000,
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
    const answer = (queryId) => {
      const run = runFor(queryId);
      if (url.searchParams.get("since_hash") === run.data_hash) {
        return { query_id: queryId, changed: false, data_hash: run.data_hash, poll_interval_ms: 5000, from_cache: true };
      }
      return run;
    };
    let m = path.match(/^\/queries\/charts\/([^/]+)\/poll$/);
    if (m) {
      const chart = charts.find((c) => c.id === m[1]);
      return chart ? send(res, 200, answer(chart.query_id)) : send(res, 404, { message: "no chart" });
    }
    m = path.match(/^\/queries\/([^/]+)\/(poll|run)$/);
    if (m) return send(res, 200, answer(m[1]));
    m = path.match(/^\/connections\/([^/]+)\/queries$/);
    if (m) return send(res, 200, queries.filter((q) => q.connection_id === m[1]));
    m = path.match(/^\/connections\/([^/]+)$/);
    if (m) {
      const found = connections.find((c) => c.id === m[1]);
      return found ? send(res, 200, found) : send(res, 404, { message: "not found" });
    }
    m = path.match(/^\/queries\/([^/]+)\/flag-rules$/);
    if (m) return send(res, 200, { query_id: m[1], rules: [] });
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
