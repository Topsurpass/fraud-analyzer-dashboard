import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryChart, SavedQueryRead } from "@/contracts/api";
import { ChartCard } from "./ChartCard";

/**
 * What a card shows depends on whose it is. These pin the wiring that decides it:
 * which menu a card gets, where its flagged badge links, and what it says about
 * publication. The poll and the flagged summary are faked, because none of them is
 * under test and a real poll would only add timing.
 */

const flaggedFor = vi.hoisted(() => ({
  count: 0,
  connection: null as string | null,
}));

vi.mock("@/services/flagged/FlaggedContext", () => ({
  useFlagged: () => ({
    total: 0,
    connections: [],
    newestAt: null,
    countForConnection: () => 0,
    severityForConnection: () => null,
    countForQuery: () => flaggedFor.count,
    severityForQuery: () => (flaggedFor.count > 0 ? "high" : null),
    connectionForQuery: () => flaggedFor.connection,
    loading: false,
    error: null,
    reload: () => {},
  }),
}));

vi.mock("@/services/polling/useQueryPolling", () => ({
  useQueryPolling: () => ({
    phase: "loading",
    snapshot: null,
    dataHash: null,
    changeSeq: 0,
    pollSeq: 0,
    lastPolledAt: null,
    lastChangedAt: null,
    executedAt: null,
    nextPollAt: null,
    pollIntervalMs: 5000,
    error: null,
    consecutiveErrors: 0,
    fromCache: false,
    inFlight: false,
    refresh: () => {},
    resync: () => {},
  }),
}));

vi.mock("@/services/dashboards", () => ({ useDashboards: () => ({ reload: () => {} }) }));

const chart = (over: Partial<QueryChart> = {}): QueryChart => ({
  id: "ch1",
  query_id: "q1",
  name: "Declines",
  position: 0,
  chart_type: "bar",
  x_field: "bank",
  y_field: "failed",
  series_field: null,
  surge_threshold_pct: null,
  is_public: false,
  published_by: null,
  published_at: null,
  publish_status: "private",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  ...over,
});

const ownQuery = (c: QueryChart): SavedQueryRead => ({
  id: "q1",
  connection_id: "c-own",
  name: "Declines by bank",
  description: null,
  sql_text: "SELECT 1",
  table_hint: null,
  row_limit: 1000,
  charts: [c],
  poll_interval_ms: 5000,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
});

/** What the dashboard page builds for somebody else's published chart. */
const sharedQuery = (c: QueryChart) =>
  ({ id: c.query_id, name: c.name, charts: [c], poll_interval_ms: null }) as unknown as SavedQueryRead;

beforeEach(() => {
  flaggedFor.count = 0;
  flaggedFor.connection = null;
});

describe("a published chart seen by somebody else", () => {
  const published = chart({ is_public: true, publish_status: "published" });

  it("links its flagged badge to the connection the summary names, not to /connections/undefined", () => {
    flaggedFor.count = 4;
    flaggedFor.connection = "c9";
    render(<ChartCard published chartId="ch1" title="Declines" query={sharedQuery(published)} />);

    const link = screen.getByRole("link", { name: "Review 4 flagged rows from Declines" });
    expect(link).toHaveAttribute("href", "/connections/c9/flagged");
  });

  it("shows the badge without a dead link when no connection is known", () => {
    flaggedFor.count = 4;
    render(<ChartCard published chartId="ch1" title="Declines" query={sharedQuery(published)} />);

    expect(screen.queryByRole("link", { name: /Review/ })).not.toBeInTheDocument();
    for (const link of screen.queryAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").not.toContain("undefined");
    }
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("has the viewer's menu, which cannot change anything", () => {
    render(<ChartCard published chartId="ch1" title="Declines" query={sharedQuery(published)} />);

    expect(screen.getByLabelText("Chart options for Declines")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Actions for/)).not.toBeInTheDocument();
  });

  it("does not show a rejection note, even if a stale one is attached", () => {
    const stale = chart({
      publish_rejection: { reason: "Old", rejected_at: "2026-10-01T10:00:00Z", rejected_by_name: "Ada" },
    });
    render(<ChartCard published chartId="ch1" title="Declines" query={sharedQuery(stale)} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("your own chart", () => {
  it("keeps the full menu", () => {
    render(<ChartCard chartId="ch1" query={ownQuery(chart())} />);
    expect(screen.getByLabelText("Actions for Declines by bank")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Chart options for/)).not.toBeInTheDocument();
  });

  it("links its flagged badge to its own connection first", () => {
    flaggedFor.count = 2;
    flaggedFor.connection = "c-from-summary";
    render(<ChartCard chartId="ch1" query={ownQuery(chart())} />);
    expect(screen.getByRole("link", { name: /Review 2 flagged rows/ })).toHaveAttribute(
      "href",
      "/connections/c-own/flagged",
    );
  });

  it("says a request is waiting", () => {
    render(<ChartCard chartId="ch1" query={ownQuery(chart({ publish_status: "pending" }))} />);
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
  });

  it("tells the author why a request was declined", () => {
    render(
      <ChartCard
        chartId="ch1"
        query={ownQuery(
          chart({
            publish_rejection: {
              reason: "Remove the card number column",
              rejected_at: "2026-10-01T10:00:00Z",
              rejected_by_name: "Ada",
            },
          }),
        )}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Remove the card number column");
    expect(screen.getByText("Not approved")).toBeInTheDocument();
  });

  it("says nothing about publication on a private chart that was never asked about", () => {
    render(<ChartCard chartId="ch1" query={ownQuery(chart())} />);
    expect(screen.queryByText("Awaiting approval")).not.toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
