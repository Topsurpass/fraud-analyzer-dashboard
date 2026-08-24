import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FlagRule } from "@/contracts/api";
import {
  FlagRuleEditor,
  emptyRule,
  takesNoValue,
  takesTwoValues,
  validateRules,
} from "./FlagRuleEditor";

function rule(overrides: Partial<FlagRule> = {}): FlagRule {
  return {
    name: "Large",
    severity: "high",
    enabled: true,
    conditions: [{ column_name: "amount", operator: "gt", value: "500" }],
    ...overrides,
  };
}

describe("operator arity", () => {
  it("knows which operators read no value", () => {
    expect(takesNoValue("is_null")).toBe(true);
    expect(takesNoValue("is_not_null")).toBe(true);
    expect(takesNoValue("gt")).toBe(false);
  });

  it("knows which operators need two", () => {
    expect(takesTwoValues("between")).toBe(true);
    expect(takesTwoValues("gt")).toBe(false);
  });
});

describe("validateRules", () => {
  it("accepts a well-formed rule", () => {
    expect(validateRules([rule()]).size).toBe(0);
  });

  it("requires a name", () => {
    const problems = validateRules([rule({ name: "  " })]);
    expect(problems.get("rule:0")).toMatch(/needs a name/i);
  });

  it("catches duplicate names case-insensitively, matching the engine", () => {
    const problems = validateRules([rule({ name: "Large" }), rule({ name: "large" })]);
    expect(problems.get("rule:1")).toMatch(/already called/i);
    // The first one is fine; only the collision is reported.
    expect(problems.has("rule:0")).toBe(false);
  });

  it("requires at least one condition", () => {
    const problems = validateRules([rule({ conditions: [] })]);
    expect(problems.get("rule:0")).toMatch(/at least one condition/i);
  });

  it("requires a column", () => {
    const problems = validateRules([
      rule({ conditions: [{ column_name: "", operator: "gt", value: "1" }] }),
    ]);
    expect(problems.get("cond:0:0")).toMatch(/pick a column/i);
  });

  it("requires a value for operators that read one", () => {
    const problems = validateRules([
      rule({ conditions: [{ column_name: "amount", operator: "gt", value: "" }] }),
    ]);
    expect(problems.get("cond:0:0")).toMatch(/needs a value/i);
  });

  it("does not require a value for is_null", () => {
    const problems = validateRules([
      rule({ conditions: [{ column_name: "comment", operator: "is_null" }] }),
    ]);
    expect(problems.size).toBe(0);
  });

  it("requires both bounds for between", () => {
    const problems = validateRules([
      rule({
        conditions: [{ column_name: "amount", operator: "between", value: "100" }],
      }),
    ]);
    expect(problems.get("cond:0:0")).toMatch(/both bounds/i);
  });

  it("reports a problem per condition, not per rule", () => {
    const problems = validateRules([
      rule({
        conditions: [
          { column_name: "amount", operator: "gt", value: "1" },
          { column_name: "", operator: "gt", value: "1" },
        ],
      }),
    ]);
    expect(problems.has("cond:0:0")).toBe(false);
    expect(problems.has("cond:0:1")).toBe(true);
  });
});

