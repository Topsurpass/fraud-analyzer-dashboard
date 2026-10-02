# Query builder redesign: reference and acceptance rubric

Branch `feat/shared-publishing` (dashboard). **Frozen once building starts.** It is
changed only in a commit of its own, with the reason, never to make a failing check
pass. Two builders build competing designs against it; a reviewer who did not build
either judges them blind, A against B and each against the references.

## The problem, in the users' words

People creating a query on `connections/:id/queries/new` (the same component also
edits a query on `queries/:id`) get lost:

1. They do not know the order of things: write SQL, preview, add charts, add flag
   rules, set how often it runs, save.
2. Some write SQL and do not know where to click **Preview**. It is a small button in
   a panel header.
3. Some add a chart and do not know they must preview first. The field pickers stay
   empty until a preview has run, and nothing says so.
4. As they add rule conditions the rules panel grows and pushes the preview out of
   view, so they cannot see the effect of what they are writing.

## What it is today (so the builders start from facts)

`src/components/QueryEditor.tsx` (411 lines) is one `<form>`: left column SQL panel,
Preview panel, Flag rules panel; right column Schema, Charts, Execution, Save.
Pickers in `ChartSetEditor.tsx` need columns, which exist only after
`previewQuery()`. `FlagRuleEditor.tsx` (collapsed one-line rules, inline editor).
`PollIntervalField.tsx`, `SchemaBrowser.tsx`, `lists/` exist and are reused.
`QueryEditorValues` (name, description, sql_text, charts, row_limit,
poll_interval_ms, flag_rules) and the component's props are the contract with
`queries/new/page.tsx` and `queries/[id]/page.tsx`: **they do not change**, and no
engine change is needed.

## References (the bar to meet)

- **Grafana's panel editor.** The result is always on screen while you edit; the query,
  visualisation and alert settings live in tabs or panes under or beside it; "run" is
  one obvious button with a keyboard shortcut.
- **Metabase's native query editor.** SQL on top, a big **Run** button, results under
  it, and "Visualization" opens settings only once there are results.

Neither is copied. Ours must be at least as clear for a first-time user, in our own
design language (tokens in `globals.css`, light and dark, the existing `ui.tsx`,
`Modal.tsx`).

## The frozen rubric

Each item must hold at 1440 px and at 390 px, in light and dark.

- **R1 Orientation.** A persistent outline shows every part of the job in order (Query,
  Results, Charts, Rules, Schedule, then Save) with a status for each: not started,
  needs attention (and why), done. Visible without scrolling. Clicking a part goes to
  it. A first-time user can say what comes next without being told.
- **R2 Preview is unmissable.** One primary button labelled **Run preview**, placed with
  the SQL (not in a distant header), with its shortcut shown (Cmd or Ctrl plus Enter,
  and the shortcut works). Before the first run, a plain hint says what it does. After
  the SQL changes, the results are marked **out of date** with a one-click re-run.
  Running it never loses what was typed.
- **R3 Charts are never mysteriously empty.** Before a preview, the charts area says in
  one sentence that the columns come from a preview and offers a button that runs it.
  After a preview the pickers are populated with sensible defaults and a suggested chart
  type for the data. If a later preview no longer has a column a chart uses, that chart
  says so, next to the field.
- **R4 Results stay reachable.** The results are docked, pinned or one click away at all
  times while editing charts and rules. Adding ten rule conditions never moves **Run
  preview** or the results out of reach, and never makes the page jump.
- **R5 Rules and charts in dialogs where it helps.** Editing rules (and a chart if the
  design chooses) happens in a dialog or drawer with a fixed header and footer and a body
  that scrolls inside it, the same Save and Cancel semantics as today. While editing
  rules the dialog shows the live effect on the preview rows ("matches 12 of 100 rows").
  The page itself shows the rules as the one-line summaries.
