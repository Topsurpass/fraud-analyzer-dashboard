/**
 * A result set with no rows.
 *
 * Without this a line or bar chart renders its axes and nothing else, which
 * reads as a broken card rather than a true one. The design brief is explicit
 * that an analyst should never have to wonder whether a chart is stale or
 * broken, and "the query ran fine and matched nothing" is a distinct, common,
 * and entirely legitimate answer - a time-windowed query outside its window
 * says exactly this.
 */
export function ChartEmpty({ label = "No rows in range" }: { label?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      {/*
       * An empty pair of axes rather than a rule. A blank card and a card whose
       * query matched nothing look identical otherwise, and this is the shape
       * the card would have had with data in it - so the card still reads as a
       * chart, just an empty one.
       */}
      <svg width={72} height={44} viewBox="0 0 72 44" aria-hidden="true" className="text-line-strong">
        <path d="M3 2 V41 H69" fill="none" stroke="currentColor" strokeWidth={1} />
        <path
          d="M3 32 H69 M3 22 H69 M3 12 H69"
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 5"
          opacity={0.45}
        />
      </svg>
      <div>
        <p className="text-[12px] text-muted">{label}</p>
        <p className="mt-0.5 text-[10px] text-muted/70">The query ran and matched nothing.</p>
      </div>
    </div>
  );
}
