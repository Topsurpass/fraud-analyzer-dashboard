# Writing queries for the dashboard

Which chart fits which question, what each one needs your query to return, and
exactly which column goes to which axis. Every query below is real and working: the
SQL, the field mapping and the rules in each section are **generated from
`scripts/lib/chart-examples.mjs`**, the same file that creates them in the app, so
this page cannot show a query that is not the one that runs. Open the saved
`Guide: ...` queries, or the dashboard `Guide: one of every chart`, to see each one
drawn beside its SQL.

```bash
# create or update the examples (matched by name, safe to run twice)
FAE_EMAIL=you@example.com FAE_PW=... node scripts/seed-chart-examples.mjs
# preview every query first, writing nothing
FAE_EMAIL=you@example.com FAE_PW=... node scripts/seed-chart-examples.mjs --dry
# after editing the examples, refresh this page's generated blocks
node scripts/sync-query-docs.mjs
```

## The one idea

A query returns rows. A chart is a **mapping from columns to roles**:

- `x_field`: the category or time axis (the horizontal axis, or the columns of a heatmap)
- `y_field`: the number being drawn (the vertical axis, the size of a slice, the colour of a cell)
- `series_field`: a split into groups, or, for the two-axis bar only, a second measure

So the work is: decide the question, pick the chart, then write a query whose
columns are exactly what that chart reads. **Aggregate in SQL** (`COUNT`, `SUM`,
`GROUP BY`); the chart draws the rows it is given and does no arithmetic.

If you leave a field empty the card guesses (the first column of real numbers for
`y_field`, the first text column for `x_field`) and says so in a warning such as
*value axis defaulted to "failed"*. Set the fields explicitly: a guess that happens
to be right today stops being right the day a column is added.

## At a glance: what goes where

| Chart | Horizontal axis / columns | Vertical axis / size | Series field does | Rows look like |
| --- | --- | --- | --- | --- |
| `line` | `x_field` (time or category, in row order) | `y_field` | one line per value | one per (x, group) |
| `bar` | `x_field` (category) | `y_field` | bars side by side per x | one per category |
| `stacked_bar` | `x_field` | `y_field` (total = sum of parts) | the segments of each stack | one per (x, part) |
| `biaxial_bar` | `x_field` | `y_field` on the **left** axis | **the right-axis measure** (not a split) | one per x, a column per measure |
| `pie` | none (slice label = `x_field`) | `y_field` = slice size | unused | one per slice |
| `number` | none | `y_field` = the figure shown | unused | **one row** |
| `table` | none (every column shown) | none | unused | the raw rows |
| `compare` | `x_field` (time buckets) | `y_field` | unused | **twice** the window you care about |
| `movers` | `x_field` (window label) | `y_field`, totalled per category | the category to rank | one per (window, category) |
| `compare_grid` | `x_field` (window label) | `y_field` | the category, one panel each | one per (window, category) |
| `heatmap` | `x_field` = **columns** (time) | `y_field` = cell colour | the category = **rows** | one per (category, time) |

## Choosing a chart

| Your question | Chart |
| --- | --- |
| Is it going up? Is one group behaving differently? | `line` |
| Which X has the most? (a ranking) | `bar` |
| How much in total, and what is it made of? | `stacked_bar` |
| A count beside a rate, or any two very different scales | `biaxial_bar` |
| What is it made of? (about five parts or fewer) | `pie` |
| What is the one number to watch? | `number` |
| Which records need a person to look? | `table` |
| Did this hour differ from the last? | `compare` |
| Which terminal changed the most? | `movers` |
| How did each terminal change? | `compare_grid` |
| Where and when is it worst, across many categories? | `heatmap` |

The four period charts (`compare`, `movers`, `compare_grid` and, as a habit, any
before/after question) are the ones built for fraud work: they answer "what just
changed" rather than "what is the level".

## Habits every example shares

1. **Anchor time windows on the data, not on `NOW()`.** The database clock and the
   table's timestamps are often in different zones, and a stalled or simulated
   feed has nothing near "now". `WHERE ts > NOW() - INTERVAL '1 hour'` then returns
   no rows and the chart looks broken. Measure from
   `(SELECT MAX(ts) FROM table)` and there is always data in the window.
2. **`ORDER BY` time, oldest first.** Charts draw rows in the order returned, and
   the period charts split the result *by position* into "previous" (older half)
   and "current" (newer half).
3. **Return twice the window you care about** for the period charts: 12
   ten-minute buckets to compare this hour with the last. Zero-fill gaps with
   `generate_series` (the `compare` example) so both halves are the same length.
