import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PollResponse, SavedQueryRead } from "@/contracts/api";
import { EMPTY_FLAGS } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { ChartCard } from "./ChartCard";

const pollQuery = vi.hoisted(() => vi.fn());

vi.mock("@/services/dashboards", () => ({
  useDashboards: () => ({ reload: vi.fn() }),
}));

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return { ...actual, pollQuery };
});

const query: SavedQueryRead = {
  id: "q1",
  connection_id: "c1",
  name: "Flagged in last hour",
  description: "Live count of flagged transactions.",
  sql_text: "SELECT 1",
  table_hint: null,
  row_limit: 1000,
  charts: [],
  poll_interval_ms: 3000,
  created_at: "2026-08-22T12:00:00",
  updated_at: "2026-08-22T12:00:00",
};

function changed(hash: string, value: number): PollResponse {
  return {
    query_id: "q1",
    executed_at: "2026-08-22T12:00:00",
    duration_ms: 12,
    row_count: 1,
    truncated: false,
    data_hash: `sha256:${hash}`,
    columns: ["flagged"],
    rows: [[value]],
    charts: [
      {
        id: "chart-1",
        name: "Count",
        type: "number",
        x_field: null,
        y_field: "flagged",
        series_field: null,
        warnings: [],
      },
    ],
    flags: EMPTY_FLAGS,
    poll_interval_ms: 3000,
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  pollQuery.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ChartCard", () => {
  it("names the card from the query, so the grid is navigable", async () => {
    pollQuery.mockResolvedValue(changed("aaa", 20));
    render(<ChartCard query={query} />);
    await settle();

    expect(
      screen.getByRole("article", { name: "Flagged in last hour" }),
    ).toBeInTheDocument();
  });

  it("shows a shaped skeleton before any data arrives", async () => {
    pollQuery.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<ChartCard query={query} />);

    expect(container.querySelector(".skeleton-sweep")).not.toBeNull();
    expect(screen.getByText("-- rows")).toBeInTheDocument();
  });

  it("renders the value and the engine's own readout once a poll lands", async () => {
    pollQuery.mockResolvedValue(changed("aaa", 20));
    render(<ChartCard query={query} />);
    await settle();

    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("1 rows")).toBeInTheDocument();
    expect(screen.getByText("12ms")).toBeInTheDocument();
    // The hash is shown without its algorithm prefix.
    expect(screen.getByText("aaa")).toBeInTheDocument();
  });

  it("labels a change in words, not colour alone", async () => {
    vi.useFakeTimers();
    pollQuery
      .mockResolvedValueOnce(changed("aaa", 20))
      .mockResolvedValueOnce({
        query_id: "q1",
        changed: false,
        data_hash: "sha256:aaa",
        flags: EMPTY_FLAGS,
  poll_interval_ms: 3000,
        from_cache: true,
      } as PollResponse);

    render(<ChartCard query={query} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("changed")).toBeInTheDocument();

    // The next poll brings nothing new, so the label clears.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByText("changed")).not.toBeInTheDocument();
  });

  it("never fails silently: a first-poll failure shows the reason and a retry", async () => {
    pollQuery.mockRejectedValue(
      new ApiError({ kind: "timeout", message: "Timed out", url: "/x" }),
    );
    render(<ChartCard query={query} />);
    await settle();

    expect(screen.getByText("Request timed out")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("retrying re-polls and recovers the card", async () => {
    const user = userEvent.setup();
    pollQuery
      .mockRejectedValueOnce(new ApiError({ kind: "network", message: "down", url: "/x" }))
      .mockResolvedValue(changed("bbb", 7));

    render(<ChartCard query={query} />);
    await settle();
    expect(screen.getByText("Cannot reach engine")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await settle();

    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("keeps showing the last good data when a later poll fails, marked stale", async () => {
    vi.useFakeTimers();
    pollQuery
      .mockResolvedValueOnce(changed("aaa", 20))
      .mockRejectedValue(new ApiError({ kind: "timeout", message: "Timed out", url: "/x" }));

    render(<ChartCard query={query} />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // The figure survives, and the card says it is no longer fresh.
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText(/Stale/)).toHaveTextContent("Request timed out");
  });

  it("surfaces the engine's chart warnings rather than hiding a guessed axis", async () => {
    pollQuery.mockResolvedValue({
      ...changed("aaa", 20),
      charts: [
        {
          id: "chart-1",
          name: "Count",
          type: "number",
          x_field: null,
          y_field: "flagged",
          series_field: null,
          warnings: ['value axis defaulted to "flagged"'],
        },
      ],
    } as PollResponse);

    render(<ChartCard query={query} />);
    await settle();

    expect(screen.getByText('value axis defaulted to "flagged"')).toBeInTheDocument();
  });

  it("does not poll when disabled", async () => {
    pollQuery.mockResolvedValue(changed("aaa", 20));
    render(<ChartCard query={query} enabled={false} />);
    await settle();

    expect(pollQuery).not.toHaveBeenCalled();
    expect(screen.getByText("paused")).toBeInTheDocument();
  });
});
