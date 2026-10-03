import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FlagRule, ItemListSummary } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import {
  FlagRuleEditor,
  emptyRule,
  takesList,
  takesNoValue,
  takesTwoValues,
  validateRules,
} from "./FlagRuleEditor";

function summary(over: Partial<ItemListSummary> = {}): ItemListSummary {
  return {
    id: "l1",
    name: "Blocked terminals",
    description: null,
    item_count: 12,
    rule_count: 0,
    created_by: "u1",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

// The picker reads the shell's shared list load; the shell is not under test.
const listsState = vi.hoisted(() => ({
  current: { lists: [], loading: false, initial: false, error: null, reload: () => {} } as {
    lists: ItemListSummary[];
    loading: boolean;
    initial: boolean;
    error: ApiError | null;
    reload: () => void;
  },
}));

vi.mock("@/lib/ListsContext", () => ({ useLists: () => listsState.current }));

beforeEach(() => {
  listsState.current = {
    lists: [summary(), summary({ id: "l2", name: "Watchlist", item_count: 400 })],
    loading: false,
    initial: false,
    error: null,
    reload: () => {},
  };
});


/**
 * A rule is one collapsed line until it is opened, so a test that wants to touch
 * its fields has to open it the way a person does: by pressing its line. Sync, so
 * the tests that were sync stay sync.
 */
function openRule(index = 0) {
  const lines = screen.queryAllByRole("button", { name: /^(Edit|Close) rule / });
  if (lines[index] && lines[index].getAttribute("aria-expanded") === "false") fireEvent.click(lines[index]);
}

function renderOpen(ui: React.ReactElement, index = 0) {
  const view = render(ui);
  openRule(index);
  return view;
}

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
    renderOpen(<FlagRuleEditor rules={[]} onChange={() => {}} columns={[]} />);
    const blurb = screen.getByText(/A row is flagged when/i);
    expect(blurb.textContent).toMatch(/any/);
    expect(blurb.textContent).toMatch(/all/);
  });

  it("says that no rules means nothing is flagged", () => {
    // The app used to guess here. Saying so plainly matters: an empty editor
    // must not read as "the defaults will handle it".
    renderOpen(<FlagRuleEditor rules={[]} onChange={() => {}} columns={[]} />);
    expect(screen.getByText(/nothing on this query will be flagged/i)).toBeInTheDocument();
  });

  it("adds a rule with no column chosen, so one has to be picked", async () => {
    // Regression: it used to seed the first result column. That put a real
    // column name in the field before anyone had chosen anything, so a rule
    // built by setting only the comparison and the value silently tested
    // whichever column came first - it evaluated cleanly, matched nothing, and
    // nothing on screen suggested the column was the problem.
    const onChange = vi.fn();
    renderOpen(
      <FlagRuleEditor rules={[]} onChange={onChange} columns={["day", "amount"]} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /add rule/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [next] = onChange.mock.calls[0] as [FlagRule[]];
    expect(next[0].conditions[0].column_name).toBe("");
    // And the editor refuses to let it save that way.
    expect(validateRules(next).get("cond:0:0")).toMatch(/pick a column/i);
  });

  it("offers the preview columns as a dropdown", () => {
    renderOpen(
      <FlagRuleEditor rules={[rule()]} onChange={() => {}} columns={["day", "amount"]} />,
    );
    const select = screen.getByLabelText("Column") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toContain("amount");
  });

  it("falls back to free text before a preview has run", () => {
    // A rule is legitimately written before the query has ever executed.
    renderOpen(<FlagRuleEditor rules={[rule()]} onChange={() => {}} columns={[]} />);
    expect((screen.getByLabelText("Column") as HTMLElement).tagName).toBe("INPUT");
  });

  it("keeps a column the result no longer returns, marked as missing", () => {
    // Editing the SELECT list must not silently rewrite the rule to a
    // different column the user never chose.
    renderOpen(
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
    renderOpen(
      <FlagRuleEditor
        rules={[rule({ conditions: [{ column_name: "comment", operator: "is_null" }] })]}
        onChange={() => {}}
        columns={["comment"]}
      />,
    );
    expect(screen.queryByLabelText("Value")).toBeNull();
  });

  it("shows a second input only for between", () => {
    const { rerender } = renderOpen(
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
    renderOpen(
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
    renderOpen(
      <FlagRuleEditor rules={[rule()]} onChange={onChange} columns={["amount"]} />,
    );
    await userEvent.selectOptions(screen.getByLabelText("Comparison"), "is_null");
    const [next] = onChange.mock.calls[0] as [FlagRule[]];
    expect(next[0].conditions[0].value).toBe("");
    expect(next[0].conditions[0].value2).toBe("");
  });

  it("joins conditions with a visible AND", () => {
    renderOpen(
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
    renderOpen(<FlagRuleEditor rules={[rule()]} onChange={() => {}} columns={["amount"]} />);
    expect(screen.queryByRole("button", { name: /remove condition/i })).toBeNull();
  });

  it("clears every rule at once, but only on a second press", async () => {
    // Removing one rule is obvious to undo by retyping it; removing eight is
    // not, and the control sits beside "Add rule" where a misclick is cheap.
    const onChange = vi.fn();
    renderOpen(
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
    renderOpen(<FlagRuleEditor rules={[rule()]} onChange={onChange} columns={["amount"]} />);
    await userEvent.click(screen.getByRole("button", { name: /^remove all$/i }));
    await userEvent.click(screen.getByRole("button", { name: /keep/i }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^remove all$/i })).toBeInTheDocument();
  });

  it("offers no clear when there is nothing to clear", () => {
    renderOpen(<FlagRuleEditor rules={[]} onChange={() => {}} columns={[]} />);
    expect(screen.queryByRole("button", { name: /remove all/i })).toBeNull();
  });

  it("removes a rule", async () => {
    const onChange = vi.fn();
    renderOpen(
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
    renderOpen(
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
    renderOpen(
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

describe("list operators", () => {
  const listRule = (over: Partial<FlagRule["conditions"][number]> = {}) =>
    rule({
      conditions: [{ column_name: "terminal", operator: "in_list", list_id: "l1", ...over }],
    });

  it("knows which operators take a list", () => {
    expect(takesList("in_list")).toBe(true);
    expect(takesList("not_in_list")).toBe(true);
    expect(takesList("in")).toBe(false);
    expect(takesList("is_null")).toBe(false);
  });

  it("requires a list to be picked", () => {
    const problems = validateRules([listRule({ list_id: null })]);
    expect(problems.get("cond:0:0")).toBe("Pick a list.");
    expect(validateRules([listRule({ list_id: "" })]).get("cond:0:0")).toBe("Pick a list.");
  });

  it("does not ask for a typed value once a list is picked", () => {
    expect(validateRules([listRule()]).size).toBe(0);
    expect(validateRules([listRule({ operator: "not_in_list" })]).size).toBe(0);
  });

  it("still asks for a column first", () => {
    const problems = validateRules([listRule({ column_name: "" })]);
    expect(problems.get("cond:0:0")).toMatch(/pick a column/i);
  });

  it("shows a list picker in place of the value input", () => {
    renderOpen(<FlagRuleEditor rules={[listRule()]} onChange={() => {}} columns={["terminal"]} />);
    const picker = screen.getByLabelText("List") as HTMLSelectElement;
    expect(picker.value).toBe("l1");
    expect(screen.queryByLabelText("Value")).toBeNull();
    expect(screen.getByRole("option", { name: "Watchlist (400)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /manage lists/i })).toHaveAttribute("href", "/lists");
  });

  it("shows no picker for a plain comparison", () => {
    renderOpen(<FlagRuleEditor rules={[rule()]} onChange={() => {}} columns={["amount"]} />);
    expect(screen.queryByLabelText("List")).toBeNull();
    expect(screen.getByLabelText("Value")).toBeInTheDocument();
  });

  it("sets list_id when a list is chosen, and clears it when unchosen", async () => {
    const onChange = vi.fn();
    renderOpen(
      <FlagRuleEditor
        rules={[listRule({ list_id: null })]}
        onChange={onChange}
        columns={["terminal"]}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("List"), "l2");
    expect((onChange.mock.calls[0][0] as FlagRule[])[0].conditions[0].list_id).toBe("l2");
  });

  it("clears typed values when switching to a list operator", async () => {
    const onChange = vi.fn();
    renderOpen(
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
    await userEvent.selectOptions(screen.getByLabelText("Comparison"), "in_list");
    const condition = (onChange.mock.calls[0][0] as FlagRule[])[0].conditions[0];
    expect(condition.operator).toBe("in_list");
    expect(condition.value).toBe("");
    expect(condition.value2).toBe("");
  });

  it("clears the list when switching to an operator that ignores it", async () => {
    const onChange = vi.fn();
    renderOpen(<FlagRuleEditor rules={[listRule()]} onChange={onChange} columns={["terminal"]} />);
    await userEvent.selectOptions(screen.getByLabelText("Comparison"), "eq");
    const condition = (onChange.mock.calls[0][0] as FlagRule[])[0].conditions[0];
    expect(condition.operator).toBe("eq");
    expect(condition.list_id).toBeNull();
  });

  it("keeps the list when flipping between in-list and not-in-list", async () => {
    const onChange = vi.fn();
    renderOpen(<FlagRuleEditor rules={[listRule()]} onChange={onChange} columns={["terminal"]} />);
    await userEvent.selectOptions(screen.getByLabelText("Comparison"), "not_in_list");
    const condition = (onChange.mock.calls[0][0] as FlagRule[])[0].conditions[0];
    expect(condition.operator).toBe("not_in_list");
    expect(condition.list_id).toBe("l1");
  });

  it("keeps a list that is not in the loaded set, marked as removed", () => {
    // Rewriting it to "no list" would silently drop the condition's target.
    renderOpen(
      <FlagRuleEditor
        rules={[listRule({ list_id: "gone" })]}
        onChange={() => {}}
        columns={["terminal"]}
      />,
    );
    const picker = screen.getByLabelText("List") as HTMLSelectElement;
    expect(picker.value).toBe("gone");
    expect(screen.getByRole("option", { name: /unknown list \(removed\)/i })).toBeInTheDocument();
  });

  it("does not call a list removed while the lists are still loading", () => {
    listsState.current = { ...listsState.current, lists: [], initial: true };
    renderOpen(
      <FlagRuleEditor rules={[listRule()]} onChange={() => {}} columns={["terminal"]} />,
    );
    expect(screen.queryByRole("option", { name: /removed/i })).toBeNull();
    expect(screen.getByRole("option", { name: "Loading…" })).toBeInTheDocument();
  });

  it("disables the picker while a save is in flight", () => {
    renderOpen(
      <FlagRuleEditor rules={[listRule()]} onChange={() => {}} columns={["terminal"]} disabled />,
    );
    expect(screen.getByLabelText("List")).toBeDisabled();
  });

  it("opens Manage lists in a new tab so unsaved rules are not lost", () => {
    renderOpen(<FlagRuleEditor rules={[listRule()]} onChange={() => {}} columns={["terminal"]} />);
    const link = screen.getByRole("link", { name: /manage lists/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link).toHaveTextContent(/new tab/i);
  });

  it("offers Refresh only after Manage lists was followed", async () => {
    const reload = vi.fn();
    listsState.current = { ...listsState.current, reload };
    renderOpen(<FlagRuleEditor rules={[listRule()]} onChange={() => {}} columns={["terminal"]} />);
    expect(screen.queryByRole("button", { name: /refresh lists/i })).toBeNull();

    // jsdom does not navigate a _blank link; the click is what matters.
    await userEvent.click(screen.getByRole("link", { name: /manage lists/i }));
    await userEvent.click(screen.getByRole("button", { name: /refresh lists/i }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows Manage lists once per rule, however many list conditions it has", () => {
    renderOpen(
      <FlagRuleEditor
        rules={[
          rule({
            name: "A",
            conditions: [
              { column_name: "terminal", operator: "in_list", list_id: "l1" },
              { column_name: "account", operator: "not_in_list", list_id: "l2" },
              { column_name: "amount", operator: "gt", value: "1" },
            ],
          }),
          rule({
            name: "B",
            conditions: [{ column_name: "terminal", operator: "in_list", list_id: "l1" }],
          }),
          rule({ name: "C" }),
        ]}
        onChange={() => {}}
        columns={["terminal", "account", "amount"]}
      />,
    );
    // Only the open rule shows its editor, so each is looked at in turn: A has
    // two list conditions and one link, B has one of each, C has neither.
    expect(screen.getAllByLabelText("List")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /manage lists/i })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Edit rule B" }));
    expect(screen.getAllByLabelText("List")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /manage lists/i })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Edit rule C" }));
    expect(screen.queryAllByLabelText("List")).toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: /manage lists/i })).toHaveLength(0);
  });

  it("shows one load error per rule, not per condition, and no Refresh beside it", () => {
    listsState.current = {
      lists: [],
      loading: false,
      initial: false,
      error: new ApiError({ kind: "network", message: "x", url: "" }),
      reload: () => {},
    };
    renderOpen(
      <FlagRuleEditor
        rules={[
          rule({
            conditions: [
              { column_name: "terminal", operator: "in_list", list_id: "l1" },
              { column_name: "account", operator: "in_list", list_id: "l2" },
            ],
          }),
        ]}
        onChange={() => {}}
        columns={["terminal", "account"]}
      />,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /refresh lists/i })).toBeNull();
  });

  it("says lists failed to load, with a retry, and does not call a list removed", async () => {
    const reload = vi.fn();
    listsState.current = {
      lists: [],
      loading: false,
      initial: false,
      error: new ApiError({ kind: "network", message: "x", url: "" }),
      reload,
    };
    renderOpen(
      <FlagRuleEditor rules={[listRule()]} onChange={() => {}} columns={["terminal"]} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load lists/i);
    expect(screen.getByRole("option", { name: "Not loaded" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /removed/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ties 'Pick a list.' to the picker with aria-describedby", () => {
    renderOpen(
      <FlagRuleEditor
        rules={[listRule({ list_id: null })]}
        onChange={() => {}}
        columns={["terminal"]}
      />,
    );
    const picker = screen.getByLabelText("List");
    const id = picker.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)).toHaveTextContent("Pick a list.");
  });

  it("ties 'Pick a column.' to the column control the same way", () => {
    renderOpen(
      <FlagRuleEditor
        rules={[rule({ conditions: [{ column_name: "", operator: "gt", value: "1" }] })]}
        onChange={() => {}}
        columns={["amount"]}
      />,
    );
    const id = screen.getByLabelText("Column").getAttribute("aria-describedby");
    expect(document.getElementById(id as string)).toHaveTextContent("Pick a column.");
  });

  it("sets no description when the condition is fine", () => {
    renderOpen(<FlagRuleEditor rules={[listRule()]} onChange={() => {}} columns={["terminal"]} />);
    expect(screen.getByLabelText("List")).not.toHaveAttribute("aria-describedby");
  });

  it("asks the engine once before calling an unknown list removed", () => {
    const reload = vi.fn();
    listsState.current = { ...listsState.current, reload };
    const { rerender } = renderOpen(
      <FlagRuleEditor rules={[listRule({ list_id: "new" })]} onChange={() => {}} columns={["terminal"]} />,
    );
    expect(reload).toHaveBeenCalledTimes(1);

    // Still missing after the reload: now it is fair to say so, and no more asking.
    rerender(
      <FlagRuleEditor rules={[listRule({ list_id: "new" })]} onChange={() => {}} columns={["terminal"]} />,
    );
    rerender(
      <FlagRuleEditor rules={[listRule({ list_id: "new" }), rule()]} onChange={() => {}} columns={["terminal"]} />,
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("option", { name: /unknown list \(removed\)/i })).toBeInTheDocument();
  });

  it("shows Loading while that reload is in flight, never 'removed'", () => {
    listsState.current = { ...listsState.current, loading: true };
    renderOpen(
      <FlagRuleEditor rules={[listRule({ list_id: "new" })]} onChange={() => {}} columns={["terminal"]} />,
    );
    expect(screen.getByRole("option", { name: "Loading…" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /removed/i })).toBeNull();
  });

  it("does not reload when every referenced list is already loaded", () => {
    const reload = vi.fn();
    listsState.current = { ...listsState.current, reload };
    renderOpen(<FlagRuleEditor rules={[listRule()]} onChange={() => {}} columns={["terminal"]} />);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload for a rule with no list condition, or while lists are failing", () => {
    const reload = vi.fn();
    listsState.current = { ...listsState.current, reload };
    renderOpen(<FlagRuleEditor rules={[rule()]} onChange={() => {}} columns={["amount"]} />);
    expect(reload).not.toHaveBeenCalled();
  });

  it("uses the reloaded set to find a list made in another tab", () => {
    const reload = vi.fn();
    listsState.current = { ...listsState.current, reload };
    const { rerender } = renderOpen(
      <FlagRuleEditor rules={[listRule({ list_id: "l9" })]} onChange={() => {}} columns={["terminal"]} />,
    );
    listsState.current = {
      ...listsState.current,
      lists: [...listsState.current.lists, summary({ id: "l9", name: "Fresh", item_count: 4 })],
    };
    rerender(
      <FlagRuleEditor rules={[listRule({ list_id: "l9" })]} onChange={() => {}} columns={["terminal"]} />,
    );
    expect((screen.getByLabelText("List") as HTMLSelectElement).value).toBe("l9");
    expect(screen.queryByRole("option", { name: /removed/i })).toBeNull();
    expect(screen.getByRole("option", { name: "Fresh (4)" })).toBeInTheDocument();
  });
});