4. **Bound the output.** `LIMIT` a ranking, limit categories to the top N (a `top`
   CTE), and keep time buckets to a few dozen. The limits are below.
5. **Name columns for people.** They become axis and legend labels: `failed`,
   `transactions` and `bank` read better than `count` and `bankcode`.

| Chart | Drawn at most |
| --- | --- |
| `line`, `bar`, `stacked_bar` | 900 points and 5 series (the smallest series fold into "Other"); flagged points are always kept |
| `pie` | 5 slices (4 named and "Other") |
| `compare` | both windows the same length; with an odd row count the oldest row is dropped |
| `movers` | 60 categories, biggest change first |
| `compare_grid` | 24 panels, biggest movers first |
| `heatmap` | 40 rows (categories, by total) and 96 columns (most recent buckets) |

---

## Each chart, with a query

### `line`: a trend over time

**Use it** to see direction and to spot one group diverging: volume over time,
approved against declined. **Not for** ranking categories (use `bar`) or for one
reading (use `number`).

- `x_field` runs left to right in the order the rows arrive, and is shown as returned (it is a label, not parsed as a date), so format it in SQL (`to_char(..., 'HH24:MI')`).
- `y_field` is the height of the line.
- `series_field` makes **one line per distinct value**, each with its own colour and legend entry. Leave it empty for a single line.

<!-- example:line -->
Saved as **Guide: Approved vs declined, every 10 minutes**, drawn as `line`.

What the chart reads from the result:

| Chart field | Column |
| --- | --- |
| `x_field` | `bucket` |
| `y_field` | `transactions` |
| `series_field` | `outcome` |

```sql
WITH ref AS (SELECT MAX(transaction_date_time) AS now_ts FROM fundgate_transactions),
tx AS (
  SELECT t.*, ref.now_ts,
         FLOOR(EXTRACT(EPOCH FROM (ref.now_ts - t.transaction_date_time)) / 600)::int AS k
  FROM fundgate_transactions t, ref
  WHERE t.transaction_date_time > ref.now_ts - INTERVAL '120 minutes'
)
SELECT to_char(now_ts - (k + 1) * INTERVAL '10 minutes', 'HH24:MI') AS bucket,
       CASE WHEN response_code = '00' THEN 'approved' ELSE 'declined' END AS outcome,
       COUNT(*) AS transactions
FROM tx
GROUP BY k, now_ts, outcome
ORDER BY k DESC, outcome
```

