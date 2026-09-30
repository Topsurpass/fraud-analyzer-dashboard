"use client";

import { useId, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import type { CartesianData, ChartPoint } from "@/services/charts/shape";
import { formatAxisValue } from "@/services/format";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { ChartEmpty } from "./ChartEmpty";
import { useAlertHatch } from "./AlertHatch";
import { ChartTooltip, type TooltipEntry } from "./ChartTooltip";
import { SeriesLegend } from "./SeriesLegend";
import {
  ALERT_COLOR,
  ANIMATION_MARK_BUDGET,
  AXIS_TICK,
  CHART_MARGIN,
  CURSOR_STROKE,
  DATA_TWEEN_MS,
  GRID_STROKE,
  seriesColor,
} from "./theme";

/**
 * Line and bar rendering. One component because the two differ only in the mark:
 * the axes, crosshair, tooltip, legend behaviour, alert handling and animation
 * policy are identical, and keeping them together is what stops them drifting.
 */

export interface CartesianChartViewProps {
  data: CartesianData;
  kind: "line" | "bar";
  /** Query name, used for the accessible description of the plot. */
  title: string;
}

interface AlertDotProps {
  cx?: number;
  cy?: number;
  payload?: ChartPoint;
  dataKey?: string;
  stroke?: string;
  /**
   * Draw every point, not just the anomalous ones. Set when the series is too
   * short to form a visible line.
   */
  showAll?: boolean;
}

/**
 * Points are unmarked unless the data says they are anomalous, in which case
 * they get the alert colour *and* a distinct hollow-ring shape. The shape is
 * what carries the meaning for a colour-blind analyst.
 *
 * The exception is a series with a single point: a one-point line has no
 * segment to draw, so without a dot the card renders an empty plot over real
 * data - indistinguishable from a broken chart, which is exactly what the
 * design brief forbids.
 */
function AlertDot({ cx, cy, payload, dataKey, stroke, showAll }: AlertDotProps) {
  // `null`, not `<g />`. Recharts calls this once per point per series, so an
  // empty group for an unmarked point is a real DOM node per point - 900 of
  // them on a full plot, all of them invisible.
  if (cx === undefined || cy === undefined) return null;

  const flagged = typeof dataKey === "string" && payload?.__alert?.[dataKey] === true;

  if (flagged) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={6} fill={ALERT_COLOR} opacity={0.16} />
        <circle cx={cx} cy={cy} r={4.5} fill="var(--surface)" stroke={ALERT_COLOR} strokeWidth={2} />
        <circle cx={cx} cy={cy} r={1.6} fill={ALERT_COLOR} />
      </g>
    );
  }

  if (showAll)
    return <circle cx={cx} cy={cy} r={3.5} fill="var(--surface)" stroke={stroke ?? "currentColor"} strokeWidth={2} />;

  return null;
}

