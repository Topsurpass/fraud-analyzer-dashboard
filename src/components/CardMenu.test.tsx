import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedQueryRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { CardMenu } from "./CardMenu";

const updateQuery = vi.hoisted(() => vi.fn());
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
  return { ...actual, updateQuery, deleteQuery, runQuery };
});

const query: SavedQueryRead = {
  id: "q1",
  connection_id: "c1",
  name: "Declines by country",
  description: null,
  sql_text: "SELECT 1",
  table_hint: null,
  chart_type: "bar",
  x_field: "country",
  y_field: "declines",
  series_field: null,
  row_limit: 1000,
  poll_interval_ms: 5000,
  created_at: "2026-08-22T12:00:00",
  updated_at: "2026-08-22T12:00:00",
};

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  // `<summary>` has no button role, so it is reached by its label.
  await user.click(screen.getByLabelText("Actions for Declines by country"));
}

beforeEach(() => {
  updateQuery.mockReset().mockResolvedValue(query);
  deleteQuery.mockReset().mockResolvedValue(undefined);
  runQuery.mockReset().mockResolvedValue({});
});

describe("CardMenu", () => {
  it("offers every chart type the engine supports", async () => {
    const user = userEvent.setup();
    render(<CardMenu query={query} />);
    await openMenu(user);

    for (const label of ["Line", "Bar", "Pie", "Number", "Table"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("marks the current type with a glyph, not colour alone", async () => {
    const user = userEvent.setup();
    render(<CardMenu query={query} />);
    await openMenu(user);

    expect(screen.getByRole("button", { name: "Bar" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Line" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Bar" })).toHaveTextContent("•");
  });

  it("writes a chart-type change through to the engine", async () => {
    const user = userEvent.setup();
    const onMutated = vi.fn();
    render(<CardMenu query={query} onMutated={onMutated} />);
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: "Pie" }));

    await waitFor(() => expect(updateQuery).toHaveBeenCalledWith("q1", { chart_type: "pie" }));
    await waitFor(() => expect(onMutated).toHaveBeenCalled());
  });

  it("does not call the engine when the chosen type is already active", async () => {
    const user = userEvent.setup();
    render(<CardMenu query={query} />);
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: "Bar" }));
    expect(updateQuery).not.toHaveBeenCalled();
  });

  it("reports a failed chart change instead of pretending it worked", async () => {
    const user = userEvent.setup();
    updateQuery.mockRejectedValue(
      new ApiError({ kind: "http", message: "Chart type is invalid", url: "/x", status: 422 }),
    );
    render(<CardMenu query={query} />);
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: "Pie" }));
    expect(await screen.findByText("Chart type is invalid")).toBeInTheDocument();
  });

  it("runs the query on demand", async () => {
    const user = userEvent.setup();
    const onMutated = vi.fn();
    render(<CardMenu query={query} onMutated={onMutated} />);
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(runQuery).toHaveBeenCalledWith("q1"));
    await waitFor(() => expect(onMutated).toHaveBeenCalled());
  });

  it("links to the full editor", async () => {
    const user = userEvent.setup();
    render(<CardMenu query={query} />);
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
    render(<CardMenu query={query} />);
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
});
