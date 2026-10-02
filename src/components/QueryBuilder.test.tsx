import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewResponse } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { ListsProvider } from "@/lib/ListsContext";
import { QueryEditor } from "./QueryEditor";
import { ResultsDock } from "./querybuilder/results";

/**
 * The query builder as somebody who has never seen it. Each test is one of the ways
 * people got lost: not knowing the order of things, not finding Preview, adding a
 * chart before there are columns, and losing the results as rules grew.
 */

const previewQuery = vi.hoisted(() => vi.fn());
vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>("@/services/api-client");
  return { ...actual, previewQuery, listLists: vi.fn().mockResolvedValue([]) };
});
vi.mock("@/components/SchemaBrowser", () => ({
  SchemaBrowser: ({ onInsert }: { onInsert?: (text: string) => void }) => (
    <button type="button" onClick={() => onInsert?.("transactions")}>
      table transactions
    </button>
  ),
}));

const RESULT: PreviewResponse = {
  connection_id: "c1",
  executed_at: "2026-10-01T10:00:00Z",
  duration_ms: 12,
  row_count: 2,
  truncated: false,
  columns: ["bucket", "transactions"],
  rows: [
    ["07:44", 146],
    ["07:54", 134],
  ],
  flags: { flagged_count: 0, rows: [], rules: [], warnings: [], dismissed_count: 0 },
};

function renderEditor(over: Partial<React.ComponentProps<typeof QueryEditor>> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <ListsProvider>
      <QueryEditor
        connectionId="c1"
        submitLabel="Save query"
        busy={false}
        onSubmit={onSubmit}
        onCancel={onCancel}
        {...over}
      />
    </ListsProvider>,
  );
  return { onSubmit, onCancel };
}

const steps = () => within(screen.getByRole("navigation", { name: "Steps" }));
const type = async (label: string | RegExp, text: string) =>
  userEvent.type(screen.getByLabelText(label), text);

beforeEach(() => {
  vi.clearAllMocks();
  previewQuery.mockResolvedValue(RESULT);
});

