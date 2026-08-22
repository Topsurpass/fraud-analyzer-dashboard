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
    <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
      <span aria-hidden="true" className="block h-px w-8 bg-line-strong" />
      <p className="text-[12px] text-muted">{label}</p>
      <p className="text-[10px] text-muted/70">The query ran and matched nothing.</p>
    </div>
  );
}
