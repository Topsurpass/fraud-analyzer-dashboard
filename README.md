# Fraud Analyzer Dashboard

A live instrument panel over the [Fraud Analyzer Engine](https://fraud-analyzer-engine.fastapicloud.dev).
The engine stores connections and saved read-only SQL, runs that SQL, hashes the
result and exposes it as chart-ready JSON. This app is the surface an analyst
watches: a dense grid of cards, each polling its own query, each showing at a
glance whether its data just moved, is idle, or has gone stale.

Two roles use it. An **analyst** writes and runs queries against connections
somebody else set up, and sees their own saved work. An **administrator** does
that, plus manages the connections, the accounts and the audit log.

```
┌──────────┬────────────────────────────────────────────┐
│ FRAUD    │  Connections › Payments DB          ● live  │
│ ANALYZER │────────────────────────────────────────────│
│          │  ┌───────────────┐ ┌───────────────┐        │
│ ● Conn A │  │ ChartCard  ⟨live dot⟩           │        │
│ ○ Conn B │  └───────────────┘ └───────────────┘        │
│──────────│  ┌───────────────┐ ┌───────────────┐        │
│DASHBOARDS│  │ ChartCard     │ │ ChartCard     │        │
│ + New    │  └───────────────┘ └───────────────┘        │
│──────────│                                             │
│ADMIN     │   (this section only for administrators)    │
│ People   │                                             │
│ Audit log│                                             │
│──────────│                                             │
│ GH  Grace│                                             │
│ ● ENGINE │                                             │
└──────────┴────────────────────────────────────────────┘
```

## Getting started

```bash
npm install
npm run dev            # http://localhost:3000
```

`NEXT_PUBLIC_API_BASE_URL` in `.env.local` points at the deployed engine. To
develop against a local engine instead, create `.env.development.local` (Next
loads it ahead of `.env.local`, and it is gitignored):

```
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

> Open the app on `http://localhost:3000`, not `http://127.0.0.1:3000`. Next's
> dev-origin protection serves its own chunks with a 403 to the second, and the
> page renders its server markup but never hydrates.

### Signing in

Every screen but `/login` needs a session, and every engine endpoint but
`/health`, `/ready` and `/auth/login` refuses a request without one. There is no
sign-up: accounts are opened by an administrator, and the first administrator is
created with the engine's own CLI rather than over HTTP, because an endpoint
that mints an administrator is reachable by anything that can reach the service.

From the engine's `services/analyzer`:

```bash
uv run switchboard create-admin        # prompts for email, name and password
```

Then sign in at `http://localhost:3000/login`. The scripts below need those
credentials too - pass `--password=...` or set `FAE_SMOKE_PASSWORD` (and
`FAE_SMOKE_EMAIL` if the account is not `admin@example.com`).

### A demo database

`scripts/dev-seed.mjs` builds a realistic payments table, registers it with a
running engine, and saves one query per chart type. It only talks to the engine
URL you give it and only writes the SQLite file you point it at.

```bash
node scripts/dev-seed.mjs --password=...      # build + register
node scripts/dev-seed.mjs --tick             # stream new rows, so polls change
node scripts/dev-seed.mjs --reset            # drop and rebuild
```

Registering a connection is an administrator's act, so the first form signs in
before it writes anything. `--tick` only touches the SQLite file and needs no
session.

`--tick` is what makes the live indicator worth looking at: it writes new
transactions continuously, so polls return `changed: true` and the cards
actually deflect.

## Checks

Two lanes, different budgets.

**Gate** - deterministic, local, free. Runs on every commit via the hook in
`.githooks/pre-commit`; install it once per clone:

```bash
scripts/install-hooks.sh
npm test               # 748 tests, ~3m
npm run lint
npm run typecheck
npm run build
```

**Smoke** - a real browser against a real engine, run before shipping:

```bash
node scripts/dev-seed.mjs && npm run dev   # in another shell
npm run smoke -- --password=...            # every chart type puts marks on screen
npm run smoke:dashboards -- --password=...  # a board is really server-owned
npm run smoke:auth -- --password=...        # roles hold on both sides
npm run check:endpoints                    # every documented operation is used
npm run check:layout                       # bell, sidebar and card menus, measured (mock engine)
```

The smoke lane exists because the gate lane structurally cannot catch this
project's worst failure mode. Recharts computes geometry from real layout, so
under jsdom a chart that renders zero bars and one that renders ten are
indistinguishable - both are "a `<BarChart />` that mounted without throwing".
Twice during development a library-level animation defect left charts
permanently blank while every unit test stayed green. `scripts/smoke.mjs`
asserts on the actual SVG geometry for all nine chart types, checks that every
card reporting a flagged series actually painted its hatch pattern, checks that
the card menu opens and then closes on an outside click, on Escape and when
another menu opens, checks that no card sits in a stale state, and checks that the layout does not overflow at
390px. The hatch check is there because the pattern reaches the chart as a
`<defs>` child and Recharts decides what to do with children by scanning their
component type - the same mechanism behind both of the blank-chart defects
above.

`scripts/smoke-auth.mjs` is here for the sharpest version of the same problem.
Every role assertion in the gate suite is written against a mocked engine, which
is to say against one understanding of what the engine does - and the thing
actually worth proving is that the two halves agree: that a screen the rail
hides is also a screen the engine refuses, and that the role the interface draws
is the role the engine enforces. So it signs in as a real administrator and a
real analyst and checks both sides of every rule. It walks the whole account
lifecycle in a browser - open an account, read the temporary password that is
shown exactly once, sign in with it, be held on the change-password screen until
it is replaced, then be refused `/admin/users` by URL - and then asks the engine
the same questions directly, expecting 403 for an analyst on `/users`,
`/audit-log` and `POST /connections`, 200 on `/connections`, and 401 rather than
403 with no session at all. It also checks the two failure modes that would be
worst to get wrong: that `?next=` cannot redirect a sign-in off this origin, and
that the last active administrator cannot deactivate or demote themselves. It
finishes by confirming that signing out kills the session on the engine and not
only in the browser. Accounts are never deleted - an audit trail that can lose
its subject is not one - so it deactivates the throwaway accounts it created.

`scripts/smoke-dashboards.mjs` is here for a related reason. The gate suite mocks
the engine, so it can prove the client calls the right endpoints and no more.
The claim worth proving is that a board created in one browser exists for every
other one and keeps nothing in `localStorage`, and that is only testable across
two real browser contexts: it creates a board, adds a card, opens it from a
second context that has never listed it, reorders two cards, renames it, empties
it and deletes it, checking the engine's own state after each step. It cleans up
its board even when it fails, matching by name rather than by id so a failure
early enough to lose the id still leaves nothing behind.

## How it is put together

Each concern is a self-contained service under `src/services/`, with the wire
contract at the boundary. Routes hold glue only.

| Path | What it owns |
|---|---|
| `src/contracts/api.ts` | Wire types, mirrored from the engine's OpenAPI schema. The only place request/response shapes are defined. |
| `src/services/api-client/` | Every call to the engine. Applies a per-request deadline, honours cancellation, and normalizes every failure into one `ApiError`. |
| `src/services/polling/` | `useQueryPolling` — one card's live loop. Sends `since_hash`, adopts the engine's cadence, backs off on failure, pauses on a hidden tab. |
| `src/services/charts/` | Reshapes `columns` + `rows` + `ChartSpec` into what each chart type needs, including the long→wide pivot for multi-series, the half-and-half split behind `compare`, and the category-by-bucket grid behind `heatmap`. |
| `src/services/anomaly/` | Decides which points get the alert colour. |
| `src/services/format/` | Every number, duration, timestamp and hash the app renders, plus the column-name-to-label pass. Pure functions; callers pass `now`. |
| `src/services/dashboards/` | Server-owned dashboards: the ordered-id arithmetic `PUT /dashboards/{id}` needs, and the one context that fetches and mutates them. |
| `src/services/connections/` | The connection list, shared by the rail and every page. |

### Charts built for a fraud queue

Seven of the eleven chart types answer "what is the shape of this" (line, bar,
stacked bar, two-axis bar, pie, number, table). Four answer the questions an
analyst actually opens the app with.

**`compare` - the same measure over two consecutive windows.** Configure a time
bucket (`x_field`) and a measure (`y_field`), and write a query returning *twice*
the window you care about: two hours of five-minute buckets to compare this hour
against the last. The result is split in half by row order - older half
"previous", newer half "current" - and the two are laid on one axis so the gap
between them is the thing you read.

The split is positional rather than parsed from the bucket column. The engine
never knows what that column holds; it may be an hour, a date, a weekday name.
A chart that only works when the x axis parses as a date is a chart that draws
nothing the first time someone buckets by something else. Position is what the
query already ordered by. An odd row count drops the oldest row, because two
windows covering different spans make the gap between them meaningless.

Three things carry the finding, because a shape alone is slow to read under
queue pressure: both totals and the signed change in a headline strip, the
widest single-bucket gap named and shaded on the plot, and the two lines
themselves. Previous is dashed and slate; current is solid and in the ramp.
Making them equally loud is the classic failure of this chart - both lines shout
and neither reads as "then" versus "now". The tooltip names the previous value's
own bucket, since a point labelled 16:00 carries a value measured at 04:00 and
nothing else on the card says so.

Totals are computed over every bucket and only the plot is thinned, so the
headline number never depends on how many pixels were available. The largest
divergence is exactly the kind of single bucket a downsampler is entitled to
drop, so it is found first.

**`movers` - the same two windows, totalled per category.** `compare` answers
"did this move". `movers` answers "which terminal moved", which is the question
that names a suspect: an hour where total volume held steady while one terminal
quadrupled and another went dark reads as flat on a time overlay and as two
obvious rows here. Configure the bucket as `x_field`, the measure as `y_field`
and the category as `series_field`.

The split here is by *distinct bucket*, not by row position - shared with
`compare_grid` as `splitBucketWindows`. A result grouped by
(bucket, terminal) interleaves terminals within every bucket, so halving the row
list would cut through the middle of a bucket and put one terminal's 09:00 in
the previous window and another's in the current. Bucket order is the only thing
carrying time in that shape.

Each row is a dumbbell: a hollow mark for the previous window, a filled one for
the current, joined by a segment whose *length is the change*. That makes "moved
a lot" a physical property of the row rather than arithmetic the reader
performs, and rows are pre-sorted by it so the scan can stop as soon as the
segments get short. Two paired bars would encode the same numbers and read
worse - the eye would have to measure two lengths and subtract them, which is
exactly the work this chart removes. Ranking is by size of change rather than by
either total, because the biggest terminal is a fact an analyst already knows
and the biggest change is the one they do not. Direction is carried by an arrow
and a sign, never by colour alone, which leaves the alert colour meaning only
"a rule matched".

**`compare_grid` - one `compare` panel per category, as small multiples.** The
three period charts answer three different questions and none substitutes for
another. `compare` shows the shape of everything at once, so a terminal that
quadrupled while another went dark reads as flat. `movers` shows two totals per
terminal, so a terminal moving the same volume at a completely different hour
reads as unchanged. This shows the shape *per* terminal, which is the only one
of the three where a change of rhythm is visible at all.

Each panel keeps its own y scale and prints its own peak. A shared scale is the
textbook default for small multiples and it is wrong for this data: one terminal
doing twenty times the volume of the rest flattens every other panel onto the
axis, which is the failure the chart exists to avoid. Per-panel scaling makes
each shape readable; the printed peak and the two totals carry the level that
the scaling gives up. Panels are ranked by movement and the quiet tail sits
behind a "show quieter" toggle, because twenty flat panels ahead of the
interesting ones is a scroll rather than a chart.

Thirty-one panels is a wall, so the grid narrows three ways. **Choose
terminals** filters to a working set - the survivors get wider columns, which is
the whole point of narrowing - and the choice is saved per chart, because
re-picking four terminals out of thirty-one after every reload is the friction
that makes a feature go unused. **Clicking a panel maximises it** over the whole
card with its bucket labels, a crosshair readout, and every threshold crossing
named rather than merely marked. The quiet tail sits behind a "show quieter"
toggle.

Drawn as inline SVG, not a charting library. Twenty-four recharts instances
would mount twenty-four responsive containers and resize observers to draw two
polylines each; at this size a `viewBox` and a `points` string do the same job
for a fraction of the work, and the geometry becomes a pure function
(`panelSegments`) the gate lane can assert on directly. A missing bucket breaks
the line rather than being bridged - a straight line across an hour with no rows
invents activity that was never queried.

#### Saying when a movement is worth investigating

Terminals do not carry comparable volume: one does twenty times another's, so an
absolute jump means nothing across a fleet. A *percentage* change is
volume-independent, which is why the threshold is expressed as one - the same
number is meaningful for the busiest terminal and the quietest.

Each period chart carries its own `surge_threshold_pct` (a magnitude, so 50
flags a rise of 50% and a fall of 50%), set in the chart editor and stored per
chart. Blank means "follow the app-wide default" and is deliberately not the
same as typing that default: an unset chart moves when the default does.

Two different comparisons get judged, because either alone under-reports:

- **Window over window** - the panel's own previous total against its current
  one. This is what the badge on the panel shows.
- **Hour against the hour before it** - strictly consecutive buckets inside the
  current window. A terminal whose six-hour total fell 77% while one hour inside
  it rose 18,000% is the exact shape a fraud queue is looking for, and the window
  comparison reports it as "down 77%" and nothing else.

Consecutive means consecutive: a step is never judged across a gap, and never
across the join between the two windows, because those two buckets are adjacent
in the array and a whole window apart in time. A chart that quietly widens its
own comparison window is a chart that lies.

The indicator itself is one component (`ChangeBadge`) used by every chart that
has it, and it obeys three rules. It is **never colour alone** - a glyph and a
signed percentage carry the finding, so it survives colour blindness, greyscale
and forced-colours mode. It is **amber, never red**: `--signal-alert` means "a
flag rule matched this row" and the whole flagging feature depends on that
staying true, so a large percentage change wears `--signal-change` instead. And
**under the threshold it is quiet** - a chart where every row wears a badge has
told the reader nothing. Panels also carry a small `2h` chip when hours crossed,
and hollow rings on the line mark which ones; the filled dot stays reserved for
a rule match, so a bucket can be either, both, or neither.

One honest limitation: a fixed threshold knows nothing about time of day.
Transaction volume has a strong daily rhythm - in the Fundgate data every
terminal falls 56-100% between 22:00 and 03:00 - so a threshold low enough to
catch a daytime surge will badge the whole fleet overnight. That is why it is
configurable per chart rather than global: a card watching business hours and a
card watching the night want different numbers.

**`heatmap` - a category against a time bucket, coloured by a measure.**
Configure the bucket as `x_field` (columns), the category as `series_field`
(rows) and the measure as `y_field`. Forty terminals as forty line charts is
forty things to read; as one grid the hot row and the hot hour are
pre-attentive.

It is a CSS grid, not an SVG chart. A heatmap is a table of coloured rectangles,
and a table gets real focus order, real hover targets and text a screen reader
can reach. Both axes are capped - forty categories, ninety-six buckets - and the
tail is dropped by total with a warning on the card rather than quietly. Colour
carries one variable, so it is one hue at varying strength; a multi-hue ramp
reads as categories rather than magnitude and is the standard way this chart
lies. Intensity is square-rooted because transaction volumes are heavily skewed
and one busy terminal flattens every other row on a linear ramp. A flagged cell
is *outlined* in the alert colour rather than tinted with it, so "this is big"
and "this broke a rule" stay separable states.

The hovered value is pinned to a fixed line above the grid instead of a floating
tooltip: a tooltip under the pointer covers the neighbouring cells, which are
the comparison the chart exists to make.

### The live indicator

Each card header carries one small state indicator, and every state is a real
poll result (`LivePill` in `src/components/ChartCard.tsx`):

- **beating green dot** - polling is healthy
- **amber "changed" pill** - the last poll brought a new `data_hash`; the card
  border also takes the change colour for that beat
- **rose dot** - polling is failing; the card shows an inline reason and a retry
- **nothing** - paused

The word always accompanies the colour, so it survives colour blindness. The
old oscilloscope trace (`PulseLine`) is gone; `src/lib/ticker.ts` remains because
the number cards' count-up still uses it.

### The poll interval, and what reaches your database

A query's **poll interval is the most often it runs on the database**, however
many people or tabs have it open. The engine runs it at most once per interval
and answers every other poll from a cache that lasts exactly that long, so
opening a page, leaving it, switching tabs and coming back never run the query.
Each card's status line shows the facts about the data rather than about the
visit: **`ran 12m ago · next in 48m`**. (It used to show how long ago the card
last *asked*, which reads "0s ago" after every visit and looked as though the
query had just run.) The "next" half is left out under 30 seconds, where it
would only tick.

The dashboard keeps its side of that bargain in `useQueryPolling`:

- **The timer follows the run, not the card.** Every answer says when the result
  was produced (`executed_at`, on the lean "unchanged" answer too), and the next
  poll is aimed just past `executed_at + interval`, when the cached result goes
  stale. A hidden tab pauses; on return it polls only if the next run is
  actually due, and otherwise waits out what is left. A card that remounts
  (navigating away and back) has no data and fetches once, from the cache, then
  lines up with the run.
- **Only an explicit request runs the query early.** `Run now` runs it once, and
  Retry on a failed card forces a run. Everything else re-reads: after `Run now`
  or a chart-type change the card asks the engine for the whole current result
  (`resync`), which is free. Both used to finish with a forced poll, so `Run now`
  ran the query twice and a chart-type switch re-ran it for a change that only
  affects drawing.
- **A stale answer is retried gently.** If an answer arrives already past its
  interval (the engine is refreshing behind it, or clocks differ), the card asks
  again after 3 s, 10 s, 30 s and 60 s, then every 60 s until the new result
  lands. Each retry is a cache read. (After the 60 s it used to wait a whole
  interval, which for an hourly query left the card on old data for another
  hour whenever the refresh had not landed within about 100 seconds.)

The engine's half (fraud-analyzer-engine): editing a chart, or publishing it,
redraws the cached result in place instead of discarding it, so it costs no run;
a background refresh that **fails** is not retried until a further interval has
passed, so a client polling a database that is down cannot hammer it; and the
scheduler skips a query whose result somebody just ran, so a poll's refresh and
the scheduler's run cannot both happen at the same boundary. Editing a query's
SQL, a flag rule or a list still re-runs it, because those change what the result
says. The engine must be rebuilt for these to take effect; until then the
dashboard still works, with `executed_at` missing from unchanged answers (the
status line then falls back to when the card last heard from the engine).

**A sleeping laptop used to freeze the engine's cache clock.** Reported as "the
hourly chart never re-runs": the card's log showed runs at 00:45 and 01:45, then
nothing until the next morning, and the first poll after waking was answered from
cache in 45 ms with no run, though the result was six hours old. Docker Desktop
pauses its VM while the Mac sleeps and the VM's `time.monotonic()` stops with it
(measured: a Docker backend up 24 hours, a container clock of 12.8), and the
engine measured result age, the failure cooldown and the scheduler's due-times on
that clock alone. A result one hour old at bedtime was "47 minutes old" at
breakfast. The engine now takes the larger of the monotonic and wall-clock
readings (`app/clock.py`), so a paused clock cannot make anything look fresher
than it is, and a wall clock stepped backwards cannot either. This only bites
where the engine runs on a machine that sleeps, which is a developer laptop; a
server never notices.

The interval is set per query (`Poll interval (ms)` in the query editor, which
now states the value back in words and offers 1 min, 5 min, 15 min, 1 hour and
1 day presets). Saved queries that have flag rules also run on a scheduler with
nobody watching, at the same interval with a one-minute floor.

### Design system

A fintech SaaS surface: cool off-white ground, white cards with a hairline and a
soft shadow, one indigo accent, generous radius. **Light is the default, dark is
a full second theme**, chosen with the toggle in the top bar (stored in
`localStorage` as `fae.theme`) or, with no choice made, by the OS.

- Every colour is a token in `src/app/globals.css`. The dark theme is the
  `[data-theme="dark"]` block plus a `prefers-color-scheme` mirror of it for the
  no-choice case. Components never use a literal colour, which is what lets one
  stylesheet carry both themes.
- `src/lib/theme.ts` holds the pure rules and the tiny init script inlined in
  `<head>`, so a saved dark theme never flashes light. `ThemeToggle` reads the
  attribute back rather than keeping a second copy in state.
- One typeface, Inter, with tabular numerals (`.tnum`) so digit columns stay
  steady as a poll lands. JetBrains Mono survives only for hashes, ids and SQL
  (`.mono`). Scale: `.t-display` / `.t-page` / `.t-section` / `.t-card` / `.t-sub`.
- Chart series colours are one mid-tone ramp (`charts/theme.ts`) that holds 3:1
  against both card surfaces, so a chart does not change colour with the theme.
  The ramp excludes amber and rose: see "What `--signal-alert` means".

### Charts and the table

Line charts are gradient area charts, bars have rounded tops and a gradient,
pies are rounded-cap donuts whose legend carries each slice's share, and the
tooltip is a single floating card shared by every chart. Recharts 2 is kept
(it already drives every chart type here); the work is in how it is drawn.

`charts/TableView.tsx` is built on **TanStack Table v8** (`@tanstack/react-table`,
pinned to 8: the npm `latest` tag is v9, which has a different API). It adds:

- click-to-sort headers, ascending first, NULLs always last, `aria-sort` on each
- search across every cell, matching the text as displayed ("1,234" finds
  1234567), and a flagged-only filter
- known outcome words (`approved`, `pending`, `declined`...) drawn as badges
- a count that says "12 of 140 rows" whenever the view is narrowed

The 10,000-row windowing (`useVirtualRows`) still applies, now over the sorted
and filtered rows, and flag marks stay with their row through a sort.

### Writing your own queries

`docs/query-cookbook.md` says which chart fits which question, what each one needs
the query to return, and the traps (single-CTE queries rejected, numeric text,
anchoring time windows on the data), with a section per chart: when to use it,
which column goes to which axis, and a query sample. Its examples are real and
runnable: `scripts/seed-chart-examples.mjs` creates one query per chart type, with
flag rules and a dashboard, on the `fundgate_transactions` table. The SQL in the
guide is generated from `scripts/lib/chart-examples.mjs` (`node
scripts/sync-query-docs.mjs` after changing it), and a test fails if the two drift.

### Stacked and two-axis bars

Two bar variants, both drawn by the same tooltip, legend and flagging as a plain
bar chart.

**`stacked_bar` - the total and what it is made of.** Same fields as a bar
chart: `x_field` (category), `y_field` (value), and an optional `series_field`
that splits each bar into stacked segments. With no series it is an ordinary bar.
Rows arrive in long form (one row per x and series), are pivoted exactly as a
multi-series bar is, and only the top segment of each stack is rounded. The
tooltip adds a total. Stacks are positive-only: a zero or negative segment takes
no height.

**`biaxial_bar` - a count beside a rate.** Two different measures over one
category axis, each on its own y axis, so a count in the thousands and a
percentage under one are both readable. A chart spec carries one `y_field`, so
the mapping is:

| Field | Meaning on this chart |
| --- | --- |
| `x_field` | category axis |
| `y_field` | **left-axis** measure (first bar colour) |
| `series_field` | **right-axis** measure column (second bar colour) |

The query is in wide form, one row per x with a column per measure:

```sql
SELECT strftime('%H:00', occurred_at) AS bucket,
       COUNT(*)                        AS txns,
       ROUND(100.0 * SUM(status = 'declined') / COUNT(*), 1) AS decline_rate_pct
FROM transactions GROUP BY 1
```

Each axis takes its bar's colour and the legend says "left axis" / "right axis"
in words, so nothing depends on telling two hues apart. A row that a flag rule
catches flags both of its bars. If the right-axis column is missing, or is the
same column as the left, the card says so instead of drawing one axis.

The editor relabels the fields for this type ("Left-axis measure", "Right-axis
measure"); on the wire they are still `y_field` and `series_field`, which is what
keeps the contract unchanged. **The engine must list both types**: add
`stacked_bar` and `biaxial_bar` to `app/policy/chart_types.py` (a new member is
stored as a string, so no migration) and deploy it before choosing either in the
dashboard, or the engine refuses the chart type.

### Creating lists, and importing them from a spreadsheet

**Creating, editing and deleting a list are dialogs**, not pages. `New list`
opens one over the lists table, and clicking a list's name (or `Edit` / `View`)
opens that list in one. Saving closes it, refreshes the table, marks the row for
a few seconds and says what happened in a banner ("Created "Blocked terminals"
with 7 items. 1 duplicate was dropped.", "Saved ...", "Deleted ..."). A failed
save keeps the dialog open with the reason, and while a save is in flight Escape,
the backdrop and the close button do nothing so the answer cannot be lost behind
a closed dialog.

The edit dialog carries everything the old page did: a read-only view for a list
somebody else made, and a delete section that asks twice, is disabled while rules
use the list (naming them, linking to their queries, and counting ones on queries
you cannot see), and offers `Check again`. Deleting closes the dialog once the
engine agrees; a refusal keeps it open.

`/lists/new` and `/lists/<id>` still work as links: they redirect to `/lists?new`
and `/lists?open=<id>`, which open the right dialog on arrival (closing it
removes the flag so a reload does not reopen it). The name in the table is a real
link to `/lists?open=<id>`, so it can be copied or opened in a new tab; only a
plain click is taken over. The dialog is the reusable `components/Modal.tsx`
(the native `<dialog>` element: real focus trap, inert page behind, Escape,
focus returns to the opener).

**Items can come from a file.** `Import from Excel or CSV` in the list form
accepts `.xlsx`, `.csv`, `.tsv` and `.txt`, by choosing or dropping a file:

1. pick the sheet (when a workbook has several) and the column,
2. say whether the first row is headings (guessed for multi-column sheets, never
   for a single column, where the first line is as likely to be an item),
3. see the count, the duplicates that will be dropped and the first few values,
4. `Add N items` appends them to the box, or replaces it if ticked.

The file is read **in the browser and never uploaded**; only the confirmed
column of text is saved, as ordinary items. Limits: 10 MB per file and 200,000
rows per sheet (the engine's own item cap, 20,000 by default, is what stops a
save). Old `.xls` workbooks, password-protected or corrupt files and unsupported
types are refused with a sentence saying what to do instead. Parsing lives in
`components/lists/spreadsheet.ts`: `read-excel-file` for `.xlsx` and
`papaparse` for CSV, both loaded only when a file is chosen. SheetJS's `xlsx` is
deliberately not used: its npm package is an unmaintained 0.18.5 with published
prototype-pollution and ReDoS advisories.

### How a chart shows what was flagged

The engine returns, with every run, which rows the query's flag rules caught.
`ChartCard` hands that outcome to the chart builders, and the rule names and
severity travel with each flagged mark (`FlagMark` in `services/charts/shape.ts`),
through pivots, the "Other" fold and merged pie slices. Every chart type then
says *where* and *why*:

- **Line and bar:** a shaded column behind each flagged x position with a `!`
  marker on top, the axis label in bold alert colour, hatched bars, and a
  tooltip that names the rules and the worst severity. Past 60 flagged columns
  the bands stop (they would merge into a wash) and the per-point marks remain.
- **Donut:** hatched wedge, a flag glyph in the legend, rules in the tooltip.
- **Heatmap, movers, compare grid:** outlined cells or a marked row; the heatmap
  readout and each cell's text say "flagged by <rule>".
- **Every card:** a strip under the title with one chip per matching rule, its
  row count and its severity in words (`charts/FlagStrip.tsx`). Rules that
  matched nothing are not shown.

Colour is never the only signal: each mark is also a shape, a glyph or a word.

### Looking at it without an engine

`scripts/mock-engine.mjs` is a fixture server that speaks enough of the engine's
API to sign in and render every chart type. Any email with the password `demo`
signs in.

```bash
node scripts/mock-engine.mjs                       # :8100
ENGINE_BASE_URL=http://127.0.0.1:8100 NEXT_DIST_DIR=.next-preview npm run dev -- --port 3100
node scripts/shoot.mjs ./shots --chrome --theme=light --base=http://localhost:3100 \
  --engine=http://127.0.0.1:8100 --password=demo --routes=/,/dashboards/d1
```

`NEXT_DIST_DIR` lets this run beside your normal dev server without the two
fighting over `.next`. Use `localhost`, not `127.0.0.1`: Next blocks dev
resources requested from the latter.

### Flagged cards rise

On a board of a dozen charts the one that has just been flagged should not be the
one you scroll to find. Every grid (the connection page, each dashboard, the
published section) puts cards that have flagged rows first, and when a poll flags a
card it **glides** to the top over about 0.4 s while the card gets a brief amber
ring. The order is:

1. flagged before unflagged;
2. the card flagged most recently first (the poll on which its count last went up);
3. then the worse severity, then the larger count;
4. then the order the page gave it. The sort is stable, so ties never shuffle.

A card that arrives already flagged at page load is not "just flagged": it sorts by
severity and count, and the first two seconds after a grid mounts apply the order
without motion, so a page does not shuffle itself every time it opens. Dismissing a
card's last flagged row sends it back to its place, smoothly. The animation is
skipped under `prefers-reduced-motion`.

**Cards never move out from under you.** The order is held, and applied the moment
the hold ends, while a card menu or a dialog is open, a card is expanded, or the
pointer is pressed. The DOM order is the visual order, deliberately (CSS `order`
would leave keyboard and screen-reader order different from what is on screen).

How it is built: `flagRanking.ts` is the arithmetic (comparator, "newly flagged"
bookkeeping, the FLIP shifts) and is tested without a browser; `FlagOrder.tsx` is the
provider and the grid hook (cards report through `useReportFlags`, the grid sorts and
animates with the Web Animations API); `flagOrderHold.ts` is the hold. A new menu or
dialog that should hold the board calls `useHoldFlagOrder(open)`; `Popover` and `Modal`
already do. `npm run check:reorder` drives all of it in a real browser against the mock
engine (`POST /__flag?query=<id>&rows=<n>` flags a query from its next poll).

### Working the grid

The grid is for scanning; reading one chart properly needs more room. Both are
available without leaving the page.

- **Expand a card** with the arrows in its header. It takes a second column and
  more rows, keeps polling throughout, and the default size is unchanged for
  everything else. Several cards can be expanded at once.
- **The grid packs densely.** Cards have different row spans - a number readout
  is shorter than a plot - and the default grid flow leaves the resulting holes
  unfilled, which reads as broken rather than as sparse. Three columns at the
  top end rather than four: at four, a card on a 1600px screen is about 325px
  wide, and a plot plus its legend does not fit in that.
- **A card's border turns amber for a beat** when its last poll brought new
  data, so across a full grid you can see which cards moved without reading any
  of them.
- **Collapse the rail** with the toggle beside the app name. It becomes a 68px
  strip that still shows every connection's status light. See "The sidebar" above.
- **Both popovers dismiss properly, and are never clipped.**
  `src/components/Popover.tsx` is the one implementation: it closes on a choice,
  on a pointer down anywhere outside it, and on Escape, which also hands focus
  back to the trigger. Opening one closes any other. The panel is unmounted
  while shut, so a half-finished delete confirmation is never waiting on the
  next open. Async items keep the menu open until the write lands, because the
  panel is where the failure is reported - closing on click would report "could
  not change the chart type" to an element that is no longer on the page.

  The panel is drawn in a portal on `document.body` with `position: fixed`,
  placed by `src/components/popoverPlacement.ts`. It has to be: a card clips its
  contents, and the card menu is 15 items and about 570px tall, so drawn inside
  its card only five items were reachable on a number card and nine on the rest.
  Now it opens below the trigger, flips above when that side has more room,
  is capped to the room it has and scrolls inside itself past that, stays inside
  the viewport, and follows the trigger while the page scrolls. A caller passes
  `panelClassName` for looks only (width, border, shadow); `shell-layout.test.ts`
  fails any caller that tries to position its own panel. Because a portal moves
  the panel in the tab order, the keyboard is bridged by hand: Tab from the
  trigger enters the panel, Tab past its last item closes it and returns to the
  trigger, Shift+Tab before its first returns without closing, and Escape returns.
- **Each card's `⋯` menu** carries the actions for the query behind it: pick how
  it is drawn (line, bar, pie, number, table), run it now, edit it, or delete
  it. Chart type is a property of the saved query rather than a view preference,
  so choosing one writes through to the engine and every other card showing that
  query agrees.
- **On a board, that menu also moves the card**, earlier or later, and takes it
  off the board. A board is an ordered set - the engine stores a position per
  card - so the order has to be changeable or every card is stuck where it was
  added. Two menu steps rather than drag-and-drop: it works from the keyboard
  and from a screen reader with no pointer gestures to reproduce, and
  "earlier/later" stays true in the single-column mobile layout where
  "left/right" would not.

### When the dashboard itself fails to load

Two error screens, because Next has two places an error can land. `src/app/(app)/error.tsx`
catches a page that throws while drawing and keeps the sidebar. `src/app/global-error.tsx`
catches what it cannot: a failure in the root layout, the auth provider, or a server render.
Without it Next shows its built-in black screen, "This page couldn't load", with no message,
which gives nobody anything to report. Ours prints the error text and, for a server-side
failure, the `digest` (search for it in the server's log), and offers Try again (which
re-fetches from the server, via `retry`) and Reload.

If you see the dashboard fail after sign-in, a screenshot of that screen is the whole bug
report. Failures of the *engine* never reach either screen: an engine that is down, or that
answers 404, 500 or 502 after sign-in, shows "Engine unreachable" in the rail and the page
stays usable (tested in a production build against all three).

### An engine that sends a different account

Reported from a Vercel deployment: sign-in succeeded and the app then crashed with
`Cannot read properties of undefined (reading 'trim')`. The account the engine
returned had no `full_name`, and the rail's account chip calls `full_name.trim()`.
The account object comes from the engine as untyped JSON, so `login()` and `me()`
now check it at the one place it enters the app (`src/services/api-client/user.ts`).
If `id`, `email`, `full_name` or `role` is missing the sign-in form says so:
*"The engine sent an account without full_name. It is probably a different build of the
engine than this dashboard expects (it sent: id, email, role, ...)."* The list of
fields it did send is there so the mismatch can be identified from the screen alone.

Two causes, and the message tells them apart:

- **`(it sent: token, user)`** means the browser reached the engine directly. The engine's
  own login answer is `{token, user}`; this app's `/api/auth/login` route turns that into the
  user plus an httpOnly cookie, and it never ran. The cause is `NEXT_PUBLIC_API_BASE_URL`
  set to the engine's URL (Vercel inlines `NEXT_PUBLIC_*` at build time, so removing it needs
  a **redeploy**, ideally with the build cache cleared). The engine and the account were fine.
  `ENGINE_BASE_URL` is the only variable that should name the engine, and it is read by the
  server, never the browser. An absolute `NEXT_PUBLIC_API_BASE_URL` is now ignored, because
  no value of it can work: the browser holds no token to send.
- **Any other list of fields** means `ENGINE_BASE_URL` points at something that is not this
  project's engine. `curl -X POST <engine>/auth/login` with a real account and compare the
  `user` it returns with `UserRead` in `src/contracts/api.ts`.

### Which build is live

`GET /version` answers without a sign-in: the commit and branch Vercel built, the
environment, and two booleans, `engineConfigured` (is `ENGINE_BASE_URL` set) and
`apiBaseUrlOverrideSet` (was `NEXT_PUBLIC_API_BASE_URL` present at build time; it should be
`false`). Values are never printed. `curl https://<your-site>/version` settles whether a fix you
pushed is the one being served: Vercel's "Redeploy" on an older deployment rebuilds that older
commit, so the site can keep showing a bug that is already fixed. Compare `commit` with
`git log -1 --format=%h` on the branch Vercel is set to deploy.

### The app icon

The browser-tab icon (`src/app/icon.tsx`, 64px) and the iOS home-screen icon
(`src/app/apple-icon.tsx`, 180px on the dark theme's ground) are the shield logo,
rendered to PNG by Next's `ImageResponse` from the same `LogoMark` component the
sidebar draws. Change the logo in `src/components/Logo.tsx` and every icon follows;
there is no image file to re-export, and no binary in the repo. The default
`favicon.ico` was removed: left in place it would add a second icon link beside
these. Browsers cache favicons hard, so after deploying, hard-reload or open the
site in a private window to see the new one.

### The sidebar

264px, and wide enough to be a status panel rather than a list of links: an
Overview link, every connection with its status dot and flagged count, every
dashboard with its card count, the admin section for those allowed it, the
signed-in account, and a detection-engine card that says whether the engine is
reachable - the difference between "nothing is happening" and "nothing is being
asked", which no individual card can tell you.

Collapsed it becomes a 68px strip of icons and status dots. Below `md` it is a
drawer behind the menu button in the top bar.

**It does not scroll with the page.** `AppShell` is exactly the viewport
(`relative h-dvh overflow-hidden`), the rail is `h-full overflow-hidden`, and the
only scroll region is the `main` inside `PageBody` (also `relative`). The document
itself can never scroll, so nothing can carry the rail along with a long page.

The cause, found on `connections/:id/flagged`: `overflow-hidden` does not clip an
`absolute` element whose containing block is outside it, and nothing in the shell
was positioned, so the containing block was `<body>`. A `sr-only` table caption
is `position: absolute`; its static position is wherever it sits in the scrolled
content, so one far down a long page stretched the document to that height. When
`main` reached its end the wheel carried on into the document, and the sidebar
scrolled away with it. Making the shell and `main` the containing blocks puts
every such element inside a box that clips it. Rule of thumb: an `overflow-*`
that is meant to contain a region needs `relative` (or any non-static `position`)
on it too.

`npm run check:layout` scrolls the connection page and the flagged page past the
end of `main` by wheel, End and `scrollIntoView` and fails if the rail moves or
the document overflows. The mock engine serves a 120-row flagged page for it.

### Layers

Three levels, and nothing else should invent one.

| Layer | `z-index` | What |
| --- | --- | --- |
| Page cards | none | Each card is its own stacking context (`defer-paint`, `rise`) |
| Top bar | 40 | `relative z-40`. The bell's panel hangs from it over the cards |
| Drawer, popovers | 50 | The mobile navigation, and every `Popover` panel |
| Modals | top layer | `<dialog>.showModal()`, above all of the above |

The header needs its own level because `backdrop-blur` makes it a stacking
context at the bottom of the order, and the cards after it in the document
painted over its dropdown and took the clicks. On a phone the bell's panel spans
the header (`inset-x-3`) instead of hanging from the bell, which sits mid-header
and put the panel 17 to 47px off the left edge.

### What `--signal-alert` means

The brief reserves the alert colour for flagged or anomalous points in chart
data, never for UI chrome. `src/services/anomaly/` gives that a precise meaning,
in priority order:

1. **An explicit flag column** (`is_flagged`, `is_fraud`, …) — but only when its
   values are genuinely two-valued. A query like `SELECT bucket, COUNT(*) AS
   flagged … GROUP BY bucket` produces a column called `flagged` holding counts,
   and treating that as a per-row flag would paint every non-zero bucket red.
2. **A robust outlier test** — the Iglewicz-Hoaglin modified z-score (median and
   median absolute deviation, threshold 3.5). Mean and standard deviation are
   the wrong tools here: a fraud spike is exactly the kind of point that inflates
   a standard deviation enough to hide itself.
3. **Never on an identifier.** A bank sort code, an account number or a row id is
   a label spelled with digits; it has no distribution to be an outlier in.
   `SELECT code, name, collateral` used to report three of ten banks as
   anomalous because their *sort codes* were numerically far from the median.
   Two guards: the value axis prefers a column that arrives as real numbers over
   one of numeric-looking strings, and the outlier test refuses a column whose
   name carries an identifier word. That second test matches on word boundaries
   only - a bare suffix test calls "encode" an identifier, and a false positive
   silently disables detection on a real measurement.

Colour is never the only signal, and on a categorical chart it is not the
*primary* one either. A flagged bar or wedge **keeps its own series colour** and
gains an alert-coloured diagonal hatch plus an alert outline; the legend keeps
its swatch and gains an alert glyph. Repainting the mark solid alert, which is
the obvious move and what this used to do, backfires: with three of five
countries flagged it left three identically red wedges and three identical
legend swatches, so the alert colour destroyed the one reading a composition
chart exists for. Identity is hue; status is texture. Line charts already worked
this way - the anomalous *point* gets a hollow ring, not the whole series.

Two more places the same principle applies. A flagged table row gets a left rule
rather than a tinted background, because tinting a row makes its own values
harder to read. And when *every* row in a result is flagged, none of them is
marked: a flag that is true for the whole result separates nothing inside it, so
the footer says it once instead of painting fifty rows red.

`src/components/charts/AlertHatch.tsx` owns the patterns, and its tests exist
specifically to fail if anyone reintroduces a recolour.

### Accessibility

Focus rings in the accent colour on every interactive element; the rail collapses
to a drawer below `md`; each card carries its query name as its accessible name;
the legend highlights on keyboard focus as well as hover; count-ups and the live
beacon collapse to instant state changes under `prefers-reduced-motion`, while
still delivering the information the animation carried.

## Decisions worth knowing

**Roles are one table, not fourteen `role === "admin"` checks.**
`src/services/auth/permissions.ts` holds what each role may do, and every screen
asks it. The alternative form has two failure modes and both are silent: a
screen that forgets the check ships an action which 403s on click, and a screen
that checks the wrong way round hides a control from the person whose job it is.
Neither shows up in a review of the component doing it, because the rule is not
written down anywhere to compare against.

The table mirrors the engine's own dependencies file for file - every
capability marked admin-only is a route the engine guards with `require_admin`,
every capability both roles hold is a route guarded only by `require_user`. The
engine is the control; the table is what stops the interface offering an action
the engine will refuse. `permissions.test.ts` carries that mapping as data, one
row per endpoint, so a reviewer can check one column against one Python file
rather than reading both codebases at once.

Two roles on purpose, following the engine: a third is a permission system in
disguise, and the moment roles need combining they should become a permission
table rather than a longer union.

Ownership is deliberately not modelled client-side. An analyst may edit their
own saved query and not somebody else's, but which rows those are is a fact
about data, not about roles - the engine scopes the list it returns, so a query
the analyst can see is a query they may act on, and a second client-side rule
could only disagree with it.

**Controls a role will never gain are absent, not disabled.** A disabled button
in a nav rail is a permanent reminder of something you will never be allowed to
do. Where a page would otherwise be half-empty, the absent control is replaced
by what the analyst actually came for: on a connection's settings page an
administrator sees the credentials form and the delete, and an analyst sees the
same connection's facts read-only above the schema browser they came to read.
The one place a disabled control is right is the last active administrator's own
row, where the control exists, is normally usable, and is refused for a reason
worth stating - so it is disabled and says why, rather than vanishing.

**The session token lives in `localStorage`, read through
`useSyncExternalStore`.** The engine reads `Authorization: Bearer` and is
configured with `allow_credentials=False`, so a cookie would never reach it -
which also means this app has no CSRF surface on the engine, since a cross-site
form post carries cookies and never a header this code attaches by hand. The
trade-off that comes with that, stated rather than left implicit: a token in
`localStorage` is readable by any script that runs on this origin, where an
httpOnly cookie is not, and the mitigation for that is upstream - a strict CSP
and no third-party scripts - not a different store here.

`token.ts` keeps a module-level copy because `request()` reads it on every call,
hundreds of times a minute during polling, and `localStorage` is a synchronous
main-thread disk read. It also listens for `storage` events, so signing out in
one tab does not leave a second tab rendering a live-looking interface over a
dead session.

A 401 drops the session in the request layer rather than in whichever screen
made the call. The rule is about the request, not the response body: if a
request that *carried* a token comes back 401, that token is not being accepted,
whatever envelope came with it - and a bare 401 from a proxy carries no envelope
at all. `/auth/login` is sent anonymously, so a wrong password can never sign
anybody out of another tab. That is structural, not a special case somebody has
to remember when a new error code appears.

**Polling leaves as one request per tick, not one per card.**
`src/services/polling/coalesce.ts` collapses three things: several charts of one
query share a request, a poll landing moments after another reuses its answer,
and polls for *different* queries raised in the same frame leave together as one
`POST /queries/poll`. A twenty-card board was twenty requests and twenty round
trips against a browser that opens six connections at a time.

The batch keeps paying off rather than only helping on first paint, and nothing
has to align the cards on a grid for that: every card in a batch is answered at
the same instant, so every card in it learns the same run time and aims its next
poll at the same moment (see "The poll interval", above). Cards of one query stay
in phase; cards on different intervals drift apart, which is correct, because
they are not asking at the same time. No poll is ever delayed to make a batch
bigger.

Results are matched back to their waiters by `query_id`, never by position. A
batch is the one place an off-by-one shows up as a card rendering another card's
rows, and every response already names itself.

**The engine readout asks both probes.** `/health` is liveness and deliberately
checks nothing - the engine's own note says a probe that fails on a database
outage turns a dependency outage into a restart loop - so it answers 200 from a
process whose app-state database is unreachable and whose every real request is
500-ing. `/ready` runs a `SELECT 1` and answers 503 when it cannot. A failed
readiness check falls through to liveness, and the difference between the two
answers is the third state the rail shows: not "live" and not "no answer" but
"not ready", the engine up and unable to serve. Three shapes, not three colours:
a hollow ring, a half-filled ring and a cross, so reading the state never
depends on telling amber from grey. The second request only happens on the
unhappy path, so the steady state is one request per interval.


**Dashboards live on the engine; nothing about them is in `localStorage`.** A
dashboard is a named, ordered set of query ids, served by five endpoints:

```
GET    /dashboards
POST   /dashboards                      { name, query_ids }
GET    /dashboards/{dashboard_id}
PUT    /dashboards/{dashboard_id}       { name?, query_ids? }
DELETE /dashboards/{dashboard_id}
```

Two consequences shape the client. `PUT` **replaces** `query_ids` rather than
merging into them, so every membership change is a read-modify-write:
`src/services/dashboards/arrange.ts` holds those as pure functions over an
ordered id list (`withQuery`, `withoutQuery`, `moved`) and
`DashboardsContext.tsx` is the only thing that talks to the engine. And
membership is an association table with `ON DELETE CASCADE`, so deleting a query
or a whole connection takes it off every board server-side — the client refetches
instead of reconciling.

`/dashboards/{id}` is fetched by id in two places rather than read out of the
already-loaded rail list. On the board page, reading it from the list is
invisible on the machine that created the board and broken everywhere else: a
link to a board created elsewhere would render "does not exist" until the list
caught up. In `rearrange`, the read-modify-write reads fresh for the same
reason plus one more - a cached order would silently drop a card another machine
added between the list loading and the click.

Only a `404` means a board is gone. Any other failure means the engine is
unreachable, and gets a retry rather than a headstone; the two used to render
the same way.

Session-only UI state — which cards are expanded, whether the rail is collapsed
— is deliberately *not* persisted anywhere. Those are momentary gestures, and a
grid that came back from a reload in a shape set days ago would surprise more
than it helped.

**Fonts come from `@fontsource-variable/*` via `next/font/local`, not from
`next/font/google`.** `next/font/google` downloads and self-hosts at build time,
so the runtime result is identical: no layout shift, no request to Google. But
its build-time fetch times out on this machine under both Turbopack and webpack
and fails `next build` outright, while `curl` and node's `fetch` reach the same
URLs fine. Pointing `next/font/local` at the woff2 the fontsource packages
already ship keeps every `next/font` benefit — self-hosting, preload,
size-adjusted fallback metrics — with no network step in the build and no font
binaries in version control. See `src/app/fonts.ts`.

**Recharts is pinned to 2.15.4.** Under 3.10.1 the built-in animation renders no
marks at all: bars produce zero rectangles and pie sectors produce empty shapes,
leaving charts permanently blank until their data happens to change. Verified
against the running engine by toggling `isAnimationActive`, and reproduced
independently of `paddingAngle`, of `<Cell>` children, and in both the headless
shell and the full Chromium build. 2.15.4 renders every mark with animation on,
which is what the design calls for. Note that Recharts 2 discovers its axes and
tooltip by scanning children **by component type and does not look inside a
fragment** — `src/components/charts/CartesianChartView.tsx` passes them as a
keyed array for that reason.

**Every engine endpoint is used by the UI.** All twenty-three, verified by
`npm run check:endpoints`, which reads the engine's live OpenAPI document,
counts its operations against the wrappers in `src/services/api-client/client.ts`
and fails if any wrapper is never called outside that directory. Three were
worth calling out because they are easy to leave stranded in a client:
`GET /connections/{id}/tables/{table}/columns` powers the expandable schema
browser in the query editor and connection settings; `POST /queries/{id}/run` is
the "Run now" action on a card's menu and above the execution history, distinct
from a poll in that it always executes and always writes a history entry; and
`GET /dashboards/{id}` is what makes a board link work on a machine that has
never listed it. The check caught that last one stranded.

**The deployed engine does not have `/dashboards` yet.** The endpoints exist on
the engine repo's `feat/fraud-analyzer-engine` branch (commit `d004dac`: models,
migration `0003_dashboards`, router, 24 API tests) but
`https://fraud-analyzer-engine.fastapicloud.dev` still serves the build without
them. Until it is redeployed, run the engine locally and point
`.env.development.local` at it.

**The deployed engine works, with one route failing.** `/connections`,
`/queries`, `/tables` and `/columns` all answer correctly from
`https://fraud-analyzer-engine.fastapicloud.dev`. But
`GET /queries/{id}/poll` returns a platform-level `502` with
`content-type: text/plain` — Cloudflare's own error page, not the engine's JSON
envelope — for the query on the failed `warehouse-neon` connection. Because that
502 never reaches the app, it carries no `Access-Control-Allow-Origin` header
either, so the browser reports it as a CORS failure. The CORS message is a
symptom; the 502 is the cause. The card degrades correctly: rose status dot,
inline "Cannot reach engine", and a retry.
