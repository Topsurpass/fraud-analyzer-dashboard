/**
 * What one board of 25,000-row cards costs the browser once the JSON has landed.
 *
 * Run it: `npm run bench` (writes a markdown table under /tmp and prints it).
 * `BENCH_LABEL=before npm run bench` names the file, so a before/after pair can
 * sit side by side.
 *
 * Every number is the median of N timed runs after two warm-ups. Median rather
 * than mean because one GC pause in seven runs should not move the table, and
 * warm-ups because a cold V8 measurement is a measurement of the compiler.
 *
 * This is a measurement, not a gate. Wall-clock assertions belong nowhere near
 * the commit hook (see `downsample.test.ts` for what a machine-load-proof
 * complexity assertion looks like instead); the correctness properties this
 * benchmark motivated are asserted in `src/services/charts/*.test.ts`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { describe, it } from "vitest";

import type { ChartSpec, FlagOutcome } from "@/contracts/api";
import { detectRowAnomalies } from "@/services/anomaly";
import {
  buildCartesian,
  buildCompare,
  buildCompareGrid,
  buildHeatmap,
  buildMovers,
  buildNumber,
  buildPie,
  buildTable,
  resolveFields,
} from "@/services/charts/shape";
import { bucketSurges, changeLabel, judgeChange } from "@/services/charts/severity";
import { CartesianChartView } from "@/components/charts/CartesianChartView";
import { CompareChartView } from "@/components/charts/CompareChartView";
import { CompareGridView } from "@/components/charts/CompareGridView";
import { HeatmapView } from "@/components/charts/HeatmapView";
import { MoversView } from "@/components/charts/MoversView";
import { NumberCardView } from "@/components/charts/NumberCardView";
import { PieChartView } from "@/components/charts/PieChartView";
import { TableView } from "@/components/charts/TableView";

import { COLUMNS, ROW_COUNT, makeFlags, makeRows, makeRunResponse, makeSpec } from "./payload";

interface Timing {
  group: string;
  label: string;
  ms: number;
  note: string;
}

const timings: Timing[] = [];

function record(group: string, label: string, ms: number, note = ""): void {
  timings.push({ group, label, ms, note });
}

/** Median of `runs` timed calls, after two untimed warm-ups. */
function measure(
  group: string,
  label: string,
  fn: () => unknown,
  { runs = 7, note = "" }: { runs?: number; note?: string } = {},
): void {
  fn();
  fn();
  const samples: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    fn();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  record(group, label, samples[Math.floor(samples.length / 2)], note);
}

/**
 * The React commit, and only the React commit: the container, the root and the
 * unmount are all created outside the clock. `render` wraps in `act`, so effects
 * and the re-render recharts does once it has measured itself are inside the
 * number, which is what an analyst actually waits for.
 */
