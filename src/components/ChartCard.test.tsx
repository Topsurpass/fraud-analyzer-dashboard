import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PollResponse, SavedQueryRead } from "@/contracts/api";
import { EMPTY_FLAGS } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { ChartCard } from "./ChartCard";

const pollQuery = vi.hoisted(() => vi.fn());
const shapeCalls = vi.hoisted(() => vi.fn());
const cartesianInputs = vi.hoisted(() => vi.fn());

/*
 * The real shaping, counted. Shaping is the expensive half of a card at
 * 25,000 rows, and the property under test below is that it does not happen
 * again when the engine hands back the same data - which has no user-visible
 * proxy to assert on instead.
 */
vi.mock("@/services/charts/shape", async () => {
  const actual = await vi.importActual<typeof import("@/services/charts/shape")>(
    "@/services/charts/shape",
  );
  return {
    ...actual,
    buildNumber: (...args: Parameters<typeof actual.buildNumber>) => {
      shapeCalls();
      return actual.buildNumber(...args);
    },
    // Records what the card hands the chart builder, for the flags test.
    buildCartesian: (...args: Parameters<typeof actual.buildCartesian>) => {
      cartesianInputs(args[0]);
      return actual.buildCartesian(...args);
    },
  };
});

vi.mock("@/services/dashboards", () => ({
  useDashboards: () => ({ reload: vi.fn() }),
}));

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return {
    ...actual,
    pollQuery,
    // The coalescer batches, so a card's normal poll leaves as one
    // `POST /queries/poll`. These tests are about what the card renders, not
    // about the transport, so the batch is served here by the same
    // single-query fake. Batching itself is tested in coalesce.test.ts.
    batchPoll: (body: { queries: Array<{ query_id: string; since_hash?: string | null }> }) =>
      Promise.all(
        body.queries.map((entry) =>
          pollQuery(entry.query_id, { sinceHash: entry.since_hash ?? null }),
        ),
      ).then((results) => ({ results })),
  };
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

/**
 * Let a poll go out and come back.
 *
 * The wait covers the coalescer's batch window: a queued poll waits one frame
 * to see whether another card is ticking alongside it, so draining microtasks
 * is no longer enough to get an answer on screen. Sized well above that 16ms
 * rather than just over it - this suite shares a machine with a dev server and
 * an engine, and a wait tuned to an idle box is how a gate test turns flaky.
 */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await Promise.resolve();
  });
}

beforeEach(() => {
  pollQuery.mockReset();
  shapeCalls.mockReset();
  cartesianInputs.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ChartCard", () => {
  it("names the card from the chart it draws, not the query", async () => {
    // Four charts of one query all headed with the query's name are four cards
    // nobody can tell apart, which is most of the value of naming them.
    pollQuery.mockResolvedValue(changed("aaa", 20));
    render(<ChartCard query={query} />);
    await settle();

    expect(screen.getByRole("article", { name: "Count" })).toBeInTheDocument();
    // The query is still named underneath, so a card says where its data came
    // from once the heading stops saying so.
    expect(screen.getByText("Flagged in last hour")).toBeInTheDocument();
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
    expect(screen.getByText("1 row")).toBeInTheDocument();
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
    // 20ms covers the coalescer's batch window before the first poll leaves.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
    });
    expect(screen.getByText("changed")).toBeInTheDocument();

    // The next poll brings nothing new, so the label clears.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(screen.queryByText("changed")).not.toBeInTheDocument();
  });

  it("re-shapes when the data moves and not when the payload merely repeats", async () => {
    /*
     * A forced refresh - the retry button, a chart-type change - answers with
     * the whole result again under the same `data_hash`: a new object holding
     * identical rows. Keyed on the object, every one of those clicks re-shaped
     * 25,000 rows on every card of the board; keyed on the hash, the work
     * happens when the data moved and not otherwise.
     */
    vi.useFakeTimers();
    pollQuery
      .mockResolvedValueOnce(changed("aaa", 20))
      // Same hash, a different object each time, exactly as a forced refresh
      // or a cache-served answer arrives.
      .mockResolvedValueOnce(changed("aaa", 20))
      .mockResolvedValue(changed("bbb", 55));

    render(<ChartCard query={query} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
    });
    const afterFirst = shapeCalls.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    expect(screen.getByText("20")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(shapeCalls.mock.calls.length).toBe(afterFirst);
    expect(screen.getByText("20")).toBeInTheDocument();

    // A genuinely new hash still gets shaped, or the card would go stale.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(shapeCalls.mock.calls.length).toBeGreaterThan(afterFirst);
    // The hash readout, not the big number: that one counts up to its new
    // value over 500 real milliseconds, which fake timers never deliver.
    expect(screen.getByText("bbb")).toBeInTheDocument();
  });

  it("redraws when only the chart type changes, because the rows (and hash) do not", async () => {
    /*
     * Picking a new chart type re-runs the query and gets back the same rows,
     * so the same `data_hash`, under a different `charts` mapping. The card
     * used to key its re-shape on the hash alone and dropped that answer, so
     * the old type stayed on screen until a full reload.
     */
    vi.useFakeTimers();
    const asTable = (): PollResponse => {
      const payload = changed("aaa", 20);
      if (!("charts" in payload)) throw new Error("fixture must be a full payload");
      return { ...payload, charts: [{ ...payload.charts[0], type: "table" }] };
    };
    pollQuery.mockResolvedValueOnce(changed("aaa", 20)).mockResolvedValue(asTable());

    render(<ChartCard query={query} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
    });
    // Drawn as a number readout: no table yet.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("hands the flag outcome to the chart and names the matched rules on the card", async () => {
    /*
     * The card shaped its rows without the run's `flags`, so no chart could
     * mark or name a single flagged point whatever the rules were. The table is
     * the easiest place to see it: a flagged row says which rule caught it.
     */
    vi.useFakeTimers();
    pollQuery.mockResolvedValue({
      ...changed("aaa", 20),
      columns: ["id", "amount"],
      rows: [[1, 10], [2, 900]],
      row_count: 2,
      charts: [
        {
          id: "chart-1",
          name: "Transfers",
          type: "bar",
          x_field: "id",
          y_field: "amount",
          series_field: null,
          warnings: [],
        },
      ],
      flags: {
        flagged_count: 1,
        rows: [{ index: 1, rule_ids: ["r1"] }],
        rules: [{ id: "r1", name: "Big transfer", severity: "high", matched: 1 }],
        warnings: [],
        dismissed_count: 0,
      },
    } as PollResponse);

    render(<ChartCard query={query} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
    });

    // The rule is named on the card, with its count and severity in words.
    const strip = screen.getByRole("list", { name: "Flag rules that matched" });
    expect(strip).toHaveTextContent("Big transfer");
    expect(strip).toHaveTextContent("high severity");
    // And the chart builder itself was given the flags, which is what lets it
    // mark the column and name the rule on the point.
    const input = cartesianInputs.mock.calls[0][0];
    expect(input.flags.rules[0].name).toBe("Big transfer");
    expect(input.flags.rows).toEqual([{ index: 1, rule_ids: ["r1"] }]);
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
    // 20ms covers the coalescer's batch window before the first poll leaves.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(20);
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