describe("FlagRuleEditor", () => {
  it("explains the any/all semantics, which nothing else can tell the user", () => {
    render(<FlagRuleEditor rules={[]} onChange={() => {}} columns={[]} />);
    const blurb = screen.getByText(/A row is flagged when/i);
    expect(blurb.textContent).toMatch(/any/);
    expect(blurb.textContent).toMatch(/all/);
  });

  it("says that no rules means nothing is flagged", () => {
    // The app used to guess here. Saying so plainly matters: an empty editor
    // must not read as "the defaults will handle it".
    render(<FlagRuleEditor rules={[]} onChange={() => {}} columns={[]} />);
    expect(screen.getByText(/nothing on this query will be flagged/i)).toBeInTheDocument();
  });

  it("adds a rule seeded with the first preview column", async () => {
    const onChange = vi.fn();
    render(
      <FlagRuleEditor rules={[]} onChange={onChange} columns={["day", "amount"]} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /add rule/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [next] = onChange.mock.calls[0] as [FlagRule[]];
    expect(next[0].conditions[0].column_name).toBe("day");
  });

  it("offers the preview columns as a dropdown", () => {
    render(
      <FlagRuleEditor rules={[rule()]} onChange={() => {}} columns={["day", "amount"]} />,
    );
    const select = screen.getByLabelText("Column") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toContain("amount");
  });

  it("falls back to free text before a preview has run", () => {
    // A rule is legitimately written before the query has ever executed.
    render(<FlagRuleEditor rules={[rule()]} onChange={() => {}} columns={[]} />);
    expect((screen.getByLabelText("Column") as HTMLElement).tagName).toBe("INPUT");
  });

  it("keeps a column the result no longer returns, marked as missing", () => {
    // Editing the SELECT list must not silently rewrite the rule to a
    // different column the user never chose.
    render(
      <FlagRuleEditor
        rules={[rule({ conditions: [{ column_name: "gone", operator: "gt", value: "1" }] })]}
        onChange={() => {}}
        columns={["day", "amount"]}
      />,
    );
    const select = screen.getByLabelText("Column") as HTMLSelectElement;
    expect(select.value).toBe("gone");
    expect(screen.getByRole("option", { name: /gone \(not in result\)/i })).toBeTruthy();
  });

  it("hides the value input for operators that read none", () => {
    render(
      <FlagRuleEditor
        rules={[rule({ conditions: [{ column_name: "comment", operator: "is_null" }] })]}
        onChange={() => {}}
        columns={["comment"]}
      />,
    );
    expect(screen.queryByLabelText("Value")).toBeNull();
  });

  it("shows a second input only for between", () => {
    const { rerender } = render(
      <FlagRuleEditor rules={[rule()]} onChange={() => {}} columns={["amount"]} />,
    );
    expect(screen.queryByLabelText("Upper bound")).toBeNull();

    rerender(
      <FlagRuleEditor
        rules={[
          rule({
            conditions: [
              { column_name: "amount", operator: "between", value: "1", value2: "9" },
            ],
          }),
        ]}
        onChange={() => {}}
        columns={["amount"]}
      />,
    );
    expect(screen.getByLabelText("Upper bound")).toBeInTheDocument();
  });

  it("clears the stale bound when the operator stops reading it", async () => {
    // Switching between -> greater than and back must not resurrect an upper
    // bound the user cannot see and did not re-enter.
    const onChange = vi.fn();
    render(
      <FlagRuleEditor
        rules={[
          rule({
            conditions: [
              { column_name: "amount", operator: "between", value: "1", value2: "9" },
            ],
          }),
        ]}
        onChange={onChange}
        columns={["amount"]}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("Comparison"), "gt");
    const [next] = onChange.mock.calls[0] as [FlagRule[]];
    expect(next[0].conditions[0].value2).toBe("");
    expect(next[0].conditions[0].value).toBe("1");
  });

  it("clears both values when switching to an operator that reads none", async () => {
    const onChange = vi.fn();
    render(
      <FlagRuleEditor rules={[rule()]} onChange={onChange} columns={["amount"]} />,
    );
    await userEvent.selectOptions(screen.getByLabelText("Comparison"), "is_null");
    const [next] = onChange.mock.calls[0] as [FlagRule[]];
    expect(next[0].conditions[0].value).toBe("");
    expect(next[0].conditions[0].value2).toBe("");
  });

  it("joins conditions with a visible AND", () => {
    render(
      <FlagRuleEditor
        rules={[
          rule({
            conditions: [
              { column_name: "amount", operator: "gt", value: "500" },
              { column_name: "day", operator: "gte", value: "2026-08-20" },
            ],
          }),
        ]}
        onChange={() => {}}
        columns={["amount", "day"]}
      />,
    );
    expect(screen.getAllByText("and").length).toBeGreaterThan(0);
  });

  it("offers no remove button for a lone condition", () => {
    render(<FlagRuleEditor rules={[rule()]} onChange={() => {}} columns={["amount"]} />);
    expect(screen.queryByRole("button", { name: /remove condition/i })).toBeNull();
  });

  it("clears every rule at once, but only on a second press", async () => {
    // Removing one rule is obvious to undo by retyping it; removing eight is
    // not, and the control sits beside "Add rule" where a misclick is cheap.
    const onChange = vi.fn();
    render(
      <FlagRuleEditor
        rules={[rule({ name: "One" }), rule({ name: "Two" })]}
        onChange={onChange}
        columns={["amount"]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^remove all$/i }));
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /remove all 2/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("lets the clear be called off", async () => {
    const onChange = vi.fn();
    render(<FlagRuleEditor rules={[rule()]} onChange={onChange} columns={["amount"]} />);
    await userEvent.click(screen.getByRole("button", { name: /^remove all$/i }));
    await userEvent.click(screen.getByRole("button", { name: /keep/i }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^remove all$/i })).toBeInTheDocument();
  });

  it("offers no clear when there is nothing to clear", () => {
    render(<FlagRuleEditor rules={[]} onChange={() => {}} columns={[]} />);
    expect(screen.queryByRole("button", { name: /remove all/i })).toBeNull();
  });

  it("removes a rule", async () => {
    const onChange = vi.fn();
    render(
      <FlagRuleEditor
        rules={[rule({ name: "One" }), rule({ name: "Two" })]}
        onChange={onChange}
        columns={["amount"]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /remove rule one/i }));
    const [next] = onChange.mock.calls[0] as [FlagRule[]];
    expect(next.map((r) => r.name)).toEqual(["Two"]);
  });

  it("shows how many rows a rule caught in the preview", () => {
    render(
      <FlagRuleEditor
        rules={[rule()]}
        onChange={() => {}}
        columns={["amount"]}
        matchCounts={new Map([[0, 7]])}
      />,
    );
    expect(screen.getByText("7 in preview")).toBeInTheDocument();
  });

  it("disables every control while a save is in flight", () => {
    render(
      <FlagRuleEditor rules={[rule()]} onChange={() => {}} columns={["amount"]} disabled />,
    );
    expect(screen.getByRole("button", { name: /add rule/i })).toBeDisabled();
    expect(screen.getByLabelText("Comparison")).toBeDisabled();
  });

  it("names new rules distinctly so they do not collide on save", () => {
    expect(emptyRule(0).name).not.toBe(emptyRule(1).name);
    // Two fresh rules still need columns picked, which is a per-condition
    // problem. What must not appear is a name collision between them.
    const problems = validateRules([emptyRule(0, "amount"), emptyRule(1, "amount")]);
    expect([...problems.keys()].filter((key) => key.startsWith("rule:"))).toEqual([]);
    expect(problems.size).toBe(2);
    expect(problems.get("cond:0:0")).toMatch(/needs a value/i);
  });
});
