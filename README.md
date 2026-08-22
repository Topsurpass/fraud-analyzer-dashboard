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

```bash
npm test               # gate suite: deterministic, local, ~20s
npm run lint
npx tsc --noEmit
npm run build
```

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
| `src/services/dashboards/` | Client-side dashboards over query ids. |
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

**Dashboards are stored in this browser.** The engine models connections and
saved queries; it has no dashboard resource. A dashboard here is a named,
ordered set of query ids in `localStorage`, so it can span connections but does
not follow the analyst to another machine. The UI says so where it matters.
Everything a dashboard points at — the queries, the SQL, the results — is
server-side and shared.

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

**The deployed engine is currently failing.** `GET /health` returns
`200 {"status":"ok"}`, but every database-backed route returns
`500 INTERNAL_ERROR` — `/connections` included. `/health` is the one endpoint
that touches no database, which is why the top-bar readout uses it: it separates
"the engine is down" from "the engine is up but its storage is unhappy". Running
the engine locally from its own repo, against a migrated SQLite file, all of
these routes return 200, so this is environmental rather than a contract
problem.
