import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Rail } from "./Rail";

vi.mock("next/navigation", () => ({ usePathname: () => "/connections/c1" }));

const useConnections = vi.hoisted(() => vi.fn());
const useDashboards = vi.hoisted(() => vi.fn());

vi.mock("@/services/connections/ConnectionsContext", () => ({ useConnections }));
vi.mock("@/services/dashboards", () => ({ useDashboards }));

beforeEach(() => {
  useConnections.mockReturnValue({
    connections: [
      { id: "c1", name: "Payments DB", status: "ok" },
      { id: "c2", name: "Ledger", status: "failed" },
    ],
    initial: false,
    loading: false,
    error: null,
    reload: vi.fn(),
  });
  useDashboards.mockReturnValue({
    dashboards: [{ id: "d1", name: "Card testing", chart_ids: ["q1", "q2"] }],
    initial: false,
    loading: false,
    error: null,
    reload: vi.fn(),
  });
});

describe("Rail", () => {
  it("shows names and both sections when expanded", () => {
    render(<Rail collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByText("Payments DB")).toBeInTheDocument();
    expect(screen.getByText("Card testing")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connections" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dashboards" })).toBeInTheDocument();
  });

  it("marks the current connection as the active page", () => {
    render(<Rail collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByRole("link", { name: /Payments DB/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps every status light when collapsed, and drops only the labels", () => {
    render(<Rail collapsed onToggleCollapse={vi.fn()} />);

    // The instrument's status lights are the one thing collapsing must not cost.
    expect(screen.getByRole("img", { name: "Connected" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Connection failed" })).toBeInTheDocument();
    expect(screen.queryByText("Payments DB")).not.toBeInTheDocument();
  });

  it("still links each connection when collapsed", () => {
    render(<Rail collapsed onToggleCollapse={vi.fn()} />);
    expect(screen.getByRole("link", { name: /Connected/ })).toHaveAttribute(
      "href",
      "/connections/c1",
    );
  });

  it("reports its own state on the toggle", async () => {
    const onToggleCollapse = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Rail collapsed={false} onToggleCollapse={onToggleCollapse} />);

    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    await user.click(collapse);
    expect(onToggleCollapse).toHaveBeenCalled();

    rerender(<Rail collapsed onToggleCollapse={onToggleCollapse} />);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("has no toggle at all when the shell does not offer one", () => {
    render(<Rail collapsed={false} />);
    expect(screen.queryByRole("button", { name: /sidebar/ })).not.toBeInTheDocument();
  });
});
