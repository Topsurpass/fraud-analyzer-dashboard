"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import type { CompareData, ComparePoint } from "@/services/charts/shape";
import { formatAxisValue } from "@/services/format";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { ChartEmpty } from "./ChartEmpty";
import { ChangeBadge } from "./ChangeBadge";
import { type ChangeVerdict, changeLabel } from "@/services/charts/severity";
import { ChartTooltip, type TooltipEntry } from "./ChartTooltip";
import { SeriesLegend } from "./SeriesLegend";
import {
  ALERT_COLOR,
  AXIS_TICK,
  CHART_MARGIN,
  CURSOR_STROKE,
  DATA_TWEEN_MS,
  GRID_STROKE,
  OTHER_COLOR,
  seriesColor,
} from "./theme";

/**
 * One measure over two consecutive windows, drawn on top of each other.
 *
 * The analytical claim of this chart is the *distance between the lines*, not
 * either line's level - so the design puts that distance in three places at
 * once, because a shape alone is slow to read under queue pressure:
 *
 * 1. A headline strip: both totals and the change between them, in words.
 * 2. The widest single-bucket gap, called out and shaded on the plot, so the
 *    eye is sent to the bucket that carries the story.
 * 3. The two lines themselves, for the shape the numbers cannot carry.
 *
 * The previous window is deliberately the quieter mark - dashed, slate, no
 * points. It is context. The current window is the subject and gets the solid
 * ramp colour. Making them equally loud is the classic failure of this chart:
 * both lines shout and neither reads as "then" versus "now".
 */

const CURRENT_COLOR = seriesColor(0);
const PREVIOUS_COLOR = OTHER_COLOR;

export interface CompareChartViewProps {
  data: CompareData;
  /** Chart name, used for the accessible description of the plot. */
  title: string;
}

/**
 * The same change the badge shows, phrased as prose for the plot's spoken
 * label. "+133%" is right on a chip and wrong inside a sentence.
 *
 * Delegating to `changeLabel` rather than recomputing keeps one rounding rule:
 * a badge reading "+112%" beside a label reading "up 111%" is the kind of
 * disagreement nobody notices until a reader has to explain it.
 */
function describeChange(verdict: ChangeVerdict): string {
  const label = changeLabel(verdict);
  if (label.startsWith("+")) return `up ${label.slice(1)}`;
  if (label.startsWith("−")) return `down ${label.slice(1)}`;
  return label;
}

function CompareTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as ComparePoint | undefined;
  if (!point) return null;

  const entries: TooltipEntry[] = [
    point.current !== null && {
      name: "Current",
      value: point.current,
      color: CURRENT_COLOR,
      alert: point.alert === true,
    },
    point.previous !== null && {
      // Named with its own bucket: the two numbers were measured an hour (or a
      // day, or whatever the window is) apart, and the label has to say so.
      name: point.previousBucket ? `Previous (${point.previousBucket})` : "Previous",
      value: point.previous,
      color: PREVIOUS_COLOR,
      alert: false,
    },
  ].filter((entry): entry is TooltipEntry => Boolean(entry));

  const footer =
    point.delta === null
      ? undefined
      : `${point.delta > 0 ? "+" : ""}${formatAxisValue(point.delta)} vs previous`;

  return <ChartTooltip label={String(label)} entries={entries} footer={footer} />;
}

export function CompareChartView({ data, title }: CompareChartViewProps) {
  const [active, setActive] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();

  if (data.points.length === 0) {
    return <ChartEmpty label={data.warnings[0] ?? "No rows in range"} />;
  }

  const change = describeChange(data.verdict);
  const gap = data.widestGap;

  const legend = [
    { id: "current", label: "Current", color: CURRENT_COLOR, alert: data.hasAlerts },
    { id: "previous", label: "Previous", color: PREVIOUS_COLOR },
  ];

  return (
    <div className="flex h-full flex-col">
      {/*
       * The answer before the picture. An analyst working a queue needs to know
       * whether this terminal moved without decoding two lines first.
       */}
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tnum text-lg leading-none text-strong">
          {formatAxisValue(data.currentTotal)}
        </span>
        <span className="text-[11px] text-muted">
          vs <span className="tnum">{formatAxisValue(data.previousTotal)}</span> previous
        </span>
        {/*
         * One badge component across every chart, so "this moved enough to
         * look at" cannot come to mean different things on different cards.
         * It also stays quiet under the threshold, where the old always-amber
         * text called a 2% drift a change worth colouring.
         */}
        <ChangeBadge verdict={data.verdict} subject={title} />
        {gap && (
          <span className="text-[11px] text-muted">
            widest gap at <span className="tnum">{gap.bucket}</span> (
            <span className="tnum">
              {gap.delta > 0 ? "+" : ""}
              {formatAxisValue(gap.delta)}
            </span>
            )
          </span>
        )}
      </div>

      {/*
       * The accessible name sits on the wrapper rather than on the SVG. A
       * recharts plot has no structure a screen reader can walk, so the whole
       * region is one labelled image, and the label carries the finding the
       * lines are there to show. It also means the name exists whether or not
       * the plot has been measured and drawn yet.
       */}
      <div
        className="min-h-0 flex-1"
        role="img"
        aria-label={`${title}: current window ${change} against the previous window${
          gap ? `, widest gap at ${gap.bucket}` : ""
        }`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.points} margin={CHART_MARGIN}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="bucket" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={formatAxisValue}
            />
            {gap && (
              // A band on the bucket that carries the divergence. Drawn before
              // the lines so it sits behind them rather than veiling them.
              <ReferenceArea
                x1={gap.bucket}
                x2={gap.bucket}
                fill={CURSOR_STROKE}
                fillOpacity={0.1}
                stroke={CURSOR_STROKE}
                strokeOpacity={0.35}
                strokeDasharray="2 3"
              />
            )}
            <Tooltip
              content={<CompareTooltip />}
              cursor={{ stroke: CURSOR_STROKE, strokeWidth: 1 }}
            />
            <Line
              type="monotone"
              dataKey="previous"
              name="Previous"
              stroke={PREVIOUS_COLOR}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              activeDot={false}
              // A gap in the previous window is a gap, not a line drawn across
              // it: connecting nulls invents history that was never queried.
              connectNulls={false}
              isAnimationActive={!reducedMotion}
              animationDuration={DATA_TWEEN_MS}
              opacity={active === "current" ? 0.3 : 1}
            />
            <Line
              type="monotone"
              dataKey="current"
              name="Current"
              stroke={CURRENT_COLOR}
              strokeWidth={2}
              dot={<CurrentDot />}
              activeDot={{ r: 3, fill: CURRENT_COLOR, stroke: "var(--surface-raised)" }}
              connectNulls={false}
              isAnimationActive={!reducedMotion}
              animationDuration={DATA_TWEEN_MS}
              opacity={active === "previous" ? 0.3 : 1}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <SeriesLegend series={legend} active={active} onActiveChange={setActive} />
    </div>
  );
}

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: ComparePoint;
}

/** Only flagged buckets carry a mark, so a mark always means something. */
function CurrentDot({ cx, cy, payload }: DotProps) {
  if (cx === undefined || cy === undefined || !payload?.alert) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3.5}
      fill={ALERT_COLOR}
      stroke="var(--surface-raised)"
      strokeWidth={1.5}
    />
  );
}