Rules the example adds (a row is marked when **all** of a rule's conditions match):

- **Declines spike in a bucket** (medium): `outcome` = `declined` and `transactions` >= a high value of transactions (read off your data when seeded)
<!-- /example:line -->

### `bar`: rank categories

**Use it** for "which bank, terminal or merchant has the most of something". Sort
by the measure and `LIMIT`, or the chart becomes a wall of bars. **Not for** time
(use `line`) or parts of a whole (use `pie` or `stacked_bar`).

- `x_field` is the category under each bar.
- `y_field` is the height of the bar.
- `series_field`, if set, puts one bar per value **side by side** inside each x.

<!-- example:bar -->
Saved as **Guide: Banks with the most declines**, drawn as `bar`.

What the chart reads from the result:

| Chart field | Column |
| --- | --- |
| `x_field` | `bank` |
| `y_field` | `failed` |

```sql
SELECT bankcode AS bank,
       COUNT(*) FILTER (WHERE response_code <> '00') AS failed
FROM fundgate_transactions
GROUP BY bankcode
ORDER BY failed DESC
LIMIT 12
```

Rules the example adds (a row is marked when **all** of a rule's conditions match):

- **Bank failing heavily** (medium): `failed` >= a high value of failed (read off your data when seeded)
<!-- /example:bar -->

### `stacked_bar`: the total and what it is made of

**Use it** when the parts matter as much as the whole, over time or across
categories: approved, insufficient funds and other declines in each ten minutes.
**Not for** comparing the parts to each other precisely (only the bottom segment
shares a baseline; use grouped `bar` for that).

- `x_field` is the column of each stack.
- `y_field` is the size of one segment; the stack's height is the sum, and the tooltip shows the total.
- `series_field` is **the part being stacked**: one segment per value, colour-coded, in a consistent order. Empty means a plain bar.
- Stacks are positive-only: a zero or negative segment takes no height.

<!-- example:stacked_bar -->
Saved as **Guide: Outcomes per 10 minutes, stacked**, drawn as `stacked_bar`.

What the chart reads from the result:

| Chart field | Column |
| --- | --- |
| `x_field` | `bucket` |
| `y_field` | `transactions` |
| `series_field` | `outcome` |

```sql
WITH ref AS (SELECT MAX(transaction_date_time) AS now_ts FROM fundgate_transactions),
tx AS (
  SELECT t.*, ref.now_ts,
         FLOOR(EXTRACT(EPOCH FROM (ref.now_ts - t.transaction_date_time)) / 600)::int AS k
  FROM fundgate_transactions t, ref
  WHERE t.transaction_date_time > ref.now_ts - INTERVAL '120 minutes'
)
SELECT to_char(now_ts - (k + 1) * INTERVAL '10 minutes', 'HH24:MI') AS bucket,
       CASE WHEN response_code = '00' THEN 'Approved'
            WHEN response_code = '51' THEN 'Insufficient funds'
            ELSE 'Other declines' END AS outcome,
       COUNT(*) AS transactions
FROM tx
GROUP BY k, now_ts, outcome
ORDER BY k DESC, outcome
```

Rules the example adds (a row is marked when **all** of a rule's conditions match):

- **Insufficient-funds surge** (medium): `outcome` = `Insufficient funds` and `transactions` >= a high value of transactions (read off your data when seeded)
<!-- /example:stacked_bar -->

### `biaxial_bar`: a count beside a rate

**Use it** when two measures live on very different scales, so that one shared
axis would flatten the small one: a count in the thousands and a percentage under
100. **Not for** two measures of similar size (use grouped `bar`) or for a split by
group (use `stacked_bar`).

- `x_field` is the category under each pair of bars.
- `y_field` is the **left-axis** measure (first colour).
- `series_field` is the **right-axis** measure *column* (second colour). It is **not** a split here.
- The query is **wide form**: one row per x with a column for each measure. Each axis takes its bar's colour and the legend says "left axis" or "right axis" in words.
- Both fields are required, and they must be different columns.

<!-- example:biaxial_bar -->
Saved as **Guide: Volume against decline rate**, drawn as `biaxial_bar`.

What the chart reads from the result:

| Chart field | Column |
| --- | --- |
| `x_field` | `bucket` |
| `y_field` | `transactions` |
| `series_field` | `decline_rate_pct` |

```sql
WITH ref AS (SELECT MAX(transaction_date_time) AS now_ts FROM fundgate_transactions),
tx AS (
  SELECT t.*, ref.now_ts,
         FLOOR(EXTRACT(EPOCH FROM (ref.now_ts - t.transaction_date_time)) / 600)::int AS k
  FROM fundgate_transactions t, ref
  WHERE t.transaction_date_time > ref.now_ts - INTERVAL '120 minutes'
)
SELECT to_char(now_ts - (k + 1) * INTERVAL '10 minutes', 'HH24:MI') AS bucket,
       COUNT(*) AS transactions,
       ROUND(100.0 * COUNT(*) FILTER (WHERE response_code <> '00') / COUNT(*), 1) AS decline_rate_pct
FROM tx
GROUP BY k, now_ts
ORDER BY k DESC
```

Rules the example adds (a row is marked when **all** of a rule's conditions match):

- **Decline rate over threshold** (high): `decline_rate_pct` >= a high value of decline_rate_pct (read off your data when seeded)
<!-- /example:biaxial_bar -->

### `pie`: parts of a whole

**Use it** only for a few parts of one whole, where the share is the point: the
mix of response codes. **Not for** more than about five parts, small differences,
or anything over time.

- `x_field` is the slice name (the legend label).
- `y_field` is the slice size; the legend shows each share and the centre shows the total.
- Repeated names are summed, negatives count as zero, and past five slices the smallest fold into "Other".
- `series_field` is unused.

<!-- example:pie -->
Saved as **Guide: Why transactions fail**, drawn as `pie`.

What the chart reads from the result:

| Chart field | Column |
| --- | --- |
| `x_field` | `outcome` |
| `y_field` | `transactions` |

```sql
SELECT CASE response_code
    WHEN '00' THEN 'Approved'
    WHEN '05' THEN 'Do not honour (05)'
    WHEN '12' THEN 'Invalid transaction (12)'
    WHEN '14' THEN 'Invalid account (14)'
    WHEN '51' THEN 'Insufficient funds (51)'
    WHEN '91' THEN 'Issuer inoperative (91)'
    ELSE 'Other (' || response_code || ')'
  END AS outcome,
       COUNT(*) AS transactions
FROM fundgate_transactions
GROUP BY response_code
ORDER BY transactions DESC
```

Rules the example adds (a row is marked when **all** of a rule's conditions match):

- **Issuer or switch down** (high): `outcome` starts with `Issuer inoperative`
<!-- /example:pie -->

### `number`: one headline figure

**Use it** for the single thing you would check first: the approval rate right
now. **Not for** anything that needs context (add a `line` beside it).

- `y_field` is the figure shown, big, with the column name as its caption.
- `x_field` and `series_field` are unused.
- It reads **the first row only**; extra rows are ignored and the card says how many were hidden. Aggregate down to one row in SQL.

<!-- example:number -->
Saved as **Guide: Approval rate, last 30 minutes**, drawn as `number`.

What the chart reads from the result:

| Chart field | Column |
| --- | --- |
| `y_field` | `success_rate_pct` |

```sql
SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE response_code = '00') / NULLIF(COUNT(*), 0), 1) AS success_rate_pct
FROM fundgate_transactions
WHERE transaction_date_time > (SELECT MAX(transaction_date_time) FROM fundgate_transactions) - INTERVAL '30 minutes'
```

No rules: a number card shows one figure and has no rows to mark.
<!-- /example:number -->

### `table`: the raw rows, for review

**Use it** when a person has to read each record and act on it. It is the view flag
rules mark row by row, and the one to search and sort. **Not for** finding a pattern
(draw it).

- No fields to map: **every column you select is shown, in order, as returned**, with NULL spelled out and numbers uncompacted.
- The card gives you search, a "Flagged only" filter and click-to-sort headers; none of that re-runs the query.
- Select exactly the columns a reviewer needs, newest or largest first, and `LIMIT` it (windowing keeps even thousands of rows smooth).

<!-- example:table -->
Saved as **Guide: Largest transactions**, drawn as `table`.

What the chart reads from the result:

| Chart field | Column |
| --- | --- |
| (none) | every column is shown as returned |

```sql
SELECT id,
       transaction_date_time AS at,
       terminal_id,
       originator_account_name AS originator,
       beneficiary_account_name AS beneficiary,
       bankcode AS bank,
       amount,
       response_code
FROM fundgate_transactions
ORDER BY amount DESC
LIMIT 100
```

Rules the example adds (a row is marked when **all** of a rule's conditions match):

- **Very large transfer** (high): `amount` >= a high value of amount (read off your data when seeded)
- **Issuer inoperative (91)** (medium): `response_code` = `91`
- **Terminal on the watchlist** (high): `terminal_id` is in list "MFBs Terminal"
<!-- /example:table -->

### `compare`: this window against the last

**Use it** to ask "did this hour look like the one before": the same measure over
two consecutive windows, laid on top of each other so the **gap** is what you read.
**Not for** a long trend (use `line`).

- The query returns **twice the window you care about**. The older half of the rows is "previous" (drawn dashed, grey), the newer half "current". The split is **by row position**, which is why rows must be ordered oldest first.
- `x_field` is the time bucket. Each previous point sits under its current counterpart, and the tooltip names both buckets.
- `y_field` is the measure. `series_field` is unused.
- An odd number of rows drops the oldest, so both windows cover the same span; zero-fill with `generate_series` to avoid it.
- `surge_threshold_pct` (set on the chart) is the percent change worth calling out; the headline shows the change between the two windows.

<!-- example:compare -->
Saved as **Guide: Volume, this hour against the last**, drawn as `compare`.

What the chart reads from the result:

| Chart field | Column |
| --- | --- |
| `x_field` | `bucket` |
| `y_field` | `transactions` |

```sql
WITH ref AS (SELECT MAX(transaction_date_time) AS now_ts FROM fundgate_transactions),
tx AS (
  SELECT t.*, ref.now_ts,
         FLOOR(EXTRACT(EPOCH FROM (ref.now_ts - t.transaction_date_time)) / 600)::int AS k
  FROM fundgate_transactions t, ref
  WHERE t.transaction_date_time > ref.now_ts - INTERVAL '120 minutes'
),
slots AS (SELECT g AS k FROM generate_series(0, 11) g)
SELECT to_char((SELECT now_ts FROM ref) - (s.k + 1) * INTERVAL '10 minutes', 'HH24:MI') AS bucket,
       COUNT(tx.k) AS transactions
FROM slots s
LEFT JOIN tx ON tx.k = s.k
GROUP BY s.k
ORDER BY s.k DESC
```

Rules the example adds (a row is marked when **all** of a rule's conditions match):

- **Busy bucket** (low): `transactions` >= a high value of transactions (read off your data when seeded)
<!-- /example:compare -->

### `movers`: which category changed most

**Use it** to name the suspect. `compare` tells you the total moved; this ranks
categories by how much each one changed between the same two windows. **Not for**
seeing the shape of the change (use `compare_grid`).

- One row per **(window, category)**. The windows are the *distinct* values of `x_field`, taken in row order: the older half is "previous", the newer half "current".
- `x_field` is the window label (any text; it is not parsed as a time).
- `y_field` is the measure, totalled per category per half.
- `series_field` is the **category being ranked**, one row each, biggest change first (hollow dot = previous, filled = current, with a percent badge past the threshold).
- Keep the category list to the top N in SQL; the card shows at most 60.

<!-- example:movers -->
Saved as **Guide: Terminals that moved most**, drawn as `movers`.

What the chart reads from the result:

| Chart field | Column |
| --- | --- |
| `x_field` | `window_start` |
| `y_field` | `transactions` |
| `series_field` | `terminal` |
| `surge_threshold_pct` | 25 (percent change worth calling out) |

```sql
WITH ref AS (SELECT MAX(transaction_date_time) AS now_ts FROM fundgate_transactions),
tx AS (
  SELECT t.*, ref.now_ts,
         FLOOR(EXTRACT(EPOCH FROM (ref.now_ts - t.transaction_date_time)) / 1800)::int AS k
  FROM fundgate_transactions t, ref
  WHERE t.transaction_date_time > ref.now_ts - INTERVAL '120 minutes'
),
top AS (SELECT terminal_id FROM tx GROUP BY terminal_id ORDER BY COUNT(*) DESC LIMIT 15)
SELECT to_char(now_ts - (k + 1) * INTERVAL '30 minutes', 'HH24:MI') AS window_start,
       terminal_id AS terminal,
       COUNT(*) AS transactions
FROM tx
WHERE terminal_id IN (SELECT terminal_id FROM top)
GROUP BY k, now_ts, terminal_id
ORDER BY k DESC, terminal_id
```

Rules the example adds (a row is marked when **all** of a rule's conditions match):

- **Terminal surge** (medium): `transactions` >= a high value of transactions (read off your data when seeded)
- **Watchlist terminal active** (high): `terminal` is in list "MFBs Terminal"
<!-- /example:movers -->

### `compare_grid`: how each category changed

**Use it** to see a terminal changing its *rhythm*, not just its level. It is one
`compare` panel per category, as small multiples. **Not for** more than a couple of
dozen categories (it shows the 24 biggest movers).

- The same query shape as `movers`: one row per (window, category), `x_field` the window, `y_field` the measure, `series_field` the category. Use **smaller windows** so each panel has a curve to draw.
- A picker ("Choose terminals") lets you pin the categories you care about.

<!-- example:compare_grid -->
Saved as **Guide: Each terminal's rhythm**, drawn as `compare_grid`.

What the chart reads from the result:

| Chart field | Column |
| --- | --- |
| `x_field` | `window_start` |
| `y_field` | `transactions` |
| `series_field` | `terminal` |
| `surge_threshold_pct` | 30 (percent change worth calling out) |

```sql
WITH ref AS (SELECT MAX(transaction_date_time) AS now_ts FROM fundgate_transactions),
tx AS (
  SELECT t.*, ref.now_ts,
         FLOOR(EXTRACT(EPOCH FROM (ref.now_ts - t.transaction_date_time)) / 600)::int AS k
  FROM fundgate_transactions t, ref
  WHERE t.transaction_date_time > ref.now_ts - INTERVAL '120 minutes'
),
top AS (SELECT terminal_id FROM tx GROUP BY terminal_id ORDER BY COUNT(*) DESC LIMIT 8)
SELECT to_char(now_ts - (k + 1) * INTERVAL '10 minutes', 'HH24:MI') AS window_start,
       terminal_id AS terminal,
       COUNT(*) AS transactions
FROM tx
WHERE terminal_id IN (SELECT terminal_id FROM top)
GROUP BY k, now_ts, terminal_id
ORDER BY k DESC, terminal_id
```

Rules the example adds (a row is marked when **all** of a rule's conditions match):

- **Terminal burst** (medium): `transactions` >= a high value of transactions (read off your data when seeded)
<!-- /example:compare_grid -->

### `heatmap`: where and when, across many categories

**Use it** to find the odd row or odd hour among many categories, which fifty line
charts cannot show. **Not for** exact values (hover, or use `table`).

- `x_field` is the **columns**: the time bucket.
- `series_field` is the **rows**: the category (required).
- `y_field` is the **colour** of the cell, darker for higher; a repeated (row, column) pair is summed and a missing pair is an empty cell.
- Keep rows and columns bounded in SQL; the card shows 40 rows and 96 columns at most.

<!-- example:heatmap -->
Saved as **Guide: Where and when declines cluster**, drawn as `heatmap`.

What the chart reads from the result:

| Chart field | Column |
| --- | --- |
| `x_field` | `window_start` |
| `y_field` | `failed` |
| `series_field` | `bank` |

```sql
WITH ref AS (SELECT MAX(transaction_date_time) AS now_ts FROM fundgate_transactions),
tx AS (
  SELECT t.*, ref.now_ts,
         FLOOR(EXTRACT(EPOCH FROM (ref.now_ts - t.transaction_date_time)) / 1800)::int AS k
  FROM fundgate_transactions t, ref
  WHERE t.transaction_date_time > ref.now_ts - INTERVAL '120 minutes'
),
top AS (SELECT bankcode FROM tx WHERE response_code <> '00' GROUP BY bankcode ORDER BY COUNT(*) DESC LIMIT 12)
SELECT to_char(now_ts - (k + 1) * INTERVAL '30 minutes', 'HH24:MI') AS window_start,
       bankcode AS bank,
       COUNT(*) FILTER (WHERE response_code <> '00') AS failed
FROM tx
WHERE bankcode IN (SELECT bankcode FROM top)
GROUP BY k, now_ts, bankcode
ORDER BY k DESC, bankcode
```

Rules the example adds (a row is marked when **all** of a rule's conditions match):

- **Bank failing hard in a window** (high): `failed` >= a high value of failed (read off your data when seeded)
<!-- /example:heatmap -->

---

## Gotchas

- **A query with exactly one `WITH` (CTE) is rejected** by the engine's SELECT-only
  guard ("Only SELECT statements are permitted; this is not a SELECT"), while two
  CTEs or a plain subselect pass. Observed, not root-caused: use a subselect for a
  single helper (see `number`) or add a second CTE.
- **`NUMERIC` comes back as text** (`"44.1"`). Charts and flag rules both read it
  as a number, so nothing is needed; cast to `::float` only if something else
  consumes the result.
- **Only `SELECT`.** No writes, no multiple statements; `--` comments are fine.
- **Empty chart?** Check, in order: the query returns rows in the preview; the
  field names match the returned column *names* (aliases, not table columns); for
  a period chart, that there are two windows' worth of rows.

## Flag rules

A rule is a name, a severity and conditions; a row is flagged when **all** of a
rule's conditions match, and flagged when **any** enabled rule matches. Rules see
the query's *result columns*, not the table's, so a rule on `failed` works because
the query named a column `failed`.

- Put thresholds where the data is: the example script reads each threshold off a
  high quantile of the column the rule guards, over the rows it applies to (a rule
  on "insufficient funds" is sized against those rows, not the approved ones that
  dwarf them).
- `in_list` / `not_in_list` compare a column to a saved **list** (Lists page), so a
  watchlist is maintained once and reused by any rule. It only marks a row when a
  listed value is actually in the result.
- A rule that catches nothing is shown nowhere: if a chart has no marks, either
  nothing crossed the threshold or the rule names a column the query does not
  return.
- How the marks look on each chart is in the README, "How a chart shows what was
  flagged".

## Polling

`poll_interval_ms` (the examples use 30 s) is **the most often the query runs on
your database**, however many people or tabs have it open. The engine runs it at
most once per interval and serves every other poll from a cache that lasts that
long, so opening a page, leaving it, switching tabs and coming back never run it.
The card's footer says when it last ran and when it runs next (`ran 12m ago ·
next in 48m`), counted from the run and not from your visit.

Only explicit actions run it early: **Run now** (once) and **Retry** on a failed
card. Changing a chart's type, publishing a chart and reopening a page do not.
Editing the SQL, a flag rule or a list does re-run it, because the result changes.
A refresh that fails is not retried until a further interval has passed.

Choose the slowest interval that still answers the question, especially against a
serverless database that would otherwise never sleep. Set it in the query editor
in milliseconds (the field states the value back in words and has presets:
3,600,000 is one hour).
