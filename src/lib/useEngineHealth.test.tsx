import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ready = vi.hoisted(() => vi.fn());
const health = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => ({
  ...(await vi.importActual<typeof import("@/services/api-client")>("@/services/api-client")),
  ready,
  health,
}));

import { resetEngineHealth, useEngineHealth } from "./useEngineHealth";

function Readout({ label }: { label: string }) {
  const { status } = useEngineHealth();
  return <span data-testid={label}>{status}</span>;
}

afterEach(() => {
  resetEngineHealth();
  ready.mockReset();
  health.mockReset();
});

describe("useEngineHealth", () => {
  it("asks the engine once however many readouts are on the page", async () => {
    /*
     * The regression this exists for. The rail, the mobile drawer's rail and
     * the top bar each ran their own timer and their own request, so a
     * thirty-second poll left as three - six under React's development
     * double-invoke. Measured against the running engine: twelve requests a
     * minute.
     */
    ready.mockResolvedValue(undefined);

    render(
      <>
        <Readout label="rail" />
        <Readout label="drawer" />
        <Readout label="topbar" />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId("rail")).toHaveTextContent("ok"));
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("shows every readout the same answer", async () => {
    ready.mockResolvedValue(undefined);

    render(
      <>
        <Readout label="rail" />
        <Readout label="topbar" />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId("rail")).toHaveTextContent("ok"));
    expect(screen.getByTestId("topbar")).toHaveTextContent("ok");
  });

  it("reports degraded when the engine answers but cannot serve", async () => {
    // The state this readout exists for: reachable, and still unable to work.
    ready.mockRejectedValue(new Error("503"));
    health.mockResolvedValue(undefined);

    render(<Readout label="rail" />);

    await waitFor(() => expect(screen.getByTestId("rail")).toHaveTextContent("degraded"));
  });

  it("reports down when nothing answers at all", async () => {
    ready.mockRejectedValue(new Error("no route to host"));
    health.mockRejectedValue(new Error("no route to host"));

    render(<Readout label="rail" />);

    await waitFor(() => expect(screen.getByTestId("rail")).toHaveTextContent("down"));
  });

  it("stops asking once the last readout leaves the page", async () => {
    ready.mockResolvedValue(undefined);
    const view = render(<Readout label="rail" />);
    await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));

    view.unmount();
    const afterUnmount = ready.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));

    // A page with no readout on it should cost the engine nothing.
    expect(ready.mock.calls.length).toBe(afterUnmount);
  });
});
