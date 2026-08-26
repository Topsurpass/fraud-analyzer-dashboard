import type { ChartType } from "@/contracts/api";

/**
 * Loading placeholders shaped like the chart that is coming.
 *
 * A generic spinner tells the analyst nothing; a placeholder in the shape of the
 * real chart means the card does not change size or layout when data lands, so
 * the grid never jumps.
 */
export function ChartSkeleton({ type }: { type: ChartType }) {
  switch (type) {
    case "number":
      return (
        <div className="skeleton-sweep flex h-full flex-col justify-center px-4 py-2">
          <div className="h-10 w-2/3 bg-line" />
          <div className="mt-3 h-2 w-1/3 bg-line/60" />
        </div>
      );

    case "bar":
      return <BarSkeleton />;

    case "compare":
      // Two strokes, the second offset, so the skeleton already reads as a
      // comparison rather than resolving from one line into two.
      return (
        <div className="skeleton-sweep h-full px-3 py-3">
          <div className="h-1.5 w-full bg-line/50" />
          <div className="mt-6 h-1.5 w-[85%] bg-line" />
        </div>
      );

    case "movers":
      return (
        <div className="skeleton-sweep h-full space-y-2 px-3 py-3">
          {[0.9, 0.7, 0.55, 0.4, 0.3, 0.22].map((width, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="h-2 w-10 bg-line/50" />
              <div className="h-[2px] bg-line" style={{ width: `${width * 100}%` }} />
            </div>
          ))}
        </div>
      );

    case "compare_grid":
      return (
        <div className="skeleton-sweep grid h-full grid-cols-3 gap-1.5 px-3 py-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="space-y-1 border border-line/60 p-1.5">
              <div className="h-1.5 w-2/3 bg-line/60" />
              <div className="h-5 bg-line/30" />
            </div>
          ))}
        </div>
      );

    case "heatmap":
      return (
        <div className="skeleton-sweep grid h-full grid-cols-8 gap-[2px] px-3 py-3">
          {Array.from({ length: 40 }, (_, index) => (
            <div key={index} className="bg-line/50" />
          ))}
        </div>
      );

    case "pie":
      return (
        <div className="skeleton-sweep flex h-full items-center justify-center">
          <div className="aspect-square h-[72%] rounded-full border-[14px] border-line" />
        </div>
      );

    case "table":
      return (
        <div className="skeleton-sweep h-full space-y-2 px-3 py-3">
          <div className="h-2 w-full bg-line" />
          {[0.92, 0.78, 0.86, 0.7, 0.82, 0.64].map((width, index) => (
            <div key={index} className="h-2 bg-line/50" style={{ width: `${width * 100}%` }} />
          ))}
        </div>
      );

    case "line":
    default:
      return <LineSkeleton />;
  }
}

/** A few flat bars of varying height, matching the real bar chart's geometry. */
function BarSkeleton() {
  const heights = [46, 72, 58, 84, 40, 66, 52, 78];
  return (
    <div className="skeleton-sweep flex h-full items-end gap-[6%] px-4 pt-4 pb-6">
      {heights.map((height, index) => (
        <div key={index} className="flex-1 bg-line" style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}

/** A smooth resting curve, not a jagged one: the placeholder must not read as data. */
function LineSkeleton() {
  return (
    <div className="skeleton-sweep h-full px-4 pt-4 pb-6">
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
      >
        <path
          d="M0,30 C15,26 22,14 34,16 C46,18 52,30 64,28 C76,26 84,12 100,15"
          fill="none"
          stroke="var(--border)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
