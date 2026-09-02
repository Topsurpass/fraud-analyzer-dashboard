/**
 * A 25,000-row payload shaped like the real workload, generated deterministically.
 *
 * The benchmark has to compare two versions of the code, so the data cannot
 * move between runs: a seeded PRNG rather than `Math.random`, and a fixed row
 * order, so a millisecond difference in the table is a difference in the code.
 *
 * The shape matters as much as the size. A card-transaction result is grouped
 * by (bucket, terminal), which is what makes the period charts interesting and
 * what makes the naive "split the row list in half" reading wrong; the numeric
 * columns are a mix of real numbers (`amount`, `risk_score`) and
 * numeric-looking strings (`mcc`, `card_bin`), which is what exercises the
 * axis-fallback scans.
 */

import type { ChartSpec, ChartType, FlagOutcome, RunResponse, Row } from "@/contracts/api";

export const COLUMNS = [
  "occurred_at",
  "terminal_id",
  "merchant",
  "mcc",
  "amount",
  "currency",
  "status",
  "card_bin",
  "risk_score",
];

/** 625 five-minute buckets across 40 terminals is exactly 25,000 rows. */
export const BUCKET_COUNT = 625;
export const TERMINAL_COUNT = 40;
export const ROW_COUNT = BUCKET_COUNT * TERMINAL_COUNT;

const MERCHANTS = [
  "Shoprite Ikeja",
  "Total Lekki",
  "Jumia Pay",
  "Konga Yaba",
  "Chicken Republic VI",
  "GTBank ATM 14",
  "Ebeano Supermarket",
  "Filmhouse Cinemas",
  "Domino's Ajah",
  "Spar Ilupeju",
  "Medplus Surulere",
  "Slot Computer Village",
];

const MCCS = ["5411", "5541", "5732", "5812", "5912", "5999", "6011", "7832"];

const BINS = ["506099", "539983", "506100", "558842", "628051", "418742", "533228", "512345"];

/** Mulberry32: 32 bits of state, no dependency, identical every run. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rows in the order `ORDER BY occurred_at, terminal_id` returns them: every
 * terminal appears once per bucket, buckets ascending.
 */
export function makeRows(seed = 0xc0ffee): Row[] {
  const random = mulberry32(seed);
  const rows: Row[] = new Array(ROW_COUNT);
  const startMs = Date.UTC(2026, 7, 30, 0, 0, 0);

  let index = 0;
  for (let bucket = 0; bucket < BUCKET_COUNT; bucket += 1) {
    const occurredAt = new Date(startMs + bucket * 300_000).toISOString();
    for (let terminal = 0; terminal < TERMINAL_COUNT; terminal += 1) {
      const roll = random();
      // Squared so the amounts are heavily skewed, the way real card volume is.
      const amount = Math.round((50 + roll * roll * 20_000) * 100) / 100;
      rows[index] = [
        occurredAt,
        `TERM-${String(terminal + 1).padStart(4, "0")}`,
        MERCHANTS[(bucket + terminal) % MERCHANTS.length],
        MCCS[(terminal * 3 + bucket) % MCCS.length],
        amount,
        "NGN",
        roll > 0.94 ? "declined" : roll > 0.9 ? "reversed" : "approved",
        BINS[(terminal + bucket) % BINS.length],
        Math.round(roll * 1000) / 10,
      ];
      index += 1;
    }
  }
  return rows;
}

/** A rule outcome of the size a real one has: a handful of rows, not thousands. */
export function makeFlags(rowCount = ROW_COUNT, hits = 12): FlagOutcome {
  const stride = Math.max(1, Math.floor(rowCount / hits));
  const indices = Array.from({ length: hits }, (_, n) => Math.min(rowCount - 1, n * stride + 7));
  return {
    flagged_count: indices.length,
    rows: indices.map((index) => ({ index, rule_ids: ["rule-large-transfer"] })),
    rules: [
      {
        id: "rule-large-transfer",
        name: "Large transfer",
        severity: "high",
        matched: indices.length,
      },
    ],
    warnings: [],
    dismissed_count: 0,
  };
}

export function makeSpec(type: ChartType, overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    id: `chart-${type}`,
    name: `${type} card`,
    type,
    x_field: "occurred_at",
    y_field: "amount",
    series_field: null,
    surge_threshold_pct: 50,
    warnings: [],
    ...overrides,
  };
}

/** The full wire payload, for the `JSON.parse` measurement. */
export function makeRunResponse(rows: Row[], flags: FlagOutcome): RunResponse {
  return {
    query_id: "query-bench",
    executed_at: "2026-08-30T00:00:00.000Z",
    duration_ms: 412,
    row_count: rows.length,
    truncated: false,
    data_hash: "bench-hash-0001",
    columns: COLUMNS,
    rows,
    charts: [
      makeSpec("line"),
      makeSpec("bar", { series_field: "terminal_id" }),
      makeSpec("table"),
      makeSpec("compare"),
      makeSpec("movers", { series_field: "terminal_id" }),
      makeSpec("compare_grid", { series_field: "terminal_id" }),
      makeSpec("heatmap", { series_field: "terminal_id" }),
      makeSpec("pie", { x_field: "status" }),
      makeSpec("number", { x_field: null }),
    ],
    flags,
    poll_interval_ms: 5_000,
  };
}