export function CartesianChartView({ data, kind, title }: CartesianChartViewProps) {
  const reducedMotion = useReducedMotion();
  // Gradient ids are scoped per chart: several cards share one document.
  const gradientScope = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradientId = (index: number) => `fill-${gradientScope}-${index}`;
  const [activeSeries, setActiveSeries] = useState<string | null>(null);

  /*
   * Which series carry a flagged point, in one pass over the plot rather than
   * one pass per series.
   *
   * It answers two questions at once, and the second is the expensive one: a
   * series with no flagged point needs no dot layer and no per-bar cell at all,
   * and skipping those is the difference between 900 invisible SVG nodes per
   * line and none.
   */
  const alerted = useMemo(() => {
    const keys = new Set<string>();
    for (const point of data.data) {
      const mask = point.__alert;
      if (!mask) continue;
      for (const key of Object.keys(mask)) {
        if (mask[key]) keys.add(key);
      }
    }
    return keys;
  }, [data.data]);

  // A series key is already unique here - the pivot dedupes them - so it is
  // both the identity and the label. The two are separate in the legend's
  // contract because the pie's are not.
  const legend = data.seriesKeys.map((key, index) => ({
    id: key,
    label: key,
    color: seriesColor(index),
    alert: alerted.has(key),
  }));

  // One hatch pattern per series colour actually on this chart.
  const hatch = useAlertHatch(data.seriesKeys.map((_, index) => seriesColor(index)));

  // Axes over an empty plot look like a failure. Say what actually happened.
  if (data.data.length === 0) return <ChartEmpty />;

  // A single-point series has no segment to draw, so its points are rendered
  // explicitly rather than leaving an empty plot.
  const showAllDots = data.data.length < 2;
  const animate =
    !reducedMotion && data.data.length * data.seriesKeys.length <= ANIMATION_MARK_BUDGET;

  const renderTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;

    const entries: TooltipEntry[] = payload
      .filter((item) => typeof item.value === "number")
      .map((item, index) => {
        const key = String(item.dataKey ?? item.name ?? "");
        const point = item.payload as ChartPoint | undefined;
        return {
          name: key,
          value: item.value as number,
          color: item.color ?? seriesColor(index),
          alert: point?.__alert?.[key] === true,
        };
      });

    return <ChartTooltip label={String(label ?? "")} entries={entries} />;
  };

  /*
   * A keyed array, not a fragment. Recharts scans its children by component
   * type to discover axes, grid and tooltip, and that scan does not look inside
   * a fragment - wrapping these in one silently drops every axis, tick and
   * gridline while still rendering the data marks. An array is flattened by
   * React.Children and is seen correctly.
   */
  const axes = [
    <CartesianGrid key="grid" stroke={GRID_STROKE} strokeDasharray="3 5" vertical={false} />,
    <XAxis
      key="x"
      dataKey={data.xKey}
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={false}
      tickMargin={8}
      minTickGap={28}
      height={28}
    />,
    <YAxis
      key="y"
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={false}
      width={48}
      tickFormatter={(value: number) => formatAxisValue(value)}
    />,
    <Tooltip
      key="tooltip"
      content={renderTooltip}
      /*
       * Line charts get a vertical guide line; bar charts get a band behind the
       * hovered category, because a 1px rule inside a bar is invisible. The
       * band has to be set explicitly - Recharts defaults it to a near-white
       * fill that blows a hole in a dark panel.
       */
      cursor={
        kind === "line"
          ? { stroke: CURSOR_STROKE, strokeWidth: 1.5 }
          : { fill: "var(--surface-raised)", fillOpacity: 0.6, radius: 8 }
      }
      // The tooltip must not lag the crosshair; it is a readout, not a card.
      isAnimationActive={false}
    />,
  ];

  // One soft vertical fade per series colour: strong at the line, gone at the
  // axis. It is what makes the plot read as a modern area chart instead of a
  // bare stroke, and in a bar chart it gives each column depth.
  const gradients = (
    <defs>
      {data.seriesKeys.map((key, index) => (
        <linearGradient key={key} id={gradientId(index)} x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor={seriesColor(index)}
            stopOpacity={kind === "line" ? (data.seriesKeys.length > 1 ? 0.28 : 0.38) : 1}
          />
          <stop
            offset="100%"
            stopColor={seriesColor(index)}
            stopOpacity={kind === "line" ? 0.02 : 0.72}
          />
        </linearGradient>
      ))}
    </defs>
  );

  const opacityFor = (key: string) =>
    activeSeries === null || activeSeries === key ? 1 : 0.22;

  return (
    <div className="flex h-full flex-col">
      <div
        className="min-h-0 flex-1"
        role="img"
        aria-label={`${title}: ${kind} chart, ${data.data.length} points across ${data.seriesKeys.length} series`}
      >
        <ResponsiveContainer width="100%" height="100%">
          {kind === "line" ? (
            <AreaChart data={data.data} margin={CHART_MARGIN}>
              {gradients}
              {axes}
              {data.seriesKeys.map((key, index) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={seriesColor(index)}
                  strokeWidth={2.25}
                  strokeOpacity={opacityFor(key)}
                  fill={`url(#${gradientId(index)})`}
                  fillOpacity={opacityFor(key)}
                  // `false`, not a component, when this series has nothing to
                  // mark: recharts skips the dot layer entirely rather than
                  // calling a renderer 900 times to be told "draw nothing".
                  dot={showAllDots || alerted.has(key) ? <AlertDot showAll={showAllDots} /> : false}
                  activeDot={{
                    r: 5,
                    fill: "var(--surface)",
                    stroke: seriesColor(index),
                    strokeWidth: 2.5,
                  }}
                  isAnimationActive={animate}
                  animationDuration={DATA_TWEEN_MS}
                  connectNulls
                />
              ))}
            </AreaChart>
          ) : (
            <BarChart data={data.data} margin={CHART_MARGIN} barCategoryGap="22%" barGap={3}>
              {hatch.defs}
              {gradients}
              {axes}
              {data.seriesKeys.map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={`url(#${gradientId(index)})`}
                  fillOpacity={opacityFor(key)}
                  isAnimationActive={animate}
                  animationDuration={DATA_TWEEN_MS}
                  maxBarSize={44}
                  radius={[6, 6, 0, 0]}
                >
                  {/*
                   * A flagged bar keeps its series colour and takes the hatch
                   * plus an alert outline. Repainting it solid alert would make
                   * two flagged bars from different series identical.
                   *
                   * Emitted only for a series that actually has a flagged bar.
                   * A Cell is a React element per bar, so an unflagged series
                   * was paying 900 elements to restate the fill the Bar already
                   * carries.
                   */}
                  {alerted.has(key)
                    ? data.data.map((point, pointIndex) => {
                        const flagged = point.__alert?.[key] === true;
                        return (
                          <Cell
                            key={pointIndex}
                            fill={flagged ? hatch.fill(seriesColor(index), true) : `url(#${gradientId(index)})`}
                            stroke={flagged ? ALERT_COLOR : undefined}
                            strokeWidth={flagged ? 1 : 0}
                          />
                        );
                      })
                    : null}
                </Bar>
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <SeriesLegend series={legend} active={activeSeries} onActiveChange={setActiveSeries} />
    </div>
  );
}
