"use client";

import { useId, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import type { BiaxialData, ChartPoint } from "@/services/charts/shape";
import { formatAxisValue } from "@/services/format";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { useAlertHatch } from "./AlertHatch";
import {
  BandMarker,
  FlagTick,
  MAX_FLAG_BANDS,
  flaggedBuckets,
} from "./CartesianChartView";
import { ChartEmpty } from "./ChartEmpty";
import { ChartTooltip, type TooltipEntry } from "./ChartTooltip";
import { SeriesLegend } from "./SeriesLegend";
import {
  ALERT_COLOR,
  ANIMATION_MARK_BUDGET,
  AXIS_TICK,
  CHART_MARGIN,
  DATA_TWEEN_MS,
  GRID_STROKE,
  seriesColor,
} from "./theme";

/**
 * Two measures, two axes.
 *
 * The left measure is drawn in the first series colour against the left axis and
 * the right measure in the second against the right axis. The axis ticks take
 * their bar's colour, which is what answers "which scale am I reading" without
 * the eye leaving the plot; the legend says it in words too ("left axis"), so it
 * does not depend on telling two hues apart.
 *
 * Flagging works as it does on the plain bar chart: a flagged row shades its
 * column, marks it, and hatches both of its bars.
 */

export interface BiaxialBarChartViewProps {
  data: BiaxialData;
  /** Query name, used for the accessible description of the plot. */
  title: string;
}

const LEFT_COLOR = seriesColor(0);
const RIGHT_COLOR = seriesColor(1);

/** An axis tick in its bar's colour, darkened toward the text colour so the
 *  lighter series hue stays legible at 11px on a white card. */
function axisTick(color: string) {
  return {
    ...AXIS_TICK,
    fill: `color-mix(in srgb, ${color} 72%, var(--text-primary))`,
  };
}

export function BiaxialBarChartView({ data, title }: BiaxialBarChartViewProps) {
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState<"left" | "right" | null>(null);
  const scope = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradientId = (side: "left" | "right") => `biaxial-${scope}-${side}`;

  const { leftKey, rightKey } = data;
  const hatch = useAlertHatch([LEFT_COLOR, RIGHT_COLOR]);

  const buckets = useMemo(() => flaggedBuckets(data), [data]);
  const flaggedLabels = useMemo(() => new Set(buckets.map((bucket) => bucket.label)), [buckets]);
  const flaggedSides = useMemo(() => {
    let left = false;
    let right = false;
    for (const point of data.data) {
      if (point.__alert?.[leftKey]) left = true;
      if (point.__alert?.[rightKey]) right = true;
    }
    return { left, right };
  }, [data.data, leftKey, rightKey]);

  // No second measure means the chart cannot be drawn, and the reason is the
  // last warning shaping added, not a blank plot.
  if (!leftKey || !rightKey) {
    return <ChartEmpty label={data.warnings.at(-1) ?? "No rows in range"} />;
  }
  if (data.data.length === 0) return <ChartEmpty />;

  const animate = !reducedMotion && data.data.length * 2 <= ANIMATION_MARK_BUDGET;
  const dim = (side: "left" | "right") => (active === null || active === side ? 1 : 0.22);

  const renderTooltip = ({ active: hovering, payload, label }: TooltipProps<number, string>) => {
    if (!hovering || !payload?.length) return null;
    const entries: TooltipEntry[] = payload
      .filter((item) => typeof item.value === "number")
      .map((item) => {
        const key = String(item.dataKey ?? "");
        const point = item.payload as ChartPoint | undefined;
        const mark = point?.__flag?.[key];
        return {
          name: key,
          value: item.value as number,
          color: item.color ?? LEFT_COLOR,
          alert: point?.__alert?.[key] === true,
          flag: mark ? { rules: mark.rules, severity: mark.severity } : undefined,
        };
      });
    return <ChartTooltip label={String(label ?? "")} entries={entries} />;
  };

  const bands =
    buckets.length <= MAX_FLAG_BANDS
      ? buckets
          .filter((bucket) => bucket.x !== null && bucket.x !== undefined && bucket.x !== "")
          .map((bucket, index) => (
            <ReferenceArea
              key={`flag-${index}`}
              yAxisId="left"
              x1={bucket.x as string | number}
              x2={bucket.x as string | number}
              fill={ALERT_COLOR}
              fillOpacity={0.09}
              strokeOpacity={0}
              ifOverflow="visible"
              label={<BandMarker />}
            />
          ))
      : [];

  const bar = (side: "left" | "right", key: string, color: string, flaggedAny: boolean) => (
    <Bar
      key={side}
      yAxisId={side}
      dataKey={key}
      fill={`url(#${gradientId(side)})`}
      fillOpacity={dim(side)}
      isAnimationActive={animate}
      animationDuration={DATA_TWEEN_MS}
      maxBarSize={36}
      radius={[6, 6, 0, 0]}
    >
      {/* Only a side with a flagged bar pays for a Cell per bar. */}
      {flaggedAny
        ? data.data.map((point, pointIndex) => {
            const flagged = point.__alert?.[key] === true;
            return (
              <Cell
                key={pointIndex}
                fill={flagged ? hatch.fill(color, true) : `url(#${gradientId(side)})`}
                stroke={flagged ? ALERT_COLOR : undefined}
                strokeWidth={flagged ? 1 : 0}
              />
            );
          })
        : null}
    </Bar>
  );

  return (
    <div className="flex h-full flex-col">
      <div
        className="min-h-0 flex-1"
        role="img"
        aria-label={`${title}: bar chart with two axes, ${data.data.length} points, ${leftKey} on the left axis and ${rightKey} on the right`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data.data}
            margin={{ ...CHART_MARGIN, right: 8 }}
            barCategoryGap="14%"
            barGap={2}
          >
            {hatch.defs}
            <defs>
              {(["left", "right"] as const).map((side) => (
                <linearGradient key={side} id={gradientId(side)} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={side === "left" ? LEFT_COLOR : RIGHT_COLOR}
                    stopOpacity={1}
                  />
                  <stop
                    offset="100%"
                    stopColor={side === "left" ? LEFT_COLOR : RIGHT_COLOR}
                    stopOpacity={0.72}
                  />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 5" vertical={false} />
            <XAxis
              dataKey={data.xKey}
              tick={flaggedLabels.size > 0 ? <FlagTick flagged={flaggedLabels} /> : AXIS_TICK}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={28}
              height={28}
            />
            <YAxis
              yAxisId="left"
              orientation="left"
              tick={axisTick(LEFT_COLOR)}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(value: number) => formatAxisValue(value)}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={axisTick(RIGHT_COLOR)}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(value: number) => formatAxisValue(value)}
            />
            <Tooltip
              content={renderTooltip}
              cursor={{ fill: "var(--surface-raised)", fillOpacity: 0.6, radius: 8 }}
              isAnimationActive={false}
            />
            {bands}
            {bar("left", leftKey, LEFT_COLOR, flaggedSides.left)}
            {bar("right", rightKey, RIGHT_COLOR, flaggedSides.right)}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <SeriesLegend
        series={[
          {
            id: "left",
            label: `${leftKey} · left axis`,
            color: LEFT_COLOR,
            alert: flaggedSides.left,
          },
          {
            id: "right",
            label: `${rightKey} · right axis`,
            color: RIGHT_COLOR,
            alert: flaggedSides.right,
          },
        ]}
        active={active}
        onActiveChange={(id) => setActive(id === "left" || id === "right" ? id : null)}
      />
    </div>
  );
}
