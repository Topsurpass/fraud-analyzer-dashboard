"use client";

import { useMemo, useState } from "react";
import type { ComparePanel, CompareGridData } from "@/services/charts/shape";
import { panelSegments } from "@/services/charts/shape";
import { changeLabel } from "@/services/charts/severity";
import { formatAxisValue } from "@/services/format";
import { useChartFocus } from "@/lib/useChartFocus";
import { ChartEmpty } from "./ChartEmpty";
import { ChangeBadge } from "./ChangeBadge";
import { ALERT_COLOR, OTHER_COLOR, seriesColor } from "./theme";

/**
 * One two-window panel per category, laid out as small multiples.
 *
 * `compare` shows the shape of everything at once, so a terminal that
 * quadrupled while another went dark reads as flat. `movers` shows two totals
 * per terminal, so a terminal moving the same volume at a completely different
 * hour reads as unchanged. This shows the shape *per* terminal - the only one
 * of the three where a change of rhythm is visible at all.
 *
 * Three things make a grid of thirty-one terminals usable rather than a wall:
 *
 * **Focus.** Narrowing to the four terminals under investigation is a working
 * set, so the surviving panels get the whole card and the shapes become large
 * enough to actually read. The selection persists per chart.
 *
 * **Maximise.** One panel can take the card, with its bucket labels and every
 * threshold crossing named. The small panel answers "is anything happening
 * here"; the large one answers "what exactly happened, and when".
 *
 * **Surge marks.** A panel whose two windows total almost the same can still
 * have gone from four transactions to four hundred in one hour. Those hours
 * carry a ring on the line and are listed by name in the maximised view.
 *
 * Drawn as inline SVG rather than a charting library. Twenty-four recharts
 * instances mount twenty-four responsive containers and resize observers to
 * draw two polylines each; at this size a `viewBox` and a `points` string do
 * the same job for a fraction of the work, and the geometry becomes a pure
 * function the gate lane can assert on directly.
 */

const CURRENT_COLOR = seriesColor(0);
const PREVIOUS_COLOR = OTHER_COLOR;
const CHANGE_COLOR = "var(--signal-change)";

/** Panel viewBox. Aspect matters, absolute size does not - the CSS scales it. */
const PANEL_W = 100;
const PANEL_H = 26;

/** How many panels a card shows before the quiet tail is folded away. */
const VISIBLE = 8;

export interface CompareGridViewProps {
  data: CompareGridData;
  /** Chart name, used for the accessible description of the grid. */
  title: string;
  /** Scopes the saved focus selection. Two charts of one query differ. */
  chartId?: string | null;
}

function windowLabel(span: [string, string] | null): string {
  if (!span) return "";
  return span[0] === span[1] ? span[0] : `${span[0]}–${span[1]}`;
}

function yFor(value: number, peak: number, height: number): number {
  return height - (Math.max(0, value) / (peak || 1)) * height;
}

function xFor(index: number, count: number, width: number): number {
  return count > 1 ? (index * width) / (count - 1) : width / 2;
}

