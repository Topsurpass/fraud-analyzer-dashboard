import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildTable } from "@/services/charts/shape";
import type { Row } from "@/contracts/api";
import { TableView } from "./TableView";

function table(columns: string[], rows: Row[]) {
  return buildTable({
    columns,
    rows,
    chart: { type: "table", x_field: null, y_field: null, series_field: null, warnings: [] },
  });
}

describe("TableView", () => {
  it("renders the result set verbatim, uncompacted", () => {
    render(
      <TableView
        data={table(["id", "amount"], [[1, 1234567], [2, 8]])}
        title="Highest-risk"
      />,
    );
    // The audit view must not abbreviate 1,234,567 to 1.2M.
    expect(screen.getByText("1,234,567")).toBeInTheDocument();
  });

  it("spells out NULL instead of leaving a blank cell", () => {
    render(<TableView data={table(["merchant"], [[null]])} title="T" />);
    expect(screen.getByText("NULL")).toBeInTheDocument();
  });

  it("right-aligns numeric columns and left-aligns the rest", () => {
    render(
      <TableView
        data={table(["merchant", "amount"], [["Northwind", 10], ["Kestrel", 3]])}
        title="T"
      />,
    );
    expect(screen.getByText("Northwind")).toHaveClass("text-left");
    expect(screen.getByText("10")).toHaveClass("text-right");
  });

  it("marks flagged rows and reports how many, with the column that decided", () => {
    render(
      <TableView
        data={table(["id", "is_flagged"], [[1, 0], [2, 1], [3, 1]])}
        title="T"
      />,
    );
    // The visible footer names the count and the column that decided it.
    const footer = screen.getByText(/flagged\s+rows\s+by is_flagged/);
    expect(footer).toHaveTextContent("2 flagged rows by is_flagged");

    // The accessible name carries the same fact for screen readers.
    expect(screen.getByRole("table")).toHaveAccessibleName(/2 flagged rows/);

    // And the rows themselves are marked, so it is not text-only.
    const flaggedRows = screen
      .getAllByRole("row")
      .filter((row) => row.className.includes("signal-alert-dim"));
    expect(flaggedRows).toHaveLength(2);
  });

  it("does not claim any flagged rows when the data is clean", () => {
    render(<TableView data={table(["id", "is_flagged"], [[1, 0], [2, 0]])} title="T" />);
    expect(screen.queryByText(/flagged row/)).not.toBeInTheDocument();
  });

  it("gives the table an accessible name from the query", () => {
    render(<TableView data={table(["id"], [[1]])} title="Highest-risk transactions" />);
    expect(screen.getByRole("table", { name: /Highest-risk transactions/ })).toBeInTheDocument();
  });

  it("says so when the query returned no rows", () => {
    render(<TableView data={table(["id", "amount"], [])} title="T" />);
    expect(screen.getByText("No rows returned.")).toBeInTheDocument();
  });

  it("says so when the query returned no columns at all", () => {
    render(<TableView data={table([], [])} title="T" />);
    expect(screen.getByText("The query returned no columns.")).toBeInTheDocument();
  });

  it("keeps every column header in the header row", () => {
    render(<TableView data={table(["id", "country", "amount"], [[1, "NG", 5]])} title="T" />);
    const header = screen.getAllByRole("row")[0];
    for (const name of ["id", "country", "amount"]) {
      expect(within(header).getByText(name)).toBeInTheDocument();
    }
  });
});
