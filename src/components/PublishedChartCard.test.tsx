import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pollPublishedChart = vi.hoisted(() => vi.fn());
const pollQuery = vi.hoisted(() => vi.fn());
const batchPoll = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => ({
  ...(await vi.importActual<typeof import("@/services/api-client")>("@/services/api-client")),
  pollPublishedChart,
  pollQuery,
  batchPoll,
}));

import { ChartCard } from "@/components/ChartCard";
import { resetCoalesced } from "@/services/polling/coalesce";
import type { SavedQueryRead } from "@/contracts/api";

const payload = {
  query_id: "q1",
  executed_at: "2026-09-01T13:30:49Z",
  duration_ms: 10,
  row_count: 1,
  truncated: false,
  data_hash: "sha256:abc",
  columns: ["sum_failed"],
  rows: [["47832210.96"]],
  charts: [
    {
      id: "c1",
      name: "Total failed amount",
      type: "table" as const,
      x_field: null,
      y_field: null,
      series_field: null,
      warnings: [],
    },
  ],
  flags: { flagged_count: 0, rows: [], rules: [], warnings: [] },
  poll_interval_ms: 600000,
  changed: true,
  from_cache: true,
};

function renderPublished() {
  resetCoalesced();
  pollPublishedChart.mockReset().mockResolvedValue(payload);
  pollQuery.mockReset().mockResolvedValue(payload);
  batchPoll.mockReset().mockResolvedValue({ results: [payload] });

  render(
    <ChartCard
      published
      chartId="c1"
      title="Total failed amount"
      query={
        {
          id: "q1",
          name: "Total failed amount",
          charts: [],
          poll_interval_ms: null,
        } as unknown as SavedQueryRead
      }
    />,
  );
}

/**
 * A published card polls a different endpoint, and must not be batched.
 *
 * This is the regression the feature shipped with: `useQueryPolling` chose the
 * published fetcher correctly, but the coalescer batched every poll into
 * `POST /queries/poll`, which is query-scoped and owner-only. A viewer's chart
 * id went to the wrong endpoint as if it were a query id they owned, the batch
 * answered not-found, and the card showed a skeleton forever.
 */
describe("a published chart card", () => {
  it("renders its rows rather than loading forever", async () => {
    renderPublished();

    await waitFor(() => expect(screen.getByText("47832210.96")).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it("asks the published endpoint, not the owner-only one", async () => {
    renderPublished();

    await waitFor(() => expect(pollPublishedChart).toHaveBeenCalled(), { timeout: 3000 });
    expect(pollQuery).not.toHaveBeenCalled();
  });

  it("never joins the batch, which is owner-only and query-scoped", async () => {
    // The batch endpoint would be handed a chart id in a query_id field, by a
    // viewer who owns neither. It cannot answer, and nothing else in the card
    // would notice.
    renderPublished();

    await waitFor(() => expect(pollPublishedChart).toHaveBeenCalled(), { timeout: 3000 });
    expect(batchPoll).not.toHaveBeenCalled();
  });
});
