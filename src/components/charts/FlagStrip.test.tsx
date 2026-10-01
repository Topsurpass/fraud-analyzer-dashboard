import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FlagOutcome } from "@/contracts/api";
import { FlagStrip } from "./FlagStrip";
import { ChartTooltip } from "./ChartTooltip";

const flags = (rules: FlagOutcome["rules"]): FlagOutcome => ({
  flagged_count: rules.reduce((sum, rule) => sum + rule.matched, 0),
  rows: [],
  rules,
  warnings: [],
  dismissed_count: 0,
});

describe("FlagStrip", () => {
  it("renders nothing when no rule matched, including rules that caught zero rows", () => {
    const { container, rerender } = render(<FlagStrip flags={undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<FlagStrip flags={flags([{ id: "a", name: "Quiet", severity: "high", matched: 0 }])} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names each matching rule with its count and severity, worst first", () => {
    render(
      <FlagStrip
        flags={flags([
          { id: "a", name: "Velocity", severity: "low", matched: 3 },
          { id: "b", name: "Big transfer", severity: "high", matched: 12 },
          { id: "c", name: "Silent", severity: "medium", matched: 0 },
        ])}
      />,
    );
    const items = within(screen.getByRole("list", { name: "Flag rules that matched" })).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Big transfer");
    expect(items[0]).toHaveTextContent("12");
    // Severity in words, never colour alone.
    expect(items[0]).toHaveTextContent("high severity");
    expect(items[1]).toHaveTextContent("Velocity");
    expect(screen.queryByText("Silent")).not.toBeInTheDocument();
  });

  it("uses the singular for one row", () => {
    render(<FlagStrip flags={flags([{ id: "a", name: "Spike", severity: "medium", matched: 1 }])} />);
    expect(screen.getByRole("listitem")).toHaveAttribute("title", "Spike: 1 row, medium severity");
  });
});

describe("ChartTooltip flag detail", () => {
  it("names the rule and its severity under a flagged reading", () => {
    render(
      <ChartTooltip
        label="10:00"
        entries={[
          {
            name: "amount",
            value: 900,
            color: "#6366f1",
            alert: true,
            flag: { rules: ["Big transfer", "Velocity"], severity: "high" },
          },
        ]}
      />,
    );
    expect(screen.getByText("Flagged")).toBeInTheDocument();
    expect(screen.getByText("Big transfer")).toBeInTheDocument();
    expect(screen.getByText("Velocity")).toBeInTheDocument();
    // Severity is per mark, so it is shown once (the worst), not beside each rule.
    expect(screen.getAllByText("high")).toHaveLength(1);
  });

  it("says nothing about flags on an unflagged reading", () => {
    render(
      <ChartTooltip
        label="09:00"
        entries={[{ name: "amount", value: 10, color: "#6366f1", alert: false }]}
      />,
    );
    expect(screen.queryByText("Flagged")).not.toBeInTheDocument();
  });
});
