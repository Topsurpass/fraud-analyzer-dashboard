# Fraud Analyzer Dashboard

A live instrument panel over the [Fraud Analyzer Engine](https://fraud-analyzer-engine.fastapicloud.dev).
The engine stores connections and saved read-only SQL, runs that SQL, hashes the
result and exposes it as chart-ready JSON. This app is the surface an analyst
watches: a dense grid of cards, each polling its own query, each showing at a
glance whether its data just moved, is idle, or has gone stale.

```
┌──────────┬────────────────────────────────────────────┐
│ FRAUD    │  Connections › Payments DB          ● live  │
│ ANALYZER │────────────────────────────────────────────│
│          │  ┌───────────────┐ ┌───────────────┐        │
│ ● Conn A │  │ ChartCard  ⟨pulse line⟩         │        │
│ ○ Conn B │  └───────────────┘ └───────────────┘        │
│──────────│  ┌───────────────┐ ┌───────────────┐        │
│DASHBOARDS│  │ ChartCard     │ │ ChartCard     │        │
│ + New    │  └───────────────┘ └───────────────┘        │
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

### A demo database

`scripts/dev-seed.mjs` builds a realistic payments table, registers it with a
running engine, and saves one query per chart type. It only talks to the engine
URL you give it and only writes the SQLite file you point it at.

```bash
node scripts/dev-seed.mjs                    # build + register
node scripts/dev-seed.mjs --tick             # stream new rows, so polls change
node scripts/dev-seed.mjs --reset            # drop and rebuild
```

`--tick` is what makes the pulse line worth looking at: it writes new
transactions continuously, so polls return `changed: true` and the cards
actually deflect.

## Checks

Two lanes, different budgets.

**Gate** - deterministic, local, free. Runs on every commit via the hook in
`.githooks/pre-commit`; install it once per clone:

```bash
scripts/install-hooks.sh
npm test               # 234 tests, ~60s
npm run lint
npm run typecheck
npm run build
```

**Smoke** - a real browser against a real engine, run before shipping:

```bash
node scripts/dev-seed.mjs && npm run dev   # in another shell
npm run smoke                              # every chart type puts marks on screen
npm run smoke:dashboards                   # a board is really server-owned
npm run check:endpoints                    # every documented operation is used
```

The smoke lane exists because the gate lane structurally cannot catch this
project's worst failure mode. Recharts computes geometry from real layout, so
under jsdom a chart that renders zero bars and one that renders ten are
indistinguishable - both are "a `<BarChart />` that mounted without throwing".
Twice during development a library-level animation defect left charts
permanently blank while every unit test stayed green. `scripts/smoke.mjs`
asserts on the actual SVG geometry for all five chart types, checks that no card
sits in a stale state, and checks that the layout does not overflow at 390px.

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
| `src/services/charts/` | Reshapes `columns` + `rows` + `ChartSpec` into what each chart type needs, including the long→wide pivot for multi-series. |
| `src/services/anomaly/` | Decides which points get the alert colour. |
| `src/services/format/` | Every number, duration, timestamp and hash the app renders. Pure functions; callers pass `now`. |
| `src/services/dashboards/` | Server-owned dashboards: the ordered-id arithmetic `PUT /dashboards/{id}` needs, and the one context that fetches and mutates them. |
| `src/services/connections/` | The connection list, shared by the rail and every page. |

### The pulse line

`src/components/PulseLine.tsx` is the signature element and it is not
decorative — every mark on it is a real poll:

- **idle** — flat line in `--signal-live`, with a one-sample tremor per poll that
  returned `changed: false`, so it reads as alive rather than frozen
- **changed** — one sharp bipolar deflection in `--signal-change`, injected the
  moment the engine reports a new `data_hash`, which then scrolls away
- **error/stale** — dashed and dim in `--text-muted`, with an inline reason and a
  retry action on the card

The trace scrolls right to left at a fixed rate, so its horizontal axis is
genuinely time. Every pulse line on the page shares one `requestAnimationFrame`
ticker (`src/lib/ticker.ts`) rather than starting its own.

### Working the grid

The grid is for scanning; reading one chart properly needs more room. Both are
available without leaving the page.

- **Expand a card** with the arrows in its header. It takes a second column and
  more rows, keeps polling throughout, and the default size is unchanged for
  everything else. Several cards can be expanded at once.
- **Collapse the rail** with the toggle beside the app name. It becomes a 48px
  strip that still shows every connection's status light — an instrument panel
  should not lose its status lights to make room.
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

Colour is never the only signal. Anomalous points also get a distinct
hollow-ring marker, flagged table rows get a left rule, and the tooltip says
"Anomalous" in words.

### Accessibility

Focus rings in `--signal-live` on every interactive element; the rail collapses
to a drawer below `md`; each card carries its query name as its accessible name;
the legend highlights on keyboard focus as well as hover; count-ups and pulse
spikes collapse to instant state changes under `prefers-reduced-motion`, while
still delivering the information the animation carried.

## Decisions worth knowing

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
symptom; the 502 is the cause. The card degrades correctly: dashed pulse line,
inline "Cannot reach engine", and a retry.
