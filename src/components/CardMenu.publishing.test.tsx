import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryChart, SavedQueryRead, UserRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { CardMenu } from "./CardMenu";

/**
 * What the publish control says and does, per chart state and per person.
 *
 * The rule under test: an analyst's click never publishes. It asks. Only an
 * administrator's click publishes at once. The old menu had one item that
 * published for everyone, so an analyst could share a chart with the whole team
 * without anybody having looked at it.
 */

const publishChart = vi.hoisted(() => vi.fn());
const unpublishChart = vi.hoisted(() => vi.fn());
const cancelPublishRequest = vi.hoisted(() => vi.fn());
const currentUser = vi.hoisted(() => ({ value: null as UserRead | null }));

vi.mock("@/services/dashboards", () => ({ useDashboards: () => ({ reload: vi.fn() }) }));
vi.mock("@/services/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/services/auth/AuthContext")>(
    "@/services/auth/AuthContext",
  );
  return { ...actual, useOptionalUser: () => currentUser.value };
});
vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return { ...actual, publishChart, unpublishChart, cancelPublishRequest };
});

const person = (role: "admin" | "analyst"): UserRead => ({
  id: role === "admin" ? "u1" : "u2",
  email: `${role}@example.com`,
  full_name: role,
  role,
  is_active: true,
  must_change_password: false,
  last_login_at: null,
  created_at: "2026-10-01T00:00:00Z",
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

const chart = (over: Partial<QueryChart> = {}): QueryChart =>
  ({
    id: "chart-1",
    query_id: "q1",
    name: "Chart",
    position: 0,
    chart_type: "table",
    x_field: null,
    y_field: null,
    series_field: null,
    surge_threshold_pct: null,
    is_public: false,
    published_by: null,
    published_at: null,
    publish_status: "private",
    created_at: "2026-08-24T09:00:00Z",
    updated_at: "2026-08-24T09:00:00Z",
    ...over,
  }) as QueryChart;

async function open(c: QueryChart) {
  const user = userEvent.setup();
  render(<CardMenu query={query} chartId="chart-1" currentChartType="table" chart={c} />);
  await user.click(screen.getByLabelText("Actions for Declines by country"));
  return user;
}

beforeEach(() => {
  publishChart.mockReset().mockResolvedValue({});
  unpublishChart.mockReset().mockResolvedValue({});
  cancelPublishRequest.mockReset().mockResolvedValue({});
  currentUser.value = person("analyst");
});

describe("an analyst", () => {
  it("is offered to request publishing, never to publish", async () => {
    await open(chart());
    expect(
      screen.getByRole("button", { name: /^Request publishing \(an administrator approves it\)/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Publish to the team/ })).not.toBeInTheDocument();
  });

  it("asks through the publish endpoint, which the engine turns into a request", async () => {
    const user = await open(chart());
    await user.click(screen.getByRole("button", { name: /^Request publishing/ }));
    await waitFor(() => expect(publishChart).toHaveBeenCalledWith("chart-1"));
    expect(unpublishChart).not.toHaveBeenCalled();
    expect(cancelPublishRequest).not.toHaveBeenCalled();
  });

  it("can withdraw a request that is waiting, and that does not publish", async () => {
    const user = await open(chart({ publish_status: "pending" }));
    await user.click(screen.getByRole("button", { name: /^Withdraw publish request/ }));
    await waitFor(() => expect(cancelPublishRequest).toHaveBeenCalledWith("chart-1"));
    expect(publishChart).not.toHaveBeenCalled();
    expect(unpublishChart).not.toHaveBeenCalled();
  });

  it("is offered to ask again after a rejection", async () => {
    const user = await open(
      chart({
        publish_rejection: { reason: "Too broad", rejected_at: "2026-10-01T10:00:00Z", rejected_by_name: "Ada" },
      }),
    );
    await user.click(screen.getByRole("button", { name: "Request publishing again" }));
    await waitFor(() => expect(publishChart).toHaveBeenCalledWith("chart-1"));
  });

  it("can take a published chart down", async () => {
    const user = await open(chart({ is_public: true, publish_status: "published" }));
    await user.click(screen.getByRole("button", { name: /^Unpublish/ }));
    await waitFor(() => expect(unpublishChart).toHaveBeenCalledWith("chart-1"));
  });

  it("keeps the menu open and shows the engine's reason when a request is refused", async () => {
    publishChart.mockRejectedValue(
      new ApiError({ kind: "http", status: 409, message: "Already waiting for approval.", url: "" }),
    );
    const user = await open(chart());
    await user.click(screen.getByRole("button", { name: /^Request publishing/ }));
    expect(await screen.findByText("Already waiting for approval.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Request publishing/ })).toBeInTheDocument();
  });
});

describe("an administrator", () => {
  beforeEach(() => {
    currentUser.value = person("admin");
  });

  it("still publishes at once", async () => {
    const user = await open(chart());
    await user.click(screen.getByRole("button", { name: /^Publish to the team \(freezes the query\)/ }));
    await waitFor(() => expect(publishChart).toHaveBeenCalledWith("chart-1"));
    expect(screen.queryByRole("button", { name: /^Request publishing/ })).not.toBeInTheDocument();
  });

  it("is sent to the queue, not given an approve button, on a waiting request", async () => {
    await open(chart({ publish_status: "pending" }));
    const link = screen.getByRole("link", { name: "Review publish request" });
    expect(link).toHaveAttribute("href", "/approvals");
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Publish to the team/ })).not.toBeInTheDocument();
  });
});

describe("with no chart state given (an older caller)", () => {
  it("falls back to is_public and still offers a sensible control", async () => {
    const user = userEvent.setup();
    render(<CardMenu query={query} chartId="chart-1" currentChartType="table" isPublished />);
    await user.click(screen.getByLabelText("Actions for Declines by country"));
    expect(screen.getByRole("button", { name: /^Unpublish/ })).toBeInTheDocument();
  });
});
