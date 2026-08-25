import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedQueryRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { CardMenu } from "./CardMenu";

const getQueryCharts = vi.hoisted(() => vi.fn());
const putQueryCharts = vi.hoisted(() => vi.fn());
const deleteQuery = vi.hoisted(() => vi.fn());
const runQuery = vi.hoisted(() => vi.fn());

vi.mock("@/services/dashboards", () => ({
  // The menu only asks dashboards to refetch after a delete; the engine
  // cascades the membership change itself.
  useDashboards: () => ({ reload: vi.fn() }),
}));

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return { ...actual, getQueryCharts, putQueryCharts, deleteQuery, runQuery };
});

const query: SavedQueryRead = {
  id: "q1",
  connection_id: "c1",
  name: "Declines by country",
  description: null,
  sql_text: "SELECT 1",
  table_hint: null,
  row_limit: 1000,
  charts: [],
  poll_interval_ms: 5000,
  created_at: "2026-08-22T12:00:00",
  updated_at: "2026-08-22T12:00:00",
};

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  // `<summary>` has no button role, so it is reached by its label.
  await user.click(screen.getByLabelText("Actions for Declines by country"));
}

beforeEach(() => {
  // Chart type is a property of the chart now, so switching it is a
  // read-modify-write of the query's chart set rather than a query update.
  getQueryCharts.mockReset().mockResolvedValue({
    query_id: "q1",
    charts: [
      {
        id: "chart-1",
        query_id: "q1",
        name: "Chart",
        position: 0,
        chart_type: "table",
        x_field: null,
        y_field: null,
        series_field: null,
        created_at: "2026-08-24T09:00:00Z",
        updated_at: "2026-08-24T09:00:00Z",
      },
    ],
  });
  putQueryCharts.mockReset().mockResolvedValue({ query_id: "q1", charts: [] });
  deleteQuery.mockReset().mockResolvedValue(undefined);
  runQuery.mockReset().mockResolvedValue({});
});

