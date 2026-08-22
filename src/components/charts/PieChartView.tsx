"use client";

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type TooltipProps } from "recharts";
import type { PieData, PieSlice } from "@/services/charts/shape";
import { formatInteger, formatMetric } from "@/services/format";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { ChartTooltip } from "./ChartTooltip";
import { SeriesLegend } from "./SeriesLegend";
import { ALERT_COLOR, DATA_TWEEN_MS, MAX_SERIES, OTHER_COLOR, OTHER_LABEL, seriesColor } from "./theme";

/**
 * Composition as a donut rather than a filled pie, so the total can live in the
 * middle where an analyst looks first.
 *
 * The palette holds five distinguishable hues; a result set with more categories
 * than that folds its tail into one "Other" wedge rather than cycling colours,
 * which would put two identically-coloured wedges on the same chart.
 */

interface FoldedSlice extends PieSlice {
  color: string;
  /** How many original categories this wedge represents. */
  folded: number;
}

function foldSlices(slices: PieSlice[]): FoldedSlice[] {
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  if (sorted.length <= MAX_SERIES) {
    return sorted.map((slice, index) => ({
      ...slice,
      color: seriesColor(index),
      folded: 1,
    }));
  }

  const head = sorted.slice(0, MAX_SERIES - 1).map((slice, index) => ({
    ...slice,
    color: seriesColor(index),
    folded: 1,
  }));
  const tail = sorted.slice(MAX_SERIES - 1);

  return [
    ...head,
    {
      name: OTHER_LABEL,
      value: tail.reduce((sum, slice) => sum + slice.value, 0),
      alert: tail.some((slice) => slice.alert),
      color: OTHER_COLOR,
      folded: tail.length,
    },
  ];
}

export interface PieChartViewProps {
  data: PieData;
  title: string;
}

export function PieChartView({ data, title }: PieChartViewProps) {
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState<string | null>(null);

  const slices = useMemo(() => foldSlices(data.slices), [data.slices]);
  const total = data.total;


  const renderTooltip = ({ active: hovering, payload }: TooltipProps<number, string>) => {
    if (!hovering || !payload?.length) return null;
    const slice = payload[0].payload as FoldedSlice;
    const share = total > 0 ? (slice.value / total) * 100 : 0;

    return (
      <ChartTooltip
        label={slice.name}
        entries={[
          { name: "count", value: slice.value, color: slice.color, alert: slice.alert },
        ]}
        footer={
          <span className="tnum text-[11px] text-muted">
            {share.toFixed(1)}% of {formatInteger(total)}
            {slice.folded > 1 ? ` · ${slice.folded} categories` : ""}
          </span>
        }
      />
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div
        className="relative min-h-0 flex-1"
        role="img"
        aria-label={`${title}: composition across ${data.slices.length} categories, total ${formatInteger(total)}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={renderTooltip} isAnimationActive={false} />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="58%"
              outerRadius="86%"
              paddingAngle={1.5}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={!reducedMotion}
              animationDuration={DATA_TWEEN_MS}
            >
              {slices.map((slice) => (
                <Cell
                  key={slice.name}
                  fill={slice.alert ? ALERT_COLOR : slice.color}
                  fillOpacity={active === null || active === slice.name ? 1 : 0.25}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/* The total sits in the hole, where the eye lands first. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-2xl leading-none">{formatMetric(total)}</span>
          <span className="mt-1 text-[10px] tracking-wide text-muted uppercase">total</span>
        </div>
      </div>

      <SeriesLegend
        series={slices.map((slice) => ({
          key: slice.name,
          color: slice.alert ? "var(--signal-alert)" : slice.color,
        }))}
        active={active}
        onActiveChange={setActive}
      />
    </div>
  );
}
