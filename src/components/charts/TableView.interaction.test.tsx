import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { buildTable } from "@/services/charts/shape";
import type { FlagOutcome, Row } from "@/contracts/api";
import { TableView } from "./TableView";

/**
 * What TanStack Table added to the raw result view: sorting, search and a
 * flagged-only filter. All three run over rows already in the browser, so the
 * properties worth pinning are the ones that could quietly lie to an analyst:
 * a sort that puts NULLs first, a search that matches the wrong column, or a
 * filter that leaves a stale count on screen.
 */

const CHART = {
  id: "c",
  name: "Chart",
  type: "table" as const,
  x_field: null,
  y_field: null,
  series_field: null,
  warnings: [],
};

function table(columns: string[], rows: Row[], flags?: FlagOutcome) {
  return buildTable({ columns, rows, chart: CHART, flags });
}

/** First-column text of every body row, in display order. */
function order(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[1].textContent ?? "");
}

// 10 rows so the toolbar (search, count) is shown: it is hidden below 8.
const ROWS: Row[] = [
  ["delta", 30],
  ["alpha", 5],
  ["echo", null],
  ["bravo", 200],
  ["charlie", 10],
  ["foxtrot", 7],
  ["golf", 1],
  ["hotel", 9],
  ["india", 3],
  ["juliet", 4],
];

describe("sorting", () => {
  it("sorts a numeric column by value, not as text", async () => {
    const user = userEvent.setup();
    render(<TableView data={table(["name", "score"], ROWS)} title="T" />);

    await user.click(screen.getByRole("button", { name: "Score" }));
    // As text "200" < "3", so a string sort would put bravo first.
    expect(order().slice(0, 4)).toEqual(["golf", "india", "juliet", "alpha"]);
    expect(order().at(-2)).toBe("bravo");
  });

  it("keeps NULLs last in both directions", async () => {
    const user = userEvent.setup();
    render(<TableView data={table(["name", "score"], ROWS)} title="T" />);
    const sort = screen.getByRole("button", { name: "Score" });

    await user.click(sort); // ascending
    expect(order().at(-1)).toBe("echo");
    await user.click(sort); // descending
    expect(order()[0]).toBe("bravo");
    expect(order().at(-1)).toBe("echo");
  });

  it("reports its state on the header and clears on the third click", async () => {
    const user = userEvent.setup();
    render(<TableView data={table(["name", "score"], ROWS)} title="T" />);
    const header = screen.getByRole("columnheader", { name: /Score/ });
    const sort = screen.getByRole("button", { name: "Score" });

    expect(header).toHaveAttribute("aria-sort", "none");
    await user.click(sort);
    expect(header).toHaveAttribute("aria-sort", "ascending");
    await user.click(sort);
    expect(header).toHaveAttribute("aria-sort", "descending");
    await user.click(sort);
    expect(header).toHaveAttribute("aria-sort", "none");
    // Back to the engine's own order.
    expect(order()[0]).toBe("delta");
  });
});

describe("search", () => {
  it("narrows to rows where any cell matches, case-insensitively, and says how many", async () => {
    const user = userEvent.setup();
    render(<TableView data={table(["name", "score"], ROWS)} title="T" />);

    await user.type(screen.getByRole("searchbox"), "CHAR");
    expect(order()).toEqual(["charlie"]);
    expect(screen.getByText("1 of 10 rows")).toBeInTheDocument();
  });

  it("matches the displayed text of a number, not its raw value", async () => {
    const user = userEvent.setup();
    const rows: Row[] = [...ROWS.slice(0, 9), ["kilo", 1234567]];
    render(<TableView data={table(["name", "score"], rows)} title="T" />);

    // The audit view prints 1,234,567, so that is what an analyst will type.
    await user.type(screen.getByRole("searchbox"), "1,234");
    expect(order()).toEqual(["kilo"]);
  });

  it("says so, with the query, when nothing matches", async () => {
    const user = userEvent.setup();
    render(<TableView data={table(["name", "score"], ROWS)} title="T" />);

    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText('No rows match "zzz".')).toBeInTheDocument();
  });

  it("is absent on a small result, where it would only be noise", () => {
    render(<TableView data={table(["name", "score"], ROWS.slice(0, 3))} title="T" />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});

describe("flagged only", () => {
  const flags: FlagOutcome = {
    flagged_count: 2,
    rows: [
      { index: 3, rule_ids: ["r1"] },
      { index: 0, rule_ids: ["r1"] },
    ],
    rules: [{ id: "r1", name: "Big", severity: "high", matched: 2 }],
    warnings: [],
    dismissed_count: 0,
  };

  it("shows only flagged rows and toggles back", async () => {
    const user = userEvent.setup();
    render(<TableView data={table(["name", "score"], ROWS, flags)} title="T" />);
    const toggle = screen.getByRole("button", { name: "Flagged only" });

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(order()).toEqual(["delta", "bravo"]);
    expect(screen.getByText("2 of 10 rows")).toBeInTheDocument();

    await user.click(toggle);
    expect(order()).toHaveLength(10);
  });

  it("keeps each mark on the row it belongs to after sorting", async () => {
    // The flag arrays are indexed by position in the engine's result. A sort
    // that moved rows without moving their flags would mark the wrong people.
    const user = userEvent.setup();
    const { container } = render(
      <TableView data={table(["name", "score"], ROWS, flags)} title="T" />,
    );
    await user.click(screen.getByRole("button", { name: "Score" }));

    const marked = screen
      .getAllByRole("row")
      .filter((row) => row.querySelector(".bg-alert") !== null)
      .map((row) => within(row).getAllByRole("cell")[1].textContent);
    expect(marked.sort()).toEqual(["bravo", "delta"]);
    expect(container.querySelectorAll("span.rounded-full")).toHaveLength(2);
  });

  it("is not offered when nothing is flagged", () => {
    render(<TableView data={table(["name", "score"], ROWS)} title="T" />);
    expect(screen.queryByRole("button", { name: "Flagged only" })).not.toBeInTheDocument();
  });
});

describe("status badges", () => {
  it("dresses a known outcome word and leaves other text bare", () => {
    render(
      <TableView
        data={table(["name", "decision"], [["a", "approved"], ["b", "Pending"], ["c", "teal"]])}
        title="T"
      />,
    );
    expect(screen.getByText("approved").tagName).toBe("SPAN");
    expect(screen.getByText("Pending").tagName).toBe("SPAN");
    expect(screen.getByText("teal").tagName).toBe("TD");
  });
});