/** The two windows as polylines, shared by the small and maximised panels. */
function PanelLines({
  panel,
  width,
  height,
}: {
  panel: ComparePanel;
  width: number;
  height: number;
}) {
  const previous = panelSegments(
    panel.points.map((point) => point.previous),
    width,
    height,
    panel.peak,
  );
  const current = panelSegments(
    panel.points.map((point) => point.current),
    width,
    height,
    panel.peak,
  );

  return (
    <>
      {previous.map((points, index) => (
        <polyline
          key={`p${index}`}
          points={points}
          fill="none"
          stroke={PREVIOUS_COLOR}
          strokeWidth={1}
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {current.map((points, index) => (
        <polyline
          key={`c${index}`}
          points={points}
          fill="none"
          stroke={CURRENT_COLOR}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {/*
       * A ring on the hour that crossed the threshold, in the change colour and
       * hollow, so it stays separable from the filled alert dot that means a
       * flag rule matched. Two different findings must not share a mark.
       */}
      {panel.surges.map(({ index }) => {
        const value = panel.points[index]?.current;
        if (value === null || value === undefined) return null;
        return (
          <circle
            key={`s${index}`}
            cx={xFor(index, panel.points.length, width)}
            cy={yFor(value, panel.peak, height)}
            r={2.5}
            fill="none"
            stroke={CHANGE_COLOR}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}

      {panel.points.map((point, index) =>
        point.alert && point.current !== null ? (
          <circle
            key={`a${index}`}
            cx={xFor(index, panel.points.length, width)}
            cy={yFor(point.current, panel.peak, height)}
            r={2}
            fill={ALERT_COLOR}
            vectorEffect="non-scaling-stroke"
          />
        ) : null,
      )}
    </>
  );
}

function SmallPanel({
  panel,
  hint,
  onMaximise,
}: {
  panel: ComparePanel;
  hint: string;
  onMaximise: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onMaximise}
        className="w-full cursor-pointer border border-line/60 px-2 py-1.5 text-left transition-colors hover:border-line-strong"
        aria-label={`Maximise ${panel.category}`}
      >
        <div className="flex items-baseline justify-between gap-1">
          <span className="flex min-w-0 items-center gap-1">
            {panel.alert && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: ALERT_COLOR }}
              />
            )}
            <span className="truncate text-[11px] text-strong" title={panel.category}>
              {panel.category}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {/*
             * An hour that jumped is its own finding, and the window badge
             * cannot carry it: a terminal whose six-hour total fell 77% while
             * one hour inside it rose 18,000% would otherwise show a quiet
             * "-77%" and nothing else. The rings on the line say "here"; this
             * says "there are two of them" before the panel is even opened.
             */}
            {panel.surges.length > 0 && (
              <span
                className="tnum shrink-0 rounded-[3px] px-1 py-px text-[10px] font-medium leading-tight"
                style={{ border: `1px solid ${CHANGE_COLOR}`, color: CHANGE_COLOR }}
                title={`${panel.surges.length} hour${panel.surges.length === 1 ? "" : "s"} crossed the threshold against the hour before`}
              >
                <span aria-hidden="true">{panel.surges.length}h</span>
                <span className="sr-only">
                  {panel.surges.length} hour{panel.surges.length === 1 ? "" : "s"} crossed the
                  threshold
                </span>
              </span>
            )}
            <ChangeBadge verdict={panel.verdict} subject={panel.category} />
          </span>
        </div>

        <svg
          viewBox={`0 0 ${PANEL_W} ${PANEL_H}`}
          preserveAspectRatio="none"
          className="mt-1 h-8 w-full"
          role="img"
          aria-label={hint}
        >
          <PanelLines panel={panel} width={PANEL_W} height={PANEL_H} />
        </svg>

        <div className="tnum mt-0.5 flex items-baseline justify-between gap-1 text-[10px] text-muted">
          <span>
            <span className="sr-only">previous total </span>
            {formatAxisValue(panel.previousTotal)}
            <span aria-hidden="true"> → </span>
            <span className="sr-only">current total </span>
            <span className="text-strong">{formatAxisValue(panel.currentTotal)}</span>
          </span>
          {/*
           * Each panel is scaled to its own peak, so the peak has to be
           * printed: without it two panels of identical height can be a
           * hundredfold apart and nothing on screen would say so.
           */}
          <span title="Highest single bucket in this panel">
            <span className="sr-only">peak </span>
            {formatAxisValue(panel.peak)}
          </span>
        </div>
      </button>
    </li>
  );
}

const BIG_W = 600;
const BIG_H = 180;

function MaximisedPanel({
  panel,
  previous,
  current,
  threshold,
  onBack,
}: {
  panel: ComparePanel;
  previous: string;
  current: string;
  threshold: number;
  onBack: () => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const point = hover === null ? null : panel.points[hover];

  // Only a handful of labels, or a long window turns the axis into a smear.
  const labelEvery = Math.max(1, Math.ceil(panel.points.length / 8));

  return (
    <div className="flex h-full flex-col">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {panel.alert && (
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: ALERT_COLOR }}
            />
          )}
          <span className="truncate text-sm text-strong">{panel.category}</span>
          <ChangeBadge verdict={panel.verdict} subject={panel.category} />
        </span>
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 text-[11px] text-muted underline decoration-dotted underline-offset-2 hover:text-strong"
        >
          ← All terminals
        </button>
      </div>

      <div className="tnum mb-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-muted">
        <span>
          {formatAxisValue(panel.previousTotal)} <span aria-hidden="true">→</span>{" "}
          <span className="text-strong">{formatAxisValue(panel.currentTotal)}</span>
        </span>
        <span>peak {formatAxisValue(panel.peak)}</span>
        <span>
          {previous} <span aria-hidden="true">vs</span> {current}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <svg
          viewBox={`0 0 ${BIG_W} ${BIG_H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label={`${panel.category}: ${formatAxisValue(panel.previousTotal)} in ${previous}, ${formatAxisValue(panel.currentTotal)} in ${current}, ${changeLabel(panel.verdict)}`}
          onMouseLeave={() => setHover(null)}
        >
          <line
            x1={0}
            y1={BIG_H}
            x2={BIG_W}
            y2={BIG_H}
            stroke="var(--border)"
            vectorEffect="non-scaling-stroke"
          />
          <PanelLines panel={panel} width={BIG_W} height={BIG_H} />

          {/*
           * Full-height hit strips rather than the line itself. A 1.5px stroke
           * is an impossible target, and the reader is pointing at an hour
           * rather than at a pixel of the curve.
           */}
          {panel.points.map((entry, index) => (
            <rect
              key={entry.bucket || index}
              x={xFor(index, panel.points.length, BIG_W) - BIG_W / (panel.points.length * 2)}
              y={0}
              width={BIG_W / panel.points.length}
              height={BIG_H}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          ))}

          {hover !== null && (
            <line
              x1={xFor(hover, panel.points.length, BIG_W)}
              y1={0}
              x2={xFor(hover, panel.points.length, BIG_W)}
              y2={BIG_H}
              stroke="var(--signal-live)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-muted">
        {panel.points.map((entry, index) =>
          index % labelEvery === 0 ? (
            <span key={entry.bucket || index} className="tnum truncate">
              {entry.bucket}
            </span>
          ) : null,
        )}
      </div>

      {/* A fixed-height readout, so the plot never jumps as the pointer moves. */}
      <div className="tnum mt-1 h-4 text-[11px] leading-4 text-muted">
        {point ? (
          <span>
            {point.bucket}:{" "}
            {point.current === null ? (
              "no rows"
            ) : (
              <span className="text-strong">{formatAxisValue(point.current)}</span>
            )}
            {point.previous !== null && (
              <>
                {" "}
                · {point.previousBucket} was {formatAxisValue(point.previous)}
              </>
            )}
            {point.alert && " · flagged"}
          </span>
        ) : panel.surges.length > 0 ? (
          <span>
            {/*
             * The whole reason to open a panel: which hours crossed, by name.
             * A ring on a line says "here"; this says "22:00, up 340%".
             */}
            Crossed {threshold}% at{" "}
            {panel.surges
              .map(
                ({ index, verdict }) =>
                  `${panel.points[index]?.bucket ?? "?"} (${changeLabel(verdict)})`,
              )
              .join(", ")}
          </span>
        ) : (
          <span>No hour crossed the {threshold}% threshold.</span>
        )}
      </div>
    </div>
  );
}

export function CompareGridView({ data, title, chartId }: CompareGridViewProps) {
  const [expanded, setExpanded] = useState(false);
  const [maximised, setMaximised] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const focus = useChartFocus(chartId);

  const previous = windowLabel(data.previousSpan) || "previous";
  const current = windowLabel(data.currentSpan) || "current";

  const focused = useMemo(
    () =>
      focus.selected.size === 0
        ? data.panels
        : data.panels.filter((panel) => focus.selected.has(panel.category)),
    [data.panels, focus.selected],
  );

  if (data.panels.length === 0) {
    return <ChartEmpty label={data.warnings[0] ?? "No rows in range"} />;
  }

  const open = maximised ? data.panels.find((panel) => panel.category === maximised) : null;
  if (open) {
    return (
      <MaximisedPanel
        panel={open}
        previous={previous}
        current={current}
        threshold={data.threshold}
        onBack={() => setMaximised(null)}
      />
    );
  }

  const rising = focused.filter((panel) => panel.delta > 0).length;
  const falling = focused.filter((panel) => panel.delta < 0).length;

  // A narrowed grid gives its survivors the room that narrowing was for: four
  // panels across a card are big enough to read a shape in.
  const narrow = focus.selected.size > 0 && focused.length <= 6;
  const columns = narrow ? "minmax(14rem,1fr)" : "minmax(9rem,1fr)";

  // A chosen set is never folded away: the reader asked for exactly these.
  const shown = expanded || focus.selected.size > 0 ? focused : focused.slice(0, VISIBLE);
  const hidden = focused.length - shown.length;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-0 w-3 border-t border-dashed"
            style={{ borderColor: PREVIOUS_COLOR }}
          />
          {previous}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-0 w-3 border-t-2"
            style={{ borderColor: CURRENT_COLOR }}
          />
          {current}
        </span>
        <span>{`${rising} up · ${falling} down`}</span>
        {data.surgingCount > 0 && (
          <span
            className="font-medium"
            style={{ color: CHANGE_COLOR }}
          >{`${data.surgingCount} past ${data.threshold}%`}</span>
        )}
        <button
          type="button"
          onClick={() => setPicking((isOpen) => !isOpen)}
          className="ml-auto shrink-0 underline decoration-dotted underline-offset-2 hover:text-strong"
          aria-expanded={picking}
        >
          {focus.selected.size > 0 ? `${focus.selected.size} chosen` : "Choose terminals"}
        </button>
      </div>

      {picking && (
        <div className="mb-1.5 max-h-32 overflow-auto border border-line/60 p-1.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-muted">
              Showing {focus.selected.size === 0 ? "all" : focus.selected.size} of{" "}
              {data.panels.length}
            </span>
            {focus.selected.size > 0 && (
              <button
                type="button"
                onClick={focus.clear}
                className="text-[11px] text-muted underline decoration-dotted underline-offset-2 hover:text-strong"
              >
                Show all
              </button>
            )}
          </div>
          <ul className="grid gap-x-2 [grid-template-columns:repeat(auto-fill,minmax(8rem,1fr))]">
            {data.panels.map((panel) => (
              <li key={panel.category}>
                <label className="flex cursor-pointer items-center gap-1.5 py-px text-[11px] text-muted hover:text-strong">
                  <input
                    type="checkbox"
                    checked={focus.isSelected(panel.category)}
                    onChange={() => focus.toggle(panel.category)}
                    className="h-3 w-3 shrink-0"
                  />
                  <span className="truncate" title={panel.category}>
                    {panel.category}
                  </span>
                  {panel.verdict.severity !== "normal" && (
                    <span aria-hidden="true" style={{ color: CHANGE_COLOR }}>
                      ▲
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-muted">
            No chosen terminal appears in this result.
          </p>
        ) : (
          <ul
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(auto-fill,${columns})` }}
            aria-label={`${title}: ${current} against ${previous}, one panel per category, biggest movers first`}
          >
            {shown.map((panel) => (
              <SmallPanel
                key={panel.category}
                panel={panel}
                onMaximise={() => setMaximised(panel.category)}
                hint={`${panel.category}: ${formatAxisValue(panel.previousTotal)} in ${previous}, ${formatAxisValue(panel.currentTotal)} in ${current}, ${changeLabel(panel.verdict)}`}
              />
            ))}
          </ul>
        )}

        {(hidden > 0 || (expanded && focus.selected.size === 0)) && (
          <button
            type="button"
            onClick={() => setExpanded((isOpen) => !isOpen)}
            className="mt-1.5 text-[11px] text-muted underline decoration-dotted underline-offset-2 hover:text-strong"
          >
            {expanded ? "Show fewer" : `Show ${hidden} quieter`}
          </button>
        )}
      </div>
    </div>
  );
}
