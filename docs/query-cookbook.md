# Writing queries for the dashboard

Which chart fits which question, what each one needs the query to return, and
the traps. Every example here is a real, working query: they are created, on the
`fundgate_transactions` table, by `scripts/seed-chart-examples.mjs`, and you can
open them in the app (they are all called `Guide: ...`, and sit on the dashboard
`Guide: one of every chart`). Reading the saved query beside its chart is the
fastest way to learn the pattern.

```bash
FAE_EMAIL=you@example.com FAE_PW=... node scripts/seed-chart-examples.mjs --dry   # preview, writes nothing
FAE_EMAIL=you@example.com FAE_PW=... node scripts/seed-chart-examples.mjs         # create or update
```

## The one idea

A query returns rows. A chart is just a **mapping from columns to roles**:
`x_field` (the category or time axis), `y_field` (the number), and sometimes
`series_field` (a split, or a second measure). So the job is: decide the
question, pick the chart, then write a query whose columns are exactly what that
chart reads. Aggregate in SQL (`COUNT`, `SUM`, `GROUP BY`); the chart does not.

## Choosing a chart

| Question | Chart | Query returns | x / y / series |
| --- | --- | --- | --- |
| Is it going up? Is one group different? | `line` | one row per (time, group) | time / measure / group |
| Which X has the most? (ranking) | `bar` | one row per category, sorted, `LIMIT`ed | category / measure |
| What is it made of? (few parts) | `pie` | one row per part | part / measure |
| What is the one number to watch? | `number` | **one row, one numeric column** | - / value |
| Which records need a human? | `table` | the raw rows a reviewer needs | none |
| Did this hour differ from the last? | `compare` | **two windows** of time buckets | bucket / measure |
| Which terminal changed most? | `movers` | two windows, per category | window / measure / category |
| How did each terminal change? | `compare_grid` | as `movers`, small windows | window / measure / category |
| Where and when is it worst? | `heatmap` | one row per (category, time) | time (columns) / measure / category (rows) |
| Total and what it is made of, over time | `stacked_bar` | one row per (time, part) | time / measure / part |
| A count beside a rate | `biaxial_bar` | **one row per x, a column per measure** | x / left measure / **right measure** |

Rules of thumb: a pie is for parts of a whole with about five slices or fewer
(the rest folds into "Other"); use a bar to rank. Use a stacked bar when the parts
matter as much as the total. Use two axes only when the scales genuinely differ
(thousands against a percentage).

## Habits every example shares

1. **Anchor time windows on the data, not on `NOW()`.** The database clock and the
   table's timestamps are often in different zones, and a stalled or simulated
   feed has nothing near "now". `WHERE ts > NOW() - INTERVAL '1 hour'` then returns
   no rows and the chart looks broken. Measure from
   `(SELECT MAX(ts) FROM table)` and there is always data in the window.
2. **`ORDER BY` time, oldest first.** Charts draw rows in the order returned, and
   `compare`, `movers` and `compare_grid` split the result *by position* into
   "previous" (older half) and "current" (newer half).
3. **Return twice the window you care about** for the period charts: 12 ten-minute
   buckets to compare this hour with the last. Zero-fill gaps with
   `generate_series` (see the `compare` example) so both halves are the same length.
4. **Bound the output.** `LIMIT` a ranking, limit categories to the top N
   (a `top` CTE), and keep time buckets to a few dozen. Line and bar charts thin
   past about 900 points; flagged points are always kept.
5. **Name columns for people.** They become axis and legend labels. `failed`,
   `transactions` and `bank` read better than `count` and `bankcode`.

## Gotchas

- **A query with exactly one `WITH` (CTE) is rejected** by the engine's SELECT-only
  guard ("Only SELECT statements are permitted; this is not a SELECT"), while two
  CTEs or a plain subselect pass. Observed, not root-caused: use a subselect for a
  single helper (see the `number` example) or add a second CTE.
- **`NUMERIC` comes back as text** (`"44.1"`). Charts and flag rules both read it
  as a number, so nothing is needed; cast to `::float` only if something else
  consumes the result.
- **`number` shows one row.** Extra rows are ignored and the card says how many
  were hidden, so aggregate down to one.
- **`biaxial_bar` is wide form**, unlike every other multi-series chart: the
  *series field is the second measure column*, not a split. If you have long-form
  data (one row per group) use `stacked_bar` or a multi-series `bar` instead.
- **Only `SELECT`.** No writes, no multiple statements; comments (`--`) are fine.

## Flag rules

A rule is a name, a severity and conditions; a row is flagged when **all** of a
rule's conditions match, and flagged when **any** enabled rule matches. Rules see
the query's *result columns*, not the table's, so a rule on `failed` works because
the query named a column `failed`.

- Put thresholds where the data is: the example script reads each threshold off a
  high quantile of the column the rule guards, over the rows it applies to
  (a rule on "insufficient funds" is sized against those rows, not the approved
  ones that dwarf them).
- `in_list` / `not_in_list` compare a column to a saved **list** (Lists page), so a
  watchlist is maintained once and reused by any rule. It only marks a row when a
  listed value is actually in the result.
- A rule that catches nothing is shown nowhere: if a chart has no marks, either
  nothing crossed the threshold or the rule names a column the query does not
  return.
- How the marks look on each chart is in the README, "How a chart shows what was
  flagged".

## Polling

Saved queries run on a schedule (`poll_interval_ms`; the examples use 30 s). Each
poll is a real query against the target database, so choose the slowest interval
that still answers the question, especially against a serverless database that
would otherwise never sleep.
