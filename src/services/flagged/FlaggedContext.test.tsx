import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FlaggedProvider, useFlagged } from "./FlaggedContext";

const getFlaggedSummary = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return { ...actual, getFlaggedSummary };
});

function Probe() {
  const flagged = useFlagged();
  return (
    <div>
      <span data-testid="total">{flagged.total}</span>
      <span data-testid="c1">{flagged.countForConnection("c1")}</span>
      <span data-testid="c1sev">{flagged.severityForConnection("c1") ?? "none"}</span>
      <span data-testid="q1">{flagged.countForQuery("q1")}</span>
      <span data-testid="missing">{flagged.countForConnection("nope")}</span>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getFlaggedSummary.mockResolvedValue({
    connections: [{ connection_id: "c1", flagged_count: 5, severity: "high" }],
    queries: [{ query_id: "q1", connection_id: "c1", flagged_count: 5, severity: "high" }],
    flagged_count: 5,
  });
});

describe("FlaggedProvider", () => {
  it("exposes counts by connection and by query", async () => {
    render(
      <FlaggedProvider>
        <Probe />
      </FlaggedProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("total")).toHaveTextContent("5"));
    expect(screen.getByTestId("c1")).toHaveTextContent("5");
    expect(screen.getByTestId("c1sev")).toHaveTextContent("high");
    expect(screen.getByTestId("q1")).toHaveTextContent("5");
  });

  it("reports zero for anything the summary does not mention", async () => {
    // Most connections have nothing flagged and are simply absent from the
    // payload; that must read as zero, not as undefined.
    render(
      <FlaggedProvider>
        <Probe />
      </FlaggedProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("missing")).toHaveTextContent("0"));
  });

  it("fetches once for the whole shell", async () => {
    render(
      <FlaggedProvider>
        <Probe />
        <Probe />
        <Probe />
      </FlaggedProvider>,
    );
    await waitFor(() => expect(getFlaggedSummary).toHaveBeenCalledTimes(1));
  });

  it("shows no badge instead of crashing when there is no provider", () => {
    // The badge is chrome over components that are otherwise provider-free.
    // Failing to count findings must not take down the page showing the data.
    render(<Probe />);
    expect(screen.getByTestId("total")).toHaveTextContent("0");
    expect(screen.getByTestId("c1")).toHaveTextContent("0");
  });

  it("survives a failed summary request", async () => {
    const { ApiError } = await import("@/services/api-client");
    getFlaggedSummary.mockRejectedValue(
      new ApiError({ kind: "http", status: 500, message: "boom", url: "/flagged/summary" }),
    );
    render(
      <FlaggedProvider>
        <Probe />
      </FlaggedProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("total")).toHaveTextContent("0"));
  });
});
