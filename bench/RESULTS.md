# Client render cost at 25,000 rows

Reference numbers for `perf/scale-25k`. Regenerate with:

```
BENCH_LABEL=before npm run bench   # writes /tmp/scale-25k/bench-before.md
BENCH_LABEL=after  npm run bench   # writes /tmp/scale-25k/bench-after.md
```

Payload: 625 five-minute buckets x 40 terminals = 25,000 rows, nine columns
(`occurred_at, terminal_id, merchant, mcc, amount, currency, status, card_bin,
risk_score`), generated from a seeded PRNG so the two columns below are
comparable. Every figure is the median of 5-7 timed runs after two warm-ups.

**Read the render numbers as ratios, not as browser milliseconds.** jsdom has a
per-node constant an order of magnitude above a real browser, so 12,388 ms is
not what a user waits; what carries over is that one card was building 25,000
SVG marks and now builds 900.

