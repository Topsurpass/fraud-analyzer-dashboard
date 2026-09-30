"use client";

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type TooltipProps } from "recharts";
import { mergeFlagMark, type FlagMark, type PieData, type PieSlice } from "@/services/charts/shape";
import { formatInteger, formatMetric } from "@/services/format";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { useAlertHatch } from "./AlertHatch";
import { ChartEmpty } from "./ChartEmpty";
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
  // The folded wedge stands for every category in the tail, so it is flagged by
  // every rule that flagged any of them.
  let foldedMark: FlagMark | undefined;
  for (const slice of tail) {
    if (slice.alert) foldedMark = mergeFlagMark(foldedMark, slice.rules, slice.severity);
  }

  return [
    ...head,
    {
      name: OTHER_LABEL,
      value: tail.reduce((sum, slice) => sum + slice.value, 0),
      alert: tail.some((slice) => slice.alert),
      rules: foldedMark?.rules ?? [],
      severity: foldedMark?.severity ?? null,
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

  // One hatch pattern per wedge colour actually on this chart.
  const hatch = useAlertHatch(slices.map((slice) => slice.color));

  // An empty donut is just a ring of nothing; say so instead.
  const empty = slices.length === 0 || total <= 0;


  const renderTooltip = ({ active: hovering, payload }: TooltipProps<number, string>) => {
    if (!hovering || !payload?.length) return null;
    const slice = payload[0].payload as FoldedSlice;
    const share = total > 0 ? (slice.value / total) * 100 : 0;

    return (
      <ChartTooltip
        label={slice.name}
        entries={[
          {
            name: "count",
            value: slice.value,
            color: slice.color,
            alert: slice.alert,
            flag: slice.alert ? { rules: slice.rules, severity: slice.severity } : undefined,
          },
        ]}
        footer={
          <span className="tnum text-[13px] text-muted">
            {share.toFixed(1)}% of {formatInteger(total)}
            {slice.folded > 1 ? ` · ${slice.folded} categories` : ""}
          </span>
        }
      />
    );
  };

  if (empty) return <ChartEmpty />;

  return (
    <div className="flex h-full flex-col">
      <div
        className="relative min-h-0 flex-1 px-3 pt-1"
        role="img"
        aria-label={`${title}: composition across ${data.slices.length} categories, total ${formatInteger(total)}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {hatch.defs}
            <Tooltip content={renderTooltip} isAnimationActive={false} />
            <Pie
              /*
               * Recharts makes the pie's root group focusable by default, but
               * that group carries no accessible name, so a keyboard user hits
               * a stop that announces nothing. The chart's name is on the
               * wrapper's role="img" above and the legend buttons below are the
               * real keyboard affordance, so the stop is removed. `tabIndex`
               * alone does not do it - the root group reads `rootTabIndex`.
               */
              rootTabIndex={-1}
              tabIndex={-1}
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="68%"
              outerRadius="92%"
              paddingAngle={3}
              cornerRadius={6}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={!reducedMotion}
              animationDuration={DATA_TWEEN_MS}
            >
              {/*
               * A flagged wedge keeps its own colour and takes the hatch plus
               * an alert outline. Repainting it solid alert used to leave three
               * of five wedges identically red, which destroyed the one thing a
               * composition chart is for: telling the categories apart.
               */}
              {slices.map((slice, index) => (
                <Cell
                  // Position, not name: two categories can share a label and
                  // React would collapse them into one cell.
                  key={index}
                  fill={hatch.fill(slice.color, slice.alert)}
                  stroke={slice.alert ? ALERT_COLOR : "none"}
                  strokeWidth={slice.alert ? 1.5 : 0}
                  fillOpacity={active === null || active === String(index) ? 1 : 0.25}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/* The total sits in the hole, where the eye lands first. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-[26px] leading-none font-semibold tracking-tight">
            {formatMetric(total)}
          </span>
          <span className="mt-1.5 text-[13px] text-muted">Total</span>
        </div>
      </div>

      <SeriesLegend
        // Identity is the slice's position, not its name. Names are data and
        // data repeats - two categories sharing a value, or one genuinely
        // called "Other" beside the folded bucket.
        series={slices.map((slice, index) => ({
          id: String(index),
          label: slice.name,
          color: slice.color,
          alert: slice.alert,
          // The share, because a legend that only names a wedge leaves a
          // sliver as unreadable as it is small.
          detail: total > 0 ? `${((slice.value / total) * 100).toFixed(slice.value / total < 0.1 ? 1 : 0)}%` : undefined,
        }))}
        active={active}
        onActiveChange={setActive}
      />
    </div>
  );
}
