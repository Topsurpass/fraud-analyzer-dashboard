"use client";

import type { QueryChart, SavedQueryRead } from "@/contracts/api";
import { getPublishedCharts } from "@/services/api-client";
import { useResource } from "@/lib/useResource";
import { ChartCard } from "@/components/ChartCard";
import { PageBody } from "@/components/PageBody";
import { EmptyState, ErrorState } from "@/components/ui";

/**
 * Every chart anybody has shared with the team.
 *
 * This is the one board that ignores ownership. Everything else in the app
 * shows an analyst only their own work, which is what makes private-by-default
 * usable; publishing is the deliberate way out of that, and this page is where
 * the way out leads. Without it, publishing a chart would be a button that
 * changes a flag nobody can observe.
 *
 * Cards here are read-only. A viewer has no rights over somebody else's chart,
 * so the action menu is hidden rather than shown-and-refused: a menu whose
 * every item returns an error is worse than no menu at all.
 */
export default function PublishedPage() {
  /*
   * useResource rather than a hand-rolled effect: it already handles the
   * cancellation, the error mapping and the reload that every other page in
   * this app gets, and setting state directly inside an effect is the
   * cascading-render pattern the lint rule exists to stop.
   */
  const { data: charts, error, reload } = useResource<QueryChart[]>(
    (signal) => getPublishedCharts({ signal }),
  );

  return (
    <PageBody crumbs={[{ label: "Published" }]}>
      {error ? (
        <ErrorState title="Could not load published charts" message={error.displayMessage} onRetry={reload} />
      ) : charts === null ? (
        <p className="t-sub">Loading published charts…</p>
      ) : charts.length === 0 ? (
        <EmptyState
          title="Nothing published yet"
          body="Publish a chart from its card menu and it appears here for everyone signed in."
        />
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(22rem,1fr))]">
          {charts.map((chart) => (
            <ChartCard
              key={chart.id}
              published
              chartId={chart.id}
              title={chart.name}
              /*
               * A viewer cannot fetch the query behind somebody else's chart,
               * and does not need to: the published poll returns the rows, the
               * columns and this one chart's mapping. What the card still wants
               * is a name and a polling cadence, so this carries exactly that
               * and nothing invented. The id is the query's real id, which is
               * unused in published mode but kept honest rather than faked.
               */
              query={
                {
                  id: chart.query_id,
                  name: chart.name,
                  charts: [chart],
                  poll_interval_ms: null,
                } as unknown as SavedQueryRead
              }
            />
          ))}
        </div>
      )}
    </PageBody>
  );
}
