import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/api-client")>()),
  getPublishedCharts: vi.fn(),
}));

vi.mock("@/components/ChartCard", () => ({
  // The card's own rendering is covered by its own tests. What matters here is
  // that this page hands it the published flag, without which the card would
  // poll an endpoint the viewer cannot reach.
  ChartCard: ({ title, published }: { title?: string; published?: boolean }) => (
    <div data-testid="card" data-published={String(published)}>
      {title}
    </div>
  ),
}));

import { getPublishedCharts } from "@/services/api-client";
import PublishedPage from "./page";

const chart = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  query_id: "q1",
  name: "Terminal movers",
  position: 0,
  chart_type: "table" as const,
  x_field: null,
  y_field: null,
  series_field: null,
  surge_threshold_pct: null,
  is_public: true,
  published_by: "u1",
  published_at: "2026-08-28T09:00:00",
  created_at: "2026-08-28T09:00:00",
  updated_at: "2026-08-28T09:00:00",
  ...over,
});

describe("PublishedPage", () => {
  beforeEach(() => vi.mocked(getPublishedCharts).mockReset());

  it("shows a card for every published chart", async () => {
    vi.mocked(getPublishedCharts).mockResolvedValue([
      chart(),
      chart({ id: "c2", name: "Hourly volume" }),
    ]);

    render(<PublishedPage />);

    await waitFor(() => expect(screen.getAllByTestId("card")).toHaveLength(2));
    expect(screen.getByText("Terminal movers")).toBeInTheDocument();
  });

  it("renders each card in published mode", async () => {
    // The whole reason this page exists: a viewer does not own these queries,
    // so the card must poll the ownership-ignoring path. Without this flag it
    // polls the owner-only endpoint and renders an empty card.
    vi.mocked(getPublishedCharts).mockResolvedValue([chart()]);

    render(<PublishedPage />);

    await waitFor(() =>
      expect(screen.getByTestId("card")).toHaveAttribute("data-published", "true"),
    );
  });

  it("says plainly when nothing has been published", async () => {
    vi.mocked(getPublishedCharts).mockResolvedValue([]);

    render(<PublishedPage />);

    await waitFor(() => expect(screen.getByText("Nothing published yet")).toBeInTheDocument());
    // An empty board that does not say how to fill it is a dead end.
    expect(screen.getByText(/card menu/i)).toBeInTheDocument();
  });
});
