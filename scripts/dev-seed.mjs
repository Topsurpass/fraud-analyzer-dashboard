#!/usr/bin/env node
/**
 * Dev-only harness: builds a realistic payments database, registers it with a
 * running Fraud Analyzer Engine, and saves one query per chart type.
 *
 * This exists so the dashboard can be developed and verified against the real
 * engine rather than a hand-written mock. It never touches production: it only
 * talks to the engine URL you pass it, and it only writes the SQLite file you
 * point it at.
 *
 *   node scripts/dev-seed.mjs                     # build + register
 *   node scripts/dev-seed.mjs --tick              # stream new rows forever
 *   node scripts/dev-seed.mjs --reset             # drop and rebuild everything
 *
 * Flags:
 *   --engine=<url>   engine base URL          (default http://127.0.0.1:8000)
 *   --db=<path>      target SQLite file       (default ./.dev/payments.db)
 *   --rows=<n>       seed row count           (default 4000)
 *   --interval=<ms>  --tick insert cadence    (default 2000)
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { rmSync } from "node:fs";

const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [key, value] = raw.replace(/^--/, "").split("=");
    return [key, value ?? true];
  }),
);

const ENGINE = String(args.get("engine") ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
const DB_PATH = resolve(String(args.get("db") ?? ".dev/payments.db"));
const SEED_ROWS = Number(args.get("rows") ?? 4000);
const TICK_INTERVAL_MS = Number(args.get("interval") ?? 2000);
const CONNECTION_NAME = "Payments DB";

/* ------------------------------------------------------------ deterministic RNG */

/** Seeded PRNG so a rebuilt demo database is byte-identical run to run. */
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

const COUNTRIES = ["US", "GB", "DE", "NG", "BR", "IN", "FR", "CA", "RU", "VN"];
const HIGH_RISK = new Set(["RU", "VN", "NG"]);
const MERCHANTS = [
  "Northwind Retail",
  "Kestrel Digital",
  "Aurora Travel",
  "Bluepeak Gaming",
  "Vellum Books",
  "Ridgeline Fitness",
];
const CHANNELS = ["web", "mobile", "pos", "api"];
const DECLINE_REASONS = [
  "insufficient_funds",
  "do_not_honor",
  "suspected_fraud",
  "expired_card",
  "velocity_limit",
];

/* ------------------------------------------------------------------- generation */

function buildDatabase() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  if (args.has("reset")) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        rmSync(DB_PATH + suffix);
      } catch {
        /* not there, fine */
      }
    }
  }

  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at    TEXT    NOT NULL,
      amount         REAL    NOT NULL,
      currency       TEXT    NOT NULL,
      country        TEXT    NOT NULL,
      merchant       TEXT    NOT NULL,
      channel        TEXT    NOT NULL,
      card_bin       TEXT    NOT NULL,
      status         TEXT    NOT NULL,
      decline_reason TEXT,
      risk_score     REAL    NOT NULL,
      is_flagged     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS ix_txn_occurred ON transactions (occurred_at);
    CREATE INDEX IF NOT EXISTS ix_txn_flagged  ON transactions (is_flagged);
  `);

  const existing = db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n;
  if (existing >= SEED_ROWS) {
    db.close();
    return { inserted: 0, total: existing };
  }

  const rng = makeRng(20260822);
  const insert = db.prepare(`
    INSERT INTO transactions
      (occurred_at, amount, currency, country, merchant, channel, card_bin,
       status, decline_reason, risk_score, is_flagged)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;
  const target = SEED_ROWS - existing;

  db.exec("BEGIN");
  for (let i = 0; i < target; i += 1) {
    // Spread across the last 24h, denser toward now, like real traffic.
    const age = Math.pow(rng(), 1.6) * windowMs;
    const occurredAt = new Date(now - age).toISOString().replace("T", " ").slice(0, 19);
    const country = pick(rng, COUNTRIES);
    const risky = HIGH_RISK.has(country);

    // Long-tail amounts, with a rare very large one to give the anomaly
    // detector something real to find.
    const base = Math.exp(rng() * 5.2) * 4;
    const amount = Math.round((rng() < 0.004 ? base * 42 : base) * 100) / 100;

    const riskScore =
      Math.min(0.99, (risky ? 0.45 : 0.12) + rng() * 0.4 + (amount > 3000 ? 0.25 : 0));
    const flagged = riskScore > 0.8 ? 1 : 0;

    let status = "approved";
    let declineReason = null;
    if (flagged && rng() < 0.72) {
      status = "declined";
      declineReason = "suspected_fraud";
    } else if (rng() < 0.14) {
      status = "declined";
      declineReason = pick(rng, DECLINE_REASONS);
    } else if (rng() < 0.03) {
      status = "chargeback";
      declineReason = pick(rng, DECLINE_REASONS);
    }

    insert.run(
      occurredAt,
      amount,
      "USD",
      country,
      pick(rng, MERCHANTS),
      pick(rng, CHANNELS),
      String(400000 + Math.floor(rng() * 99999)),
      status,
      declineReason,
      Math.round(riskScore * 1000) / 1000,
      flagged,
    );
  }
  db.exec("COMMIT");

  const total = db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n;
  db.close();
  return { inserted: target, total };
}