- **R6 Schedule in plain language.** How often it runs and the row limit, as a sentence
  ("Runs at most every 5 minutes"), with the presets and the database-load explanation
  kept, not buried.
- **R7 Saving is safe and honest.** A persistent save bar lists exactly what blocks
  saving (name missing, SQL missing, chart field missing, rule incomplete) and each item
  jumps to the problem. Unsaved changes are flagged, and leaving with them asks first.
  Saving still sends the same payload.
- **R8 Same component, both routes.** `queries/new` and `queries/[id]` both work, edit
  mode starts with the saved values and does not make the user re-preview to see their
  own charts; every behaviour the old editor had still holds (validation, the payload,
  frozen-query errors from the engine, the delete and history sections on the edit page).
- **R9 Responsive and accessible.** At 390 px the layout is one column with the outline
  collapsed to a compact stepper and the results in a bottom sheet or equivalent; no
  horizontal scroll, no clipped control; every control has an accessible name; dialogs
  trap and restore focus; Escape closes them; contrast is fine in both themes; reduced
  motion respected.
- **R10 Craft.** It looks designed, not assembled: a consistent rhythm of spacing, clear
  hierarchy, calm empty states, restrained colour (the alert and change colours keep
  their meanings), smooth but quick transitions. Judged side by side with the references.

## The first-time-user journey (scripted, every step must work unaided)

A Playwright walkthrough, against the mock engine, that behaves like someone who has
never seen the page and reads only what is on screen:

1. Opens `connections/c1/queries/new`. The page tells them, without scrolling, what the
   parts are and where to start.
2. Types a name and some SQL.
3. Finds and uses **Run preview** (by its label or the shortcut). Sees rows and columns.
4. Edits the SQL; sees the results marked out of date; re-runs.
5. Adds a chart. Sees populated pickers and a suggested type; changes the type.
6. **Starts over in a second session:** types SQL, goes straight to Charts without
   previewing. Sees the one-sentence explanation and runs the preview from there.
7. Opens the rules dialog, adds six conditions across two rules. **Run preview and the
   results are still reachable** (assert their positions are inside the viewport or one
   labelled click away) and the dialog shows the match count.
8. Sets the schedule from a preset; sees the sentence.
9. Sees the save bar list what blocks saving (leave the name empty), fixes it, saves, and
   lands on the connection page with the new card.

The walkthrough writes screenshots `s01-orient`, `s02-typed`, `s03-preview`,
`s04-stale`, `s05-chart`, `s06-chart-before-preview`, `s07-rules-dialog`,
`s08-rules-many`, `s09-schedule`, `s10-save-blocked`, `s11-saved`, each at 1440 and at
390, into `/private/tmp/claude-502/qb/<variant>/`, and a `journey.json` with the number
of clicks per step and any step it could not complete.

## Definition of done (both variants)

`npx tsc --noEmit`, `npx eslint src scripts` (0 errors) and `npx vitest run --exclude
'.claude/**'` green; tests with every change written to fail on the old behaviour and
mutation-checked; the existing tests for the editor and both pages updated, never
deleted or weakened without a stated reason; `scripts/check-query-builder.mjs` runs the
journey and asserts R1 to R9 where measurable and fails on the old UI; README section;
no engine change; no change to `QueryEditorValues` or the editor's props.

## How the winner is chosen

A reviewer who built neither sees only the screenshots (labelled A and B in random
order), the `journey.json` files and the rubric, never the builders' reasoning. For each
of R1 to R10 and each journey step it names the better variant and exactly why; "pretty
good" and "acceptable" are failures; it passes a variant only if it would genuinely pick
it over the references for a first-time user. The loser's best ideas may be taken by the
winner. The winner is then revised against the reviewer's named findings, re-judged by a
fresh reviewer, and merged only on an explicit pass.

## Not in scope

A code editor with SQL autocomplete, saving drafts on the server, query templates,
changing what a chart or rule means, any engine change.