describe("knowing what the parts are and what is next", () => {
  it("lists the five parts in order, from the first moment", () => {
    renderEditor();
    const names = steps()
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label")?.split(":")[0]);
    expect(names).toEqual(["Query", "Results", "Charts", "Rules", "Schedule"]);
  });

  it("points at the part still needing something", () => {
    renderEditor();
    expect(steps().getByRole("button", { name: /^Query: to do/ })).toHaveAttribute("aria-current", "step");
  });

  it("moves on as the work is done", async () => {
    renderEditor();
    await type("Name", "Declines");
    await type(/Read-only SQL/, "SELECT 1");
    // Query is done; the next thing is the preview.
    expect(steps().getByRole("button", { name: /^Results: to do\. Run a preview/ })).toHaveAttribute(
      "aria-current",
      "step",
    );
  });

  it("numbers each part's card and says what it is for", () => {
    renderEditor();
    for (const title of ["Write the query", "Check the result", "Choose how it is drawn", "Flag what needs a look", "Set how often it runs"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });
});

describe("finding Preview", () => {
  it("offers Run preview in the top bar and under the SQL, with the shortcut", () => {
    renderEditor();
    expect(screen.getAllByRole("button", { name: /Run preview/ }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText("Read-only SQL")).toBeInTheDocument();
  });

  it("runs from the keyboard shortcut in the SQL box", async () => {
    renderEditor();
    await type(/Read-only SQL/, "SELECT 1");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(previewQuery).toHaveBeenCalledTimes(1));
    expect(previewQuery.mock.calls[0][1].sql_text).toBe("SELECT 1");
  });

  it("explains itself before the first run", () => {
    renderEditor();
    expect(screen.getByText("Nothing to show yet")).toBeInTheDocument();
    expect(screen.getByText(/Charts and rules are built from the columns/)).toBeInTheDocument();
  });

  it("shows the rows and how many, once it has run", async () => {
    renderEditor();
    await type(/Read-only SQL/, "SELECT 1");
    await userEvent.click(screen.getAllByRole("button", { name: /Run preview/ })[0]);
    // In the card's header, and again in the outline's note for the Results step.
    expect((await screen.findAllByText(/2 rows/)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/2 rows · 2 columns/)).toBeInTheDocument();
  });

  it("marks the results out of date when the SQL changes, and re-runs in one click", async () => {
    renderEditor();
    await type(/Read-only SQL/, "SELECT 1");
    await userEvent.click(screen.getAllByRole("button", { name: /Run preview/ })[0]);
    await screen.findByText(/2 rows · 2 columns/);

    await type(/Read-only SQL/, " -- changed");
    expect(await screen.findByText("Out of date.")).toBeInTheDocument();
    expect(steps().getByRole("button", { name: /^Results: needs attention\. Out of date/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Re-run preview/ }));
    await waitFor(() => expect(previewQuery).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Out of date.")).not.toBeInTheDocument());
  });

  it("keeps what was typed when the preview fails, and says why", async () => {
    previewQuery.mockRejectedValueOnce(
      new ApiError({ kind: "http", status: 400, message: "syntax error near FORM", url: "" }),
    );
    renderEditor();
    await type(/Read-only SQL/, "SELECT 1 FORM t");
    await userEvent.click(screen.getAllByRole("button", { name: /Run preview/ })[0]);
    expect(await screen.findByText("The preview did not run.")).toBeInTheDocument();
    expect(screen.getByLabelText("Read-only SQL")).toHaveValue("SELECT 1 FORM t");
  });

  it("does not run an empty query, and says where to type", async () => {
    renderEditor();
    await userEvent.click(screen.getAllByRole("button", { name: /Run preview/ })[0]);
    expect(previewQuery).not.toHaveBeenCalled();
    expect(await screen.findByText("Some SQL is required.")).toBeInTheDocument();
  });
});

describe("adding a chart before there is a preview", () => {
  it("says the columns come from a preview, and runs one from there", async () => {
    renderEditor();
    expect(screen.getByText(/Charts are built from your columns, and the columns come from a preview/)).toBeInTheDocument();
    const run = screen.getByRole("button", { name: "Run preview to get your columns" });
    expect(run).toBeDisabled(); // nothing to run yet: it says so
    expect(screen.getByText("Write the SQL in step 1 first.")).toBeInTheDocument();

    await type(/Read-only SQL/, "SELECT 1");
    await userEvent.click(screen.getByRole("button", { name: "Run preview to get your columns" }));
    await waitFor(() => expect(previewQuery).toHaveBeenCalledTimes(1));
    // The chart editor is there now, with its controls, instead of the explanation.
    expect(await screen.findByLabelText("Chart name")).toBeInTheDocument();
    expect(screen.queryByText(/Charts are built from your columns/)).not.toBeInTheDocument();
  });

  it("gives the untouched first chart the type that suits the data, and says so", async () => {
    renderEditor();
    await type(/Read-only SQL/, "SELECT 1");
    await userEvent.click(screen.getAllByRole("button", { name: /Run preview/ })[0]);
    expect(await screen.findByText(/We chose a line chart\./)).toBeInTheDocument();
    expect(screen.getByText(/over bucket is a trend/)).toBeInTheDocument();
    // The pickers are showing and filled, not hidden behind a table.
    expect(screen.getByLabelText("Type")).toHaveValue("line");
    expect(screen.getByLabelText("X field")).toHaveValue("bucket");
  });

  it("lets the choice be undone, back to the plain table", async () => {
    renderEditor();
    await type(/Read-only SQL/, "SELECT 1");
    await userEvent.click(screen.getAllByRole("button", { name: /Run preview/ })[0]);
    await screen.findByText(/We chose a line chart/);
    await userEvent.click(screen.getByRole("button", { name: "Back to a table" }));
    expect(screen.queryByText(/We chose/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Type")).toHaveValue("table");
  });

  it("never swaps a chart the person already set up", async () => {
    renderEditor({
      initial: { id: "q", name: "x", sql_text: "SELECT 1" } as never,
      initialCharts: [{ name: "Mine", chart_type: "bar", x_field: "bucket", y_field: "transactions", series_field: null }],
    });
    await userEvent.click(screen.getAllByRole("button", { name: /Run preview/ })[0]);
    await screen.findByText(/2 rows · 2 columns/);
    expect(screen.queryByText(/We chose/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Type")).toHaveValue("bar");
  });


  it("does not make an editing user preview just to see their own charts", () => {
    renderEditor({
      initialCharts: [{ name: "Trend", chart_type: "line", x_field: "bucket", y_field: "n", series_field: "" }],
    });
    expect(screen.queryByText(/Charts are built from your columns/)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Trend")).toBeInTheDocument();
  });
});

describe("rules, without losing the results", () => {
  it("edits rules in a dialog, and the page keeps one line per rule", async () => {
    renderEditor();
    await type(/Read-only SQL/, "SELECT 1");
    expect(screen.getByText(/No rules yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add a rule" }));

    const dialog = await screen.findByRole("dialog", { name: "Flag rules" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Add rule" }));
    await userEvent.type(within(dialog).getByLabelText("Column"), "transactions");
    await userEvent.type(within(dialog).getByLabelText("Value"), "100");
    await userEvent.click(within(dialog).getByRole("button", { name: "Use these rules" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Flag rules" })).not.toBeInTheDocument());
    expect(document.getElementById("qb-rules")).toHaveTextContent(/transactions .*100/);
    expect(steps().getByRole("button", { name: /^Rules: done\. 1 rule/ })).toBeInTheDocument();
  });

  it("shows the live effect on the preview rows while writing, in the dialog", async () => {
    previewQuery.mockResolvedValue({
      ...RESULT,
      flags: {
        flagged_count: 1,
        rows: [{ index: 0, rule_ids: ["0"], rule_names: [], fingerprint: "f0" }],
        rules: [{ id: "0", name: "Big", severity: "high", matched: 1 }],
        warnings: [],
        dismissed_count: 0,
      },
    });
    renderEditor();
    await type(/Read-only SQL/, "SELECT 1");
    await userEvent.click(screen.getByRole("button", { name: "Add a rule" }));
    const dialog = await screen.findByRole("dialog", { name: "Flag rules" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Add rule" }));
    await userEvent.type(within(dialog).getByLabelText("Column"), "transactions");
    await userEvent.type(within(dialog).getByLabelText("Value"), "140");
    // The count is in the preview pane and again in the footer, which is what a phone shows
    // when the preview is on its own tab.
    expect((await within(dialog).findAllByText(/Catches 1 of 2 rows/, undefined, { timeout: 4000 })).length).toBe(2);
  });

  it("says to finish a rule, not that it catches nothing, while it is incomplete", async () => {
    renderEditor();
    await type(/Read-only SQL/, "SELECT 1");
    await userEvent.click(screen.getByRole("button", { name: "Add a rule" }));
    const dialog = await screen.findByRole("dialog", { name: "Flag rules" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Add rule" }));
    // A rule with no column is not being checked at all: "catches no rows" would be a
    // true statement about nothing.
    expect(within(dialog).getAllByText("Finish the rule to see what it catches.").length).toBe(2);
    expect(within(dialog).queryByText(/Catches no rows/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Use these rules" })).toBeDisabled();
  });

  it("does not apply rules that were cancelled", async () => {
    renderEditor();
    await type(/Read-only SQL/, "SELECT 1");
    await userEvent.click(screen.getByRole("button", { name: "Add a rule" }));
    const dialog = await screen.findByRole("dialog", { name: "Flag rules" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Add rule" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    // Something was typed, so it asks before throwing it away.
    expect(await within(dialog).findByText(/Discard the changes you made to the rules/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Flag rules" })).not.toBeInTheDocument());
    expect(screen.getByText(/No rules yet/)).toBeInTheDocument();
  });
});

describe("schedule in plain language", () => {
  it("says it as a sentence, and updates as it is set", async () => {
    renderEditor();
    expect(screen.getByText("Uses the engine's default interval")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Run every"), "5");
    expect(screen.getAllByText("Runs at most once every 5 minutes").length).toBeGreaterThan(0);
    expect(steps().getByRole("button", { name: /^Schedule: done\. Set/ })).toBeInTheDocument();
  });
});

describe("saving", () => {
  it("lists exactly what stops the save, each one a way to the problem", async () => {
    const { onSubmit } = renderEditor();
    const bar = screen.getByText(/things to fix before saving/).closest("div")!;
    expect(within(bar).getByRole("button", { name: "Give the query a name" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Write the SQL" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save query" }));
    expect(onSubmit).not.toHaveBeenCalled();
    // It went to the first problem instead of doing nothing.
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
  });

  it("clears the list as things are fixed, and then saves the same payload as before", async () => {
    const { onSubmit } = renderEditor();
    await type("Name", "Declines");
    await type(/Read-only SQL/, "SELECT 1");
    await userEvent.click(screen.getAllByRole("button", { name: /Run preview/ })[0]);
    await screen.findByText(/2 rows · 2 columns/);
    expect(screen.queryByText(/to fix before saving/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save query" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: "Declines",
      description: null,
      sql_text: "SELECT 1",
      flag_rules: [],
      row_limit: null,
      poll_interval_ms: null,
      charts: [{ chart_type: "line", x_field: "bucket", y_field: "transactions" }],
    });
  });

  it("blocks on a zero interval, which the engine would refuse", async () => {
    const { onSubmit } = renderEditor();
    await type("Name", "Declines");
    await type(/Read-only SQL/, "SELECT 1");
    await userEvent.type(screen.getByLabelText("Run every"), "0");
    expect(screen.getByRole("button", { name: /Set the interval above zero/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save query" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the engine's refusal in the bar, where the person is looking", () => {
    renderEditor({
      error: new ApiError({ kind: "http", status: 409, errorCode: "QUERY_FROZEN", message: "This query is published.", url: "" }),
      initial: { id: "q", name: "x", sql_text: "SELECT 1" } as never,
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/published/i);
  });
});

describe("not losing work", () => {
  it("asks before Cancel throws away typing, and not when nothing was typed", async () => {
    const { onCancel } = renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps the work if told to", async () => {
    const { onCancel } = renderEditor();
    await type("Name", "Declines");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: "Discard your changes?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Declines");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("leaves when told to discard", async () => {
    const { onCancel } = renderEditor();
    await type("Name", "Declines");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const dialog = await screen.findByRole("dialog", { name: "Discard your changes?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("warns on reload or close once there are unsaved changes", async () => {
    renderEditor();
    const quiet = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);

    await type("Name", "Declines");
    const loud = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(loud);
    expect(loud.defaultPrevented).toBe(true);
  });

  it("does not warn while saving", async () => {
    const { rerender } = render(<div />);
    rerender(<div />);
    renderEditor({ busy: true });
    await type("Name", "Declines");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("browsing tables", () => {
  it("puts a table name into the SQL at the cursor, from a dialog", async () => {
    renderEditor();
    await type(/Read-only SQL/, "SELECT * FROM ");
    await userEvent.click(screen.getByRole("button", { name: "Browse tables" }));
    const dialog = await screen.findByRole("dialog", { name: "Browse tables" });
    await userEvent.click(within(dialog).getByRole("button", { name: "table transactions" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.getByLabelText("Read-only SQL")).toHaveValue("SELECT * FROM transactions");
  });
});

describe("an unchanged query being edited", () => {
  it("starts with the saved values and nothing to save yet", () => {
    renderEditor({
      initial: { id: "q1", name: "Smoke", description: "d", sql_text: "SELECT 1", row_limit: 50, poll_interval_ms: 60000 } as never,
      initialCharts: [{ name: "Trend", chart_type: "line", x_field: "a", y_field: "b", series_field: "" }],
    });
    expect(screen.getByLabelText("Name")).toHaveValue("Smoke");
    expect(screen.getByText("No changes yet.")).toBeInTheDocument();
    expect(screen.queryByText(/to fix before saving/)).not.toBeInTheDocument();
  });
});

describe("rules dialog on a narrow screen", () => {
  it("has Rules and Preview tabs, and the count stays in the footer on either", async () => {
    renderEditor();
    await type(/Read-only SQL/, "SELECT 1");
    await userEvent.click(screen.getAllByRole("button", { name: /Run preview/ })[0]);
    await screen.findByText(/2 rows · 2 columns/);
    await userEvent.click(screen.getByRole("button", { name: "Add a rule" }));
    const dialog = await screen.findByRole("dialog", { name: "Flag rules" });
    const tabs = within(dialog).getByRole("tablist", { name: "Rules or preview" });
    expect(within(tabs).getByRole("tab", { name: "Rules" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(within(tabs).getByRole("tab", { name: "Preview" }));
    expect(within(tabs).getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
    const footer = dialog.querySelector("footer")!;
    expect(within(footer).getByText(/Finish the rule|Catches|Checking|Waiting/)).toBeInTheDocument();
  });
});

describe("the results dock", () => {
  const preview = {
    columns: ["a", "b"],
    rows: [[1, "x"], [2, "y"], [3, null], [4, "w"], [5, "v"]],
    row_count: 5,
    duration_ms: 3,
    truncated: false,
    flags: null,
  } as unknown as PreviewResponse;
  const state = { preview, error: null, previewing: false, stale: false, hasSql: true };

  it("keeps the first three rows in view, so the results are more than a count", () => {
    render(<ResultsDock state={state} open={false} onToggle={() => {}} onRun={() => {}} onShowCard={() => {}} />);
    const table = screen.getByRole("table", { name: "First rows of the preview" });
    expect(within(table).getAllByRole("row")).toHaveLength(4); // header + 3
    expect(within(table).getByText("–")).toBeInTheDocument(); // a null reads as a dash
    expect(within(table).queryByText("4")).not.toBeInTheDocument();
  });

  it("drops the peek when the tray is open, which shows the whole table", () => {
    render(<ResultsDock state={state} open onToggle={() => {}} onRun={() => {}} onShowCard={() => {}} />);
    expect(screen.queryByRole("table", { name: "First rows of the preview" })).not.toBeInTheDocument();
  });
});