/* -------------------------------------------------------------- engine wiring */

async function api(path, init = {}) {
  const response = await fetch(ENGINE + path, {
    ...init,
    headers: init.body ? { "content-type": "application/json" } : undefined,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${response.status} ${text}`);
  }
  return body;
}

/** Every saved query the demo dashboard shows, one per chart type. */
function demoQueries() {
  return [
    {
      name: "Flagged volume",
      description: "Flagged transactions per 5-minute bucket, last 6 hours.",
      poll_interval_ms: 4000,
      charts: [
        { name: "Flagged volume", chart_type: "line", x_field: "bucket", y_field: "flagged" },
      ],
      sql_text: `
        SELECT strftime('%H:%M', occurred_at) AS bucket,
               COUNT(*)                       AS flagged
        FROM transactions
        WHERE is_flagged = 1
          AND occurred_at >= datetime('now', '-6 hours')
        GROUP BY strftime('%Y-%m-%d %H', occurred_at)
               || printf('%02d', (CAST(strftime('%M', occurred_at) AS INTEGER) / 5) * 5)
        ORDER BY MIN(occurred_at)
      `.trim(),
    },
    {
      name: "Declines by country",
      description: "Where declined authorisations are concentrated.",
      poll_interval_ms: 6000,
      charts: [
        { name: "Declines by country", chart_type: "bar", x_field: "country", y_field: "declines" },
      ],
      sql_text: `
        SELECT country, COUNT(*) AS declines
        FROM transactions
        WHERE status = 'declined'
        GROUP BY country
        ORDER BY declines DESC
        LIMIT 10
      `.trim(),
    },
    {
      name: "Decline reasons",
      description: "Share of decline reasons across the last 24 hours.",
      poll_interval_ms: 8000,
      charts: [
        { name: "Decline reasons", chart_type: "pie", x_field: "reason", y_field: "count" },
      ],
      sql_text: `
        SELECT decline_reason AS reason, COUNT(*) AS count
        FROM transactions
        WHERE decline_reason IS NOT NULL
        GROUP BY decline_reason
        ORDER BY count DESC
      `.trim(),
    },
    {
      name: "Flagged in last hour",
      description: "Live count of flagged transactions in the trailing hour.",
      poll_interval_ms: 3000,
      charts: [
        { name: "Flagged in last hour", chart_type: "number", y_field: "flagged_last_hour" },
      ],
      sql_text: `
        SELECT COUNT(*) AS flagged_last_hour
        FROM transactions
        WHERE is_flagged = 1
          AND occurred_at >= datetime('now', '-1 hour')
      `.trim(),
    },
    {
      name: "Exposure at risk",
      description: "Total value of flagged transactions in the trailing hour.",
      poll_interval_ms: 3000,
      charts: [
        { name: "Exposure at risk", chart_type: "number", y_field: "exposure_usd" },
      ],
      sql_text: `
        SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS exposure_usd
        FROM transactions
        WHERE is_flagged = 1
          AND occurred_at >= datetime('now', '-1 hour')
      `.trim(),
    },
    {
      name: "Authorisations by channel",
      description: "Approved volume per channel, five-minute buckets.",
      poll_interval_ms: 6000,
      charts: [
        {
          name: "Authorisations by channel",
          chart_type: "line",
          x_field: "bucket",
          y_field: "approvals",
          series_field: "channel",
        },
      ],
      sql_text: `
        SELECT strftime('%H:%M', occurred_at) AS bucket,
               channel,
               COUNT(*)                       AS approvals
        FROM transactions
        WHERE status = 'approved'
          AND occurred_at >= datetime('now', '-3 hours')
        GROUP BY bucket, channel
        ORDER BY bucket
      `.trim(),
    },
    {
      name: "Highest-risk transactions",
      description: "Raw rows an analyst would open a case from.",
      poll_interval_ms: 5000,
      row_limit: 50,
      charts: [{ name: "Highest-risk transactions", chart_type: "table" }],
      sql_text: `
        SELECT id, occurred_at, amount, country, merchant,
               status, risk_score, is_flagged
        FROM transactions
        ORDER BY risk_score DESC, occurred_at DESC
        LIMIT 50
      `.trim(),
    },
    {
      name: "Volume, this hour against last",
      description: "Two hours of five-minute buckets; the chart splits them in half.",
      poll_interval_ms: 6000,
      /*
       * Two charts off one execution, which is the point of the type: the same
       * two windows read once by count and once by value, without running the
       * grouping twice.
       */
      charts: [
        {
          name: "Transactions: now vs previous hour",
          chart_type: "compare",
          x_field: "bucket",
          y_field: "txns",
        },
        {
          name: "Value: now vs previous hour",
          chart_type: "compare",
          x_field: "bucket",
          y_field: "value_usd",
        },
      ],
      sql_text: `
        SELECT strftime('%H:', occurred_at)
               || printf('%02d', (CAST(strftime('%M', occurred_at) AS INTEGER) / 5) * 5)
                 AS bucket,
               COUNT(*)                        AS txns,
               ROUND(COALESCE(SUM(amount), 0), 2) AS value_usd
        FROM transactions
        WHERE occurred_at >= datetime('now', '-2 hours')
        GROUP BY strftime('%Y-%m-%d %H', occurred_at)
               || printf('%02d', (CAST(strftime('%M', occurred_at) AS INTEGER) / 5) * 5)
        ORDER BY MIN(occurred_at)
      `.trim(),
    },
    {
      name: "Country activity grid",
      description: "Where and when, as one grid rather than one line chart per country.",
      poll_interval_ms: 8000,
      row_limit: 2000,
      charts: [
        {
          name: "Country x 15 minutes",
          chart_type: "heatmap",
          x_field: "bucket",
          y_field: "txns",
          series_field: "country",
        },
      ],
      sql_text: `
        SELECT strftime('%H:', occurred_at)
               || printf('%02d', (CAST(strftime('%M', occurred_at) AS INTEGER) / 15) * 15)
                 AS bucket,
               country,
               COUNT(*) AS txns
        FROM transactions
        WHERE occurred_at >= datetime('now', '-6 hours')
        GROUP BY strftime('%Y-%m-%d %H', occurred_at)
               || printf('%02d', (CAST(strftime('%M', occurred_at) AS INTEGER) / 15) * 15),
               country
        ORDER BY MIN(occurred_at), country
      `.trim(),
    },
  ];
}

async function register() {
  const connections = await api("/connections");
  let connection = connections.find((entry) => entry.name === CONNECTION_NAME);

  if (!connection) {
    const created = await api("/connections", {
      method: "POST",
      body: JSON.stringify({
        name: CONNECTION_NAME,
        db_type: "sqlite",
        sqlite_path: DB_PATH,
      }),
    });
    connection = created.connection;
    console.log(
      `connection created  ${connection.id}  test_ok=${created.test_ok}` +
        (created.test_error ? `  error=${created.test_error}` : ""),
    );
  } else {
    console.log(`connection reused   ${connection.id}`);
  }

  const existing = await api(`/connections/${connection.id}/queries`);
  const byName = new Map(existing.map((query) => [query.name, query]));

  /*
   * A query and its charts are two calls. They used to be one, back when a
   * saved query held the chart configuration itself; posting the old shape now
   * creates a query with no charts at all, which renders as an empty
   * connection page and looks like the seed silently failing.
   */
  for (const { charts, ...spec } of demoQueries()) {
    let queryId = byName.get(spec.name)?.id;
    if (queryId) {
      await api(`/queries/${queryId}`, { method: "PUT", body: JSON.stringify(spec) });
      console.log(`query updated       ${spec.name}`);
    } else {
      const created = await api(`/connections/${connection.id}/queries`, {
        method: "POST",
        body: JSON.stringify(spec),
      });
      queryId = created.id;
      console.log(`query created       ${spec.name}`);
    }

    await api(`/queries/${queryId}/charts`, {
      method: "PUT",
      body: JSON.stringify({ charts }),
    });
    for (const chart of charts) {
      console.log(`  chart             ${chart.chart_type.padEnd(8)} ${chart.name}`);
    }
  }

  return connection;
}

/* ------------------------------------------------------------------ tick mode */

/**
 * Streams fresh transactions so polls actually return `changed: true`. This is
 * what makes the pulse line verifiable instead of a thing you take on faith.
 */
async function tick() {
  const db = new DatabaseSync(DB_PATH);
  const insert = db.prepare(`
    INSERT INTO transactions
      (occurred_at, amount, currency, country, merchant, channel, card_bin,
       status, decline_reason, risk_score, is_flagged)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const rng = makeRng(Date.now() & 0xffff);

  console.log(`streaming into ${DB_PATH} every ${TICK_INTERVAL_MS}ms — ctrl-c to stop`);
  let written = 0;

  const writeBatch = () => {
    const count = 1 + Math.floor(rng() * 5);
    for (let i = 0; i < count; i += 1) {
      const country = pick(rng, COUNTRIES);
      const risky = HIGH_RISK.has(country);
      const amount = Math.round(Math.exp(rng() * 5.2) * 400) / 100;
      const riskScore = Math.min(0.99, (risky ? 0.45 : 0.12) + rng() * 0.45);
      const flagged = riskScore > 0.8 ? 1 : 0;
      const declined = flagged && rng() < 0.7;
      insert.run(
        new Date().toISOString().replace("T", " ").slice(0, 19),
        amount,
        "USD",
        country,
        pick(rng, MERCHANTS),
        pick(rng, CHANNELS),
        String(400000 + Math.floor(rng() * 99999)),
        declined ? "declined" : "approved",
        declined ? "suspected_fraud" : null,
        Math.round(riskScore * 1000) / 1000,
        flagged,
      );
    }
    written += count;
    process.stdout.write(`\r  rows written: ${written}   `);
  };

  writeBatch();
  setInterval(writeBatch, TICK_INTERVAL_MS);
}

/* ----------------------------------------------------------------------- main */

const { inserted, total } = buildDatabase();
console.log(`database            ${DB_PATH}`);
console.log(`rows                ${total} (${inserted} inserted this run)`);

if (args.has("tick")) {
  await tick();
} else {
  await register();
  console.log(`\nengine              ${ENGINE}`);
  console.log("next                node scripts/dev-seed.mjs --tick");
}
