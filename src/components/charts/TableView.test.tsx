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

  it("marks flagged rows and reports how many, naming the rule", () => {
    const { container } = render(
      <TableView
        data={ruleTable(
          ["id", "amount"],
          [[1, 10], [2, 900], [3, 950]],
          {
            flagged_count: 2,
            rows: [
              { index: 1, rule_ids: ["r1"] },
              { index: 2, rule_ids: ["r1"] },
            ],
            rules: [{ ...LARGE, matched: 2 }],
            warnings: [],
          },
        )}
        title="T"
      />,
    );
    expect(footerOf(container)).toHaveTextContent("2 flagged rows by Large transfer");

    // The accessible name carries the same fact for screen readers.
    expect(screen.getByRole("table")).toHaveAccessibleName(/2 flagged rows/);

    // And the rows themselves carry a left rule, so it is not text-only. The
    // rule rather than a row tint: a tinted row makes its own values harder to
    // read, which is the opposite of what marking it was for.
    const marked = screen
      .getAllByRole("row")
      .filter((row) => row.querySelector(".bg-alert") !== null);
    expect(marked).toHaveLength(2);
  });

  it("flags nothing at all when the query has no rules", () => {
    // The column is called is_flagged and every value in it is 1. Nothing is
    // marked, because no rule said to. The app does not guess any more.
    const { container } = render(
      <TableView data={table(["id", "is_flagged"], [[1, 1], [2, 1]])} title="T" />,
    );
    expect(container.querySelectorAll("span.rounded-full")).toHaveLength(0);
    expect(container.querySelector("p.border-t")).toBeNull();
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

/**
 * Flag-rule marking.
 *
 * The first version of this marker was a `block h-full` span inside a table
 * cell. A span has no height to fill, so it painted nothing at all and the only
 * evidence a row was flagged was the sentence in the footer. Every test here
 * asserts something a user can actually perceive.
 */

import type { FlagOutcome } from "@/contracts/api";

function ruleTable(columns: string[], rows: Row[], flags: FlagOutcome) {
  return buildTable({
    columns,
    rows,
    chart: { type: "table", x_field: null, y_field: null, series_field: null, warnings: [] },
    flags,
  });
}

const LARGE = { id: "r1", name: "Large transfer", severity: "high" as const, matched: 1 };

/**
 * The visible summary line under the table.
 *
 * The <caption> states the same count for screen readers and every marker cell
 * carries its own "Flagged by ..." text, so a bare text query for /flagged/
 * matches three different things. Asking for the footer by position keeps each
 * assertion about the one element it means.
 */
function footerOf(container: HTMLElement): HTMLElement {
  const footer = container.querySelector("p.border-t");
  if (!footer) throw new Error("TableView rendered no summary footer");
  return footer as HTMLElement;
}

describe("TableView flag rules", () => {
  it("marks a flagged row with something that has real dimensions", () => {
    const { container } = render(
      <TableView
        data={ruleTable(
          ["amount"],
          [[10], [900]],
          { flagged_count: 1, rows: [{ index: 1, rule_ids: ["r1"] }], rules: [LARGE], warnings: [] },
        )}
        title="T"
      />,
    );
    const dots = container.querySelectorAll("span.rounded-full");
    expect(dots).toHaveLength(1);
    // h-full on a span is the bug this guards: it must carry its own size.
    expect(dots[0].className).toMatch(/\bh-2\b/);
    expect(dots[0].className).not.toMatch(/h-full/);
  });

  it("names the rule where a screen reader and a hover can both reach it", () => {
    render(
      <TableView
        data={ruleTable(
          ["amount"],
          [[900]],
          { flagged_count: 1, rows: [{ index: 0, rule_ids: ["r1"] }], rules: [LARGE], warnings: [] },
        )}
        title="T"
      />,
    );
    expect(screen.getByText("Flagged by Large transfer")).toBeInTheDocument();
  });

  it("still marks every row when an explicit rule matches all of them", () => {
    // Marks used to be suppressed when everything matched, which made sense
    // while a flag could be guessed from a column name. A rule the analyst
    // wrote is different: showing nothing reads as a failed save.
    const { container } = render(
      <TableView
        data={ruleTable(
          ["amount"],
          [[900], [950]],
          {
            flagged_count: 2,
            rows: [
              { index: 0, rule_ids: ["r1"] },
              { index: 1, rule_ids: ["r1"] },
            ],
            rules: [{ ...LARGE, matched: 2 }],
            warnings: [],
          },
        )}
        title="T"
      />,
    );
    expect(container.querySelectorAll("span.rounded-full")).toHaveLength(2);
    expect(footerOf(container)).toHaveTextContent("2 flagged rows by Large transfer");
  });

  it("names the rules in the footer rather than a column name", () => {
    const { container } = render(
      <TableView
        data={ruleTable(
          ["amount"],
          [[10], [900]],
          { flagged_count: 1, rows: [{ index: 1, rule_ids: ["r1"] }], rules: [LARGE], warnings: [] },
        )}
        title="T"
      />,
    );
    // "by amount" would be the heuristic's answer. The rule the analyst wrote
    // is the useful one, and it is the only thing named here.
    expect(footerOf(container)).toHaveTextContent("1 flagged row by Large transfer");
    expect(footerOf(container).textContent).not.toMatch(/amount/);
  });

  it("marks nothing when no row is flagged", () => {
    const { container } = render(
      <TableView
        data={ruleTable(["amount"], [[10], [20]], {
          flagged_count: 0,
          rows: [],
          rules: [{ ...LARGE, matched: 0 }],
          warnings: [],
        })}
        title="T"
      />,
    );
    expect(container.querySelectorAll("span.rounded-full")).toHaveLength(0);
  });
});
