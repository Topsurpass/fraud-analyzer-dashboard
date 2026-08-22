"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
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
import { ChartTooltip, type TooltipEntry } from "./ChartTooltip";
import { SeriesLegend } from "./SeriesLegend";
import {
  ALERT_COLOR,
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
  fill?: string;
  index?: number;
}

/**
 * Points are unmarked unless the data says they are anomalous, in which case
 * they get the alert colour *and* a distinct hollow-ring shape. The shape is
 * what carries the meaning for a colour-blind analyst.
 */
function AlertDot({ cx, cy, payload, dataKey }: AlertDotProps) {
  const flagged =
    typeof dataKey === "string" && payload?.__alert?.[dataKey] === true;
  if (!flagged || cx === undefined || cy === undefined) return <g />;

  return (
    <g>
      <circle cx={cx} cy={cy} r={4.5} fill="none" stroke={ALERT_COLOR} strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={1.5} fill={ALERT_COLOR} />
    </g>
  );
}

export function CartesianChartView({ data, kind, title }: CartesianChartViewProps) {
  const reducedMotion = useReducedMotion();
  const [activeSeries, setActiveSeries] = useState<string | null>(null);

  const legend = data.seriesKeys.map((key, index) => ({ key, color: seriesColor(index) }));

  // Axes over an empty plot look like a failure. Say what actually happened.
  if (data.data.length === 0) return <ChartEmpty />;

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
    <CartesianGrid key="grid" stroke={GRID_STROKE} strokeDasharray="2 4" vertical={false} />,
    <XAxis
      key="x"
      dataKey={data.xKey}
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={{ stroke: GRID_STROKE }}
      minTickGap={24}
      height={20}
    />,
    <YAxis
      key="y"
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={false}
      width={44}
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
          ? { stroke: CURSOR_STROKE, strokeWidth: 1, strokeDasharray: "3 3" }
          : { fill: "var(--surface-raised)", fillOpacity: 0.75 }
      }
      // The tooltip must not lag the crosshair; it is a readout, not a card.
      isAnimationActive={false}
    />,
  ];

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
            <LineChart data={data.data} margin={CHART_MARGIN}>
              {axes}
              {data.seriesKeys.map((key, index) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={seriesColor(index)}
                  strokeWidth={2}
                  strokeOpacity={opacityFor(key)}
                  dot={<AlertDot />}
                  activeDot={{ r: 3.5, strokeWidth: 0 }}
                  isAnimationActive={!reducedMotion}
                  animationDuration={DATA_TWEEN_MS}
                  connectNulls
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data.data} margin={CHART_MARGIN} barCategoryGap="18%">
              {axes}
              {data.seriesKeys.map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={seriesColor(index)}
                  fillOpacity={opacityFor(key)}
                  isAnimationActive={!reducedMotion}
                  animationDuration={DATA_TWEEN_MS}
                  radius={[2, 2, 0, 0]}
                >
                  {/* Per-bar colour so a single anomalous bar can stand out. */}
                  {data.data.map((point, pointIndex) => (
                    <Cell
                      key={pointIndex}
                      fill={
                        point.__alert?.[key] === true ? ALERT_COLOR : seriesColor(index)
                      }
                    />
                  ))}
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
