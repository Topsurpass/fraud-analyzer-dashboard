import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartDefinitionRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { DefinitionDialog } from "./DefinitionDialog";
import { ViewerCardMenu } from "./ViewerCardMenu";

/**
 * Somebody else's published chart: its query and settings, to read and copy,
 * and nothing that could change them.
 */

const getChartDefinition = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return { ...actual, getChartDefinition };
});

const definition = (over: Partial<ChartDefinitionRead> = {}): ChartDefinitionRead => ({
  chart: {
    id: "ch1",
    query_id: "q1",
    name: "Volume vs decline rate",
    position: 0,
    chart_type: "biaxial_bar",
    x_field: "bucket",
    y_field: "transactions",
    series_field: "decline_rate_pct",
    surge_threshold_pct: 40,
    is_public: true,
    published_by: "u1",
    published_at: "2026-10-01T10:00:00Z",
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
  },
  query: {
    id: "q1",
    name: "Volume and decline rate",
    description: "Counts against the share declined",
    sql_text: "SELECT bucket, transactions, decline_rate_pct\nFROM fundgate_transactions",
    row_limit: 2000,
    poll_interval_ms: 3_600_000,
  },
  rules: [
    {
      id: "r1",
      name: "Decline rate over threshold",
      severity: "high",
      enabled: true,
      conditions: [
        { column_name: "decline_rate_pct", operator: "gt", value: "48", value2: null, list_name: null },
        { column_name: "terminal", operator: "in_list", value: null, value2: null, list_name: "MFBs Terminal" },
      ],
    },
  ],
  connection_name: "Testing DB connection",
  owner_name: "Grace Hopper",
  read_only: true,
  ...over,
});

beforeEach(() => {
  getChartDefinition.mockReset().mockResolvedValue(definition());
});

function renderDialog(onClose = vi.fn()) {
  render(<DefinitionDialog chartId="ch1" onClose={onClose} />);
  return onClose;
}

describe("DefinitionDialog", () => {
  it("shows the SQL exactly, in a monospace block", async () => {
    renderDialog();
    const sql = await screen.findByLabelText("SQL");
    expect(sql).toHaveTextContent("SELECT bucket, transactions, decline_rate_pct");
    expect(sql).toHaveTextContent("FROM fundgate_transactions");
    expect(sql.className).toMatch(/font-mono/);
  });

  it("says it is read-only and whose it is", async () => {
    renderDialog();
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent("Read-only.");
    expect(note).toHaveTextContent("belongs to Grace Hopper");
  });

  it("states how often it runs and its row limit in words", async () => {
    renderDialog();
    expect(await screen.findByText("1 hour")).toBeInTheDocument();
    expect(screen.getByText("2,000")).toBeInTheDocument();
  });

  it("names the chart type and each field it maps, with the right axis names", async () => {
    renderDialog();
    expect(await screen.findByText("Bar, two axes")).toBeInTheDocument();
    expect(screen.getByText("Left axis (y)")).toBeInTheDocument();
    expect(screen.getByText("Right axis")).toBeInTheDocument();
    expect(screen.getByText("decline_rate_pct", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("bucket", { selector: "code" })).toBeInTheDocument();
  });

  it("writes each rule in plain words, naming a list and never its items", async () => {
    renderDialog();
    const rule = (await screen.findByText("Decline rate over threshold")).closest("li") as HTMLElement;
    expect(rule).toHaveTextContent("high"); // uppercased by CSS, not in the text
    expect(rule).toHaveTextContent("decline_rate_pct greater than 48");
    expect(rule).toHaveTextContent("terminal is in list “MFBs Terminal”");
  });

  it("has nothing to type into: only Copy and Close are controls", async () => {
    renderDialog();
    await screen.findByLabelText("SQL");
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog.querySelectorAll("input, textarea, select")).toHaveLength(0);
    const buttons = [...dialog.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent,
    );
    expect(buttons.sort()).toEqual(["Close", "Close", "Copy"]);
    expect(dialog.querySelector("a")).toBeNull();
  });

  it("copies the SQL and says so", async () => {
    const user = userEvent.setup();
    // After setup(): user-event installs its own clipboard stub there.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderDialog();
    await user.click(await screen.findByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "SELECT bucket, transactions, decline_rate_pct\nFROM fundgate_transactions",
      ),
    );
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("tells the person to select the text when the clipboard is refused", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderDialog();
    await user.click(await screen.findByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("button", { name: "Select and copy" })).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const onClose = renderDialog();
    await screen.findByLabelText("SQL");
    // jsdom turns no key into a dialog `cancel`, which is what Escape is.
    fireEvent(screen.getByRole("dialog", { hidden: true }), new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it("uses a quieter note, still read-only, for the author or an administrator", async () => {
    getChartDefinition.mockResolvedValue(definition({ read_only: false }));
    renderDialog();
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent("Read-only view.");
    expect(note).not.toHaveTextContent("belongs to");
  });

  it("explains a missing definition instead of showing an empty dialog", async () => {
    getChartDefinition.mockRejectedValue(
      new ApiError({ kind: "http", status: 404, message: "No such published chart.", url: "" }),
    );
    renderDialog();
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer published");
  });

  it("says when there are no rules", async () => {
    getChartDefinition.mockResolvedValue(definition({ rules: [] }));
    renderDialog();
    expect(await screen.findByText("This query has no flag rules.")).toBeInTheDocument();
  });
});

describe("ViewerCardMenu", () => {
  it("holds View definition and nothing that changes anything", async () => {
    const user = userEvent.setup();
    render(<ViewerCardMenu chartId="ch1" name="Volume vs decline rate" />);
    await user.click(screen.getByLabelText("Chart options for Volume vs decline rate"));

    expect(screen.getByRole("button", { name: "View definition" })).toBeInTheDocument();
    for (const forbidden of [/Run now/, /Edit query/, /Delete/, /Publish/, /Unpublish/, /Request/]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });

  it("opens the definition for that chart", async () => {
    const user = userEvent.setup();
    render(<ViewerCardMenu chartId="ch1" name="Volume vs decline rate" />);
    await user.click(screen.getByLabelText("Chart options for Volume vs decline rate"));
    await user.click(screen.getByRole("button", { name: "View definition" }));

    expect(await screen.findByLabelText("SQL")).toBeInTheDocument();
    expect(getChartDefinition).toHaveBeenCalledWith("ch1", expect.anything());
  });

  it("gives focus back to the menu's button when the dialog closes", async () => {
    const user = userEvent.setup();
    render(<ViewerCardMenu chartId="ch1" name="Volume vs decline rate" />);
    const trigger = screen.getByLabelText("Chart options for Volume vs decline rate");
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "View definition" }));
    await screen.findByLabelText("SQL");

    fireEvent(screen.getByRole("dialog", { hidden: true }), new Event("cancel", { cancelable: true }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