function measureRender(
  label: string,
  element: () => React.ReactElement,
  { runs = 5, note = "" }: { runs?: number; note?: string } = {},
): void {
  const samples: number[] = [];
  for (let run = 0; run < runs + 1; run += 1) {
    const node = element();
    const started = performance.now();
    render(node);
    const elapsed = performance.now() - started;
    cleanup();
    if (run > 0) samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  record("React render commit", label, samples[Math.floor(samples.length / 2)], note);
}

const rows = makeRows();
const flags = makeFlags();
const noFlags: FlagOutcome | null = null;
const serialized = JSON.stringify(makeRunResponse(rows, flags));

const result = (spec: ChartSpec, withFlags: FlagOutcome | null = noFlags) => ({
  columns: COLUMNS,
  rows,
  chart: spec,
  flags: withFlags,
});

const lineSpec = makeSpec("line");
const seriesSpec = makeSpec("bar", { series_field: "terminal_id" });
const tableSpec = makeSpec("table");
const compareSpec = makeSpec("compare");
const moversSpec = makeSpec("movers", { series_field: "terminal_id" });
const gridSpec = makeSpec("compare_grid", { series_field: "terminal_id" });
const heatSpec = makeSpec("heatmap", { series_field: "terminal_id" });
const pieSpec = makeSpec("pie", { x_field: "status" });
const numberSpec = makeSpec("number");

function markdown(): string {
  const groups = [...new Set(timings.map((entry) => entry.group))];
  const lines: string[] = [
    `# Client render cost at ${ROW_COUNT.toLocaleString("en-GB")} rows`,
    "",
    `label: ${process.env.BENCH_LABEL ?? "unlabelled"}`,
    `node: ${process.version}`,
    "",
  ];
  for (const group of groups) {
    lines.push(`## ${group}`, "", "| step | ms | note |", "| --- | ---: | --- |");
    for (const entry of timings.filter((candidate) => candidate.group === group)) {
      lines.push(`| ${entry.label} | ${entry.ms.toFixed(1)} | ${entry.note} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

describe(`client render cost at ${ROW_COUNT} rows`, () => {
  it("measures parse, shaping, severity and the React commit", () => {
    // ---- transport hand-off
    measure("JSON.parse", "full RunResponse", () => JSON.parse(serialized), {
      note: `${(serialized.length / 1_048_576).toFixed(1)} MB of JSON`,
    });

    // ---- the shared prelude every builder runs
    measure("Shaping", "resolveFields", () => resolveFields(result(lineSpec)));
    measure("Shaping", "detectRowAnomalies (no rules)", () =>
      detectRowAnomalies({ columns: COLUMNS, rows, valueColumn: "amount", flags: noFlags }),
    );
    measure("Shaping", "detectRowAnomalies (12 flagged)", () =>
      detectRowAnomalies({ columns: COLUMNS, rows, valueColumn: "amount", flags }),
    );

    // ---- the builders, one card each
    measure("Shaping", "buildCartesian (single series)", () => buildCartesian(result(lineSpec)));
    measure("Shaping", "buildCartesian (40 series)", () => buildCartesian(result(seriesSpec)));
    measure("Shaping", "buildTable", () => buildTable(result(tableSpec)));
    measure("Shaping", "buildPie", () => buildPie(result(pieSpec)));
    measure("Shaping", "buildNumber", () => buildNumber(result(numberSpec)));
    measure("Shaping", "buildCompare", () => buildCompare(result(compareSpec)));
    measure("Shaping", "buildMovers", () => buildMovers(result(moversSpec)));
    measure("Shaping", "buildCompareGrid", () => buildCompareGrid(result(gridSpec)));
    measure("Shaping", "buildHeatmap", () => buildHeatmap(result(heatSpec)));

    // ---- the whole board, the way it actually lands: one synchronous pass
    const board: (() => unknown)[] = [
      () => buildCartesian(result(lineSpec)),
      () => buildCartesian(result(seriesSpec)),
      () => buildTable(result(tableSpec)),
      () => buildCompare(result(compareSpec)),
      () => buildMovers(result(moversSpec)),
      () => buildCompareGrid(result(gridSpec)),
      () => buildHeatmap(result(heatSpec)),
      () => buildPie(result(pieSpec)),
      () => buildNumber(result(numberSpec)),
      () => buildTable(result(tableSpec)),
    ];
    measure(
      "Board",
      "10 cards shaped back to back",
      () => {
        for (const build of board) build();
      },
      { runs: 5, note: "one synchronous pass, no yielding" },
    );

    // ---- severity helpers
    const values = rows.map((row) => Number(row[4]));
    measure("Severity", "judgeChange x 25,000", () => {
      for (let index = 1; index < values.length; index += 1) {
        judgeChange(values[index - 1], values[index], 50);
      }
    });
    measure("Severity", "bucketSurges over 25,000", () => bucketSurges(values, 50));
    measure("Severity", "changeLabel x 25,000", () => {
      const verdict = judgeChange(100, 250, 50);
      for (let index = 0; index < values.length; index += 1) changeLabel(verdict);
    });

    // ---- React commits, on the shaped output of the builders above
    const cartesianSingle = buildCartesian(result(lineSpec, flags));
    const cartesianSeries = buildCartesian(result(seriesSpec, flags));
    const tableData = buildTable(result(tableSpec, flags));
    const pieData = buildPie(result(pieSpec, flags));
    const numberData = buildNumber(result(numberSpec));
    const compareData = buildCompare(result(compareSpec, flags));
    const moversData = buildMovers(result(moversSpec, flags));
    const gridData = buildCompareGrid(result(gridSpec, flags));
    const heatData = buildHeatmap(result(heatSpec, flags));

    measureRender(
      "CartesianChartView (line)",
      () => <CartesianChartView data={cartesianSingle} kind="line" title="Line" />,
      { note: `${cartesianSingle.data.length} points` },
    );
    measureRender(
      "CartesianChartView (bar, 40 series)",
      () => <CartesianChartView data={cartesianSeries} kind="bar" title="Bar" />,
      { note: `${cartesianSeries.data.length} points x ${cartesianSeries.seriesKeys.length}` },
    );
    measureRender("TableView", () => <TableView data={tableData} title="Table" />, {
      note: `${tableData.rows.length} rows, virtualised`,
    });
    measureRender("PieChartView", () => <PieChartView data={pieData} title="Pie" />, {
      note: `${pieData.slices.length} slices`,
    });
    measureRender("NumberCardView", () => <NumberCardView data={numberData} title="Number" />);
    measureRender(
      "CompareChartView",
      () => <CompareChartView data={compareData} title="Compare" />,
      { note: `${compareData.points.length} plotted buckets` },
    );
    measureRender("MoversView", () => <MoversView data={moversData} title="Movers" />, {
      note: `${moversData.rows.length} categories`,
    });
    measureRender(
      "CompareGridView",
      () => <CompareGridView data={gridData} title="Grid" chartId="bench" />,
      {
        note: `${gridData.panels.length} panels x ${gridData.panels[0]?.points.length ?? 0} points`,
      },
    );
    measureRender("HeatmapView", () => <HeatmapView data={heatData} title="Heatmap" />, {
      note: `${heatData.rows.length} x ${heatData.buckets.length} cells`,
    });

    const report = markdown();
    const out =
      process.env.BENCH_OUT ??
      `/tmp/scale-25k/bench-${process.env.BENCH_LABEL ?? "unlabelled"}.md`;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, report, "utf8");
    console.log(`\n${report}\nwritten to ${out}\n`);
  });
});