describe("CardMenu", () => {
  it("offers every chart type the engine supports", async () => {
    const user = userEvent.setup();
    render(<CardMenu query={query} chartId="chart-1" currentChartType="table" />);
    await openMenu(user);

    for (const label of ["Line", "Bar", "Pie", "Number", "Table"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("marks the current type with a glyph, not colour alone", async () => {
    const user = userEvent.setup();
    render(<CardMenu query={query} chartId="chart-1" currentChartType="bar" />);
    await openMenu(user);

    expect(screen.getByRole("button", { name: "Bar" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Line" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Bar" })).toHaveTextContent("•");
  });

  it("writes a chart-type change through to the engine", async () => {
    const user = userEvent.setup();
    const onMutated = vi.fn();
    render(<CardMenu query={query} chartId="chart-1" currentChartType="table" onMutated={onMutated} />);
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: "Pie" }));

    await waitFor(() => expect(putQueryCharts).toHaveBeenCalled());
    // Only the chart this card draws changes type; the rest of the set is sent
    // back untouched so their ids - and the dashboards placing them - survive.
    expect(putQueryCharts.mock.calls[0][1][0].chart_type).toBe("pie");
    await waitFor(() => expect(onMutated).toHaveBeenCalled());
  });

  it("does not call the engine when the chosen type is already active", async () => {
    const user = userEvent.setup();
    render(<CardMenu query={query} chartId="chart-1" currentChartType="bar" />);
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: "Bar" }));
    expect(putQueryCharts).not.toHaveBeenCalled();
  });

  it("reports a failed chart change instead of pretending it worked", async () => {
    const user = userEvent.setup();
    putQueryCharts.mockRejectedValue(
      new ApiError({ kind: "http", message: "Chart type is invalid", url: "/x", status: 422 }),
    );
    render(<CardMenu query={query} chartId="chart-1" currentChartType="table" />);
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: "Pie" }));
    expect(await screen.findByText("Chart type is invalid")).toBeInTheDocument();
  });

  it("runs the query on demand", async () => {
    const user = userEvent.setup();
    const onMutated = vi.fn();
    render(<CardMenu query={query} chartId="chart-1" currentChartType="table" onMutated={onMutated} />);
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(runQuery).toHaveBeenCalledWith("q1"));
    await waitFor(() => expect(onMutated).toHaveBeenCalled());
  });

  it("links to the full editor", async () => {
    const user = userEvent.setup();
    render(<CardMenu query={query} chartId="chart-1" currentChartType="table" />);
    await openMenu(user);

    expect(screen.getByRole("link", { name: "Edit query" })).toHaveAttribute(
      "href",
      "/queries/q1",
    );
  });

  it("requires a confirmation before deleting", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    render(<CardMenu query={query} onDeleted={onDeleted} />);
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: "Delete query" }));
    expect(deleteQuery).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(deleteQuery).toHaveBeenCalledWith("q1"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it("lets a confirmation be backed out of", async () => {
    const user = userEvent.setup();
    render(<CardMenu query={query} chartId="chart-1" currentChartType="table" />);
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: "Delete query" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Delete query" })).toBeInTheDocument();
    expect(deleteQuery).not.toHaveBeenCalled();
  });

  it("renders caller-supplied extra items", async () => {
    const user = userEvent.setup();
    render(<CardMenu query={query} extra={<button type="button">Remove from board</button>} />);
    await openMenu(user);

    expect(screen.getByRole("button", { name: "Remove from board" })).toBeInTheDocument();
  });

  describe("dismissing", () => {
    it("closes once the chart type has been written through", async () => {
      const user = userEvent.setup();
      render(<CardMenu query={query} chartId="chart-1" currentChartType="table" />);
      await openMenu(user);

      await user.click(screen.getByRole("button", { name: "Pie" }));

      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Pie" })).not.toBeInTheDocument(),
      );
      expect(putQueryCharts.mock.calls[0][1][0].chart_type).toBe("pie");
    });

    it("stays open when that write fails, because it holds the error", async () => {
      putQueryCharts.mockRejectedValue(
        new ApiError({ kind: "network", message: "down", url: "/queries/q1" }),
      );
      const user = userEvent.setup();
      render(<CardMenu query={query} chartId="chart-1" currentChartType="table" />);
      await openMenu(user);

      await user.click(screen.getByRole("button", { name: "Pie" }));

      expect(await screen.findByText("Cannot reach engine")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Pie" })).toBeInTheDocument();
    });

    it("closes when the page behind it is clicked", async () => {
      const user = userEvent.setup();
      render(
        <div>
          <p>the card behind the menu</p>
          <CardMenu query={query} chartId="chart-1" currentChartType="table" />
        </div>,
      );
      await openMenu(user);
      expect(screen.getByRole("button", { name: "Pie" })).toBeInTheDocument();

      await user.click(screen.getByText("the card behind the menu"));
      expect(screen.queryByRole("button", { name: "Pie" })).not.toBeInTheDocument();
    });

    it("keeps the delete confirmation on screen rather than closing on it", async () => {
      const user = userEvent.setup();
      render(<CardMenu query={query} chartId="chart-1" currentChartType="table" />);
      await openMenu(user);

      await user.click(screen.getByRole("button", { name: "Delete query" }));
      expect(screen.getByRole("button", { name: "Delete permanently" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.getByRole("button", { name: "Delete query" })).toBeInTheDocument();
    });

    it("forgets a half-finished confirmation after it is dismissed", async () => {
      const user = userEvent.setup();
      render(
        <div>
          <p>the card behind the menu</p>
          <CardMenu query={query} chartId="chart-1" currentChartType="table" />
        </div>,
      );
      await openMenu(user);
      await user.click(screen.getByRole("button", { name: "Delete query" }));
      expect(screen.getByRole("button", { name: "Delete permanently" })).toBeInTheDocument();

      await user.click(screen.getByText("the card behind the menu"));
      await openMenu(user);

      // Reopening must not present a live "delete permanently" the analyst had
      // already walked away from.
      expect(screen.queryByRole("button", { name: "Delete permanently" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete query" })).toBeInTheDocument();
    });
  });
});
