import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FlagRule, ItemListSummary } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { describeRule } from "@/services/rules/describe";
import { FlagRuleEditor } from "./FlagRuleEditor";

/*
 * The redesign: a rule is one readable line until it is opened.
 *
 * These render the editor inside real state (a Harness), because focus moving to
 * the control a person just made, and a rule opening when it is added, only
 * happen when the rules actually change between renders. The older file,
 * FlagRuleEditor.test.tsx, holds the validation and operator behaviour, which is
 * unchanged.
 */

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

function Harness({
  initial,
  saved,
  onRules,
  columns = ["amount", "outcome", "terminal", "risk_score"],
  matchCounts,
}: {
  initial: FlagRule[];
  saved?: FlagRule[] | null;
  onRules?: (rules: FlagRule[]) => void;
  columns?: string[];
  matchCounts?: Map<number, number>;
}) {
  const [rules, setRules] = useState(initial);
  return (
    <FlagRuleEditor
      rules={rules}
      onChange={(next) => {
        setRules(next);
        onRules?.(next);
      }}
      columns={columns}
      savedRules={saved}
      matchCounts={matchCounts}
    />
  );
}

const two: FlagRule[] = [
  {
    name: "Very large transfer",
    severity: "high",
    enabled: true,
    conditions: [
      { column_name: "amount", operator: "gte", value: "300" },
      { column_name: "outcome", operator: "eq", value: "declined" },
    ],
  },
  {
    name: "Watchlist terminal",
    severity: "medium",
    enabled: true,
    conditions: [{ column_name: "terminal", operator: "in_list", list_id: "l1" }],
  },
];

const line = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^(Edit|Close) rule ${name}$`) });

describe("a collapsed rule", () => {
  it("is one line with its name, its severity and the sentence it stands for", () => {
    render(<Harness initial={two} />);
    const first = line("Very large transfer");
    expect(first).toHaveTextContent("high");
    expect(first).toHaveTextContent("Very large transfer");
    expect(first).toHaveTextContent("amount is at least 300 and outcome equals declined");
  });

  it("uses the one sentence function, so it can never read differently elsewhere", () => {
    render(<Harness initial={two} />);
    expect(line("Very large transfer").textContent).toContain(describeRule(two[0]));
  });

  it("names a list by its name from the loaded lists, never by its id", () => {
    render(<Harness initial={two} />);
    const second = line("Watchlist terminal");
    expect(second).toHaveTextContent("terminal is in the list “Blocked terminals”");
    expect(second.textContent).not.toContain("l1");
  });

  it("shows no field at all until it is opened", () => {
    render(<Harness initial={two} />);
    expect(screen.queryByLabelText("Rule name")).toBeNull();
    expect(screen.queryByLabelText("Column")).toBeNull();
    expect(screen.queryByLabelText("Comparison")).toBeNull();
    expect(screen.queryByLabelText("Severity")).toBeNull();
  });

  it("carries an on/off switch that reads as one", () => {
    render(<Harness initial={two} />);
    const sw = screen.getByRole("switch", { name: "Rule Very large transfer is on" });
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("switching it off writes enabled: false without opening the rule", async () => {
    const onRules = vi.fn();
    render(<Harness initial={two} onRules={onRules} />);
    await userEvent.click(screen.getByRole("switch", { name: "Rule Very large transfer is on" }));
    const [next] = onRules.mock.calls[0] as [FlagRule[]];
    expect(next[0].enabled).toBe(false);
    expect(next[1].enabled).toBe(true);
    expect(line("Very large transfer")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("switch", { name: "Rule Very large transfer is off" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("says when a rule is switched off", () => {
    render(<Harness initial={[{ ...two[0], enabled: false }]} />);
    expect(line("Very large transfer")).toHaveTextContent("switched off");
  });

  it("shows how many rows it caught in the preview", () => {
    render(<Harness initial={two} matchCounts={new Map([[0, 7]])} />);
    expect(line("Very large transfer")).toHaveTextContent("7 in preview");
  });

  it("disables the switch while a save is in flight", () => {
    render(<FlagRuleEditor rules={two} onChange={() => {}} columns={[]} disabled />);
    expect(screen.getByRole("switch", { name: /Very large transfer/ })).toBeDisabled();
  });

  it("keeps a long value from stretching the line", () => {
    render(
      <Harness
        initial={[
          {
            ...two[0],
            conditions: [{ column_name: "memo", operator: "contains", value: "q".repeat(500) }],
          },
        ]}
      />,
    );
    expect(line("Very large transfer").textContent!.length).toBeLessThan(200);
  });
});

describe("opening and closing", () => {
  it("opens on a click, and says so with aria-expanded", async () => {
    render(<Harness initial={two} />);
    expect(line("Very large transfer")).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(line("Very large transfer"));
    expect(line("Very large transfer")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Rule name")).toHaveValue("Very large transfer");
  });

  it("opens from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness initial={two} />);
    line("Very large transfer").focus();
    await user.keyboard("{Enter}");
    expect(line("Very large transfer")).toHaveAttribute("aria-expanded", "true");
    line("Watchlist terminal").focus();
    await user.keyboard(" ");
    expect(line("Watchlist terminal")).toHaveAttribute("aria-expanded", "true");
  });

  it("has only one rule open: opening another closes the first", async () => {
    render(<Harness initial={two} />);
    await userEvent.click(line("Very large transfer"));
    expect(screen.getAllByLabelText("Column")).toHaveLength(2);
    await userEvent.click(line("Watchlist terminal"));
    expect(line("Very large transfer")).toHaveAttribute("aria-expanded", "false");
    expect(line("Watchlist terminal")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByLabelText("Column")).toHaveLength(1);
    expect(screen.getAllByLabelText("Rule name")).toHaveLength(1);
  });

  it("closes on a second press of the line", async () => {
    render(<Harness initial={two} />);
    await userEvent.click(line("Very large transfer"));
    await userEvent.click(line("Very large transfer"));
    expect(screen.queryByLabelText("Rule name")).toBeNull();
  });

  it("puts focus in the name field when a rule opens", async () => {
    render(<Harness initial={two} />);
    await userEvent.click(line("Very large transfer"));
    expect(screen.getByLabelText("Rule name")).toHaveFocus();
  });

  it("does not select the name of a rule that already exists", async () => {
    // Selecting it would leave the name one keystroke from being replaced, for
    // someone who only opened the rule to look. Only a brand-new "Rule 3" is
    // selected, because that is there to be typed over.
    render(<Harness initial={two} />);
    await userEvent.click(line("Very large transfer"));
    const name = screen.getByLabelText("Rule name") as HTMLInputElement;
    expect(name).toHaveFocus();
    expect(name.selectionStart).toBe(name.selectionEnd);
  });

  it("Done closes it and gives focus back to its line", async () => {
    render(<Harness initial={two} />);
    await userEvent.click(line("Very large transfer"));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Rule name")).toBeNull();
    expect(line("Very large transfer")).toHaveFocus();
  });

  it("ties the line to the sentence it stands for, for a screen reader", () => {
    render(<Harness initial={two} />);
    const first = line("Very large transfer");
    const described = document.getElementById(first.getAttribute("aria-describedby")!);
    expect(described).toHaveTextContent("amount is at least 300 and outcome equals declined");
  });
});

describe("adding and removing", () => {
  it("opens a new rule at once and puts focus in its name, selected", async () => {
    render(<Harness initial={two} />);
    await userEvent.click(screen.getByRole("button", { name: "Add rule" }));
    const name = screen.getByLabelText("Rule name") as HTMLInputElement;
    expect(name).toHaveFocus();
    expect(name.value).toBe("Rule 3");
    expect(name.selectionStart).toBe(0);
    expect(name.selectionEnd).toBe(name.value.length);
    // And only that one is open.
    expect(line("Very large transfer")).toHaveAttribute("aria-expanded", "false");
  });

  it("adds a condition and focuses its column", async () => {
    render(<Harness initial={two} />);
    await userEvent.click(line("Very large transfer"));
    await userEvent.click(screen.getByRole("button", { name: "Add condition" }));
    const columns = screen.getAllByLabelText("Column");
    expect(columns).toHaveLength(3);
    expect(columns[2]).toHaveFocus();
  });

  it("removes a condition and focuses the one before it", async () => {
    render(<Harness initial={two} />);
    await userEvent.click(line("Very large transfer"));
    await userEvent.click(screen.getByRole("button", { name: "Remove condition 2" }));
    const columns = screen.getAllByLabelText("Column");
    expect(columns).toHaveLength(1);
    expect(columns[0]).toHaveFocus();
  });

  it("removes a rule and moves focus to the rule that took its place", async () => {
    const onRules = vi.fn();
    render(<Harness initial={two} onRules={onRules} />);
    await userEvent.click(line("Very large transfer"));
    await userEvent.click(screen.getByRole("button", { name: /Remove rule Very large transfer/ }));
    expect((onRules.mock.calls.at(-1)![0] as FlagRule[]).map((r) => r.name)).toEqual([
      "Watchlist terminal",
    ]);
    expect(line("Watchlist terminal")).toHaveFocus();
    expect(line("Watchlist terminal")).toHaveAttribute("aria-expanded", "false");
  });

  it("removing the last rule leaves focus on Add rule, not on the page", async () => {
    render(<Harness initial={[two[0]]} />);
    await userEvent.click(line("Very large transfer"));
    await userEvent.click(screen.getByRole("button", { name: /Remove rule Very large transfer/ }));
    expect(screen.getByRole("button", { name: "Add rule" })).toHaveFocus();
  });

  it("does not open the wrong rule after one before it is removed", async () => {
    render(<Harness initial={[...two, { ...two[0], name: "Third" }]} />);
    await userEvent.click(line("Third"));
    await userEvent.click(screen.getByRole("button", { name: "Edit rule Very large transfer" }));
    await userEvent.click(screen.getByRole("button", { name: /Remove rule Very large transfer/ }));
    expect(screen.queryByLabelText("Rule name")).toBeNull();
  });
});

describe("an empty editor", () => {
  it("explains what a rule is, with an example, and offers to add one", () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText(/nothing on this query will be flagged/i)).toBeInTheDocument();
    expect(
      screen.getByText(/amount is at least 500000 and response_code equals 00/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add your first rule" })).toBeInTheDocument();
  });

  it("adds the first rule open, with focus in its name", async () => {
    const onRules = vi.fn();
    render(<Harness initial={[]} onRules={onRules} />);
    await userEvent.click(screen.getByRole("button", { name: "Add your first rule" }));
    expect((onRules.mock.calls[0][0] as FlagRule[]).length).toBe(1);
    expect(screen.getByLabelText("Rule name")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Add your first rule" })).toBeNull();
  });
});

describe("conditions, opened", () => {
  it("states the AND between them in words", async () => {
    render(<Harness initial={two} />);
    await userEvent.click(line("Very large transfer"));
    expect(screen.getByText(/all of these hold/i)).toBeInTheDocument();
    expect(screen.getByText("and", { selector: "div" })).toBeInTheDocument();
  });

  it("says 'this holds' for a lone condition, with no AND", async () => {
    render(<Harness initial={two} />);
    await userEvent.click(line("Watchlist terminal"));
    expect(screen.getByText(/this holds/i)).toBeInTheDocument();
    expect(screen.queryByText("and", { selector: "div" })).toBeNull();
  });

  it("says a null check needs no value, rather than leaving a gap", async () => {
    render(
      <Harness
        initial={[{ ...two[0], conditions: [{ column_name: "outcome", operator: "is_null" }] }]}
      />,
    );
    await userEvent.click(line("Very large transfer"));
    expect(screen.getByText("Needs no value")).toBeInTheDocument();
  });

  it("lays a between out as one row: value, and, upper bound", async () => {
    render(
      <Harness
        initial={[
          {
            ...two[0],
            conditions: [{ column_name: "risk_score", operator: "between", value: "70", value2: "100" }],
          },
        ]}
      />,
    );
    await userEvent.click(line("Very large transfer"));
    const value = screen.getByLabelText("Value");
    const upper = screen.getByLabelText("Upper bound");
    expect(value.parentElement).toBe(upper.parentElement);
  });

  it("updates the line's sentence as the rule is edited", async () => {
    render(<Harness initial={two} />);
    await userEvent.click(line("Very large transfer"));
    await userEvent.clear(screen.getAllByLabelText("Value")[0]);
    await userEvent.type(screen.getAllByLabelText("Value")[0], "9000");
    expect(line("Very large transfer")).toHaveTextContent("amount is at least 9000");
  });
});

describe("what is wrong, and where", () => {
  const broken: FlagRule[] = [
    { ...two[0], conditions: [{ column_name: "", operator: "gt", value: "1" }] },
  ];

  it("flags a collapsed rule that needs attention, with the reason, without opening it", () => {
    render(<Harness initial={broken} />);
    expect(line("Very large transfer")).toHaveTextContent("Needs attention");
    expect(screen.getByText("Pick a column.")).toBeInTheDocument();
  });

  it("shows the message beside the field once opened, tied to it", async () => {
    render(<Harness initial={broken} />);
    await userEvent.click(line("Very large transfer"));
    const column = screen.getByLabelText("Column");
    const message = document.getElementById(column.getAttribute("aria-describedby")!);
    expect(message).toHaveTextContent("Pick a column.");
    // One place, not two: the header's preview gives way to the field's own.
    expect(screen.getAllByText("Pick a column.")).toHaveLength(1);
  });

  it("puts a missing column's message inside the column's own cell, not after the row", async () => {
    // On a phone the three fields stack; a message after all of them sat a
    // screen away from the column it was about.
    render(<Harness initial={broken} />);
    await userEvent.click(line("Very large transfer"));
    const column = screen.getByLabelText("Column");
    const message = screen.getByText("Pick a column.");
    expect(column.parentElement).toContainElement(message);
    expect(screen.getByLabelText("Value").parentElement!.parentElement).not.toContainElement(message);
  });

  it("puts a missing value's message in the value's cell", async () => {
    render(
      <Harness
        initial={[{ ...two[0], conditions: [{ column_name: "amount", operator: "gt", value: "" }] }]}
      />,
    );
    await userEvent.click(line("Very large transfer"));
    const message = screen.getByText("This comparison needs a value.");
    const value = screen.getByLabelText("Value");
    expect(value.closest("div")!.parentElement!.parentElement).toContainElement(message);
    expect(screen.getByLabelText("Column").parentElement).not.toContainElement(message);
    expect(value).toHaveAttribute("aria-describedby", message.id);
  });

  it("puts a name problem under the name field", async () => {
    render(<Harness initial={[{ ...two[0], name: "  " }]} />);
    await userEvent.click(screen.getByRole("button", { name: /Edit rule rule 1/ }));
    const field = screen.getByLabelText("Rule name").closest("div")!;
    expect(within(field).getByText("A rule needs a name.")).toBeInTheDocument();
  });

  it("calls an unnamed rule Untitled rather than leaving a hole in the line", () => {
    render(<Harness initial={[{ ...two[0], name: "" }]} />);
    expect(screen.getByRole("button", { name: /Edit rule rule 1/ })).toHaveTextContent(
      "Untitled rule",
    );
  });
});

describe("unsaved changes", () => {
  it("says nothing without a saved copy to compare with", () => {
    render(<Harness initial={two} />);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("says nothing when the rules are as saved", () => {
    render(<Harness initial={two} saved={two} />);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(screen.queryByText("Edited")).toBeNull();
    expect(screen.queryByText("New")).toBeNull();
  });

  it("does not take the engine's nulls for an edit", () => {
    const fromEngine: FlagRule[] = [
      {
        ...two[0],
        conditions: [{ column_name: "outcome", operator: "is_null", value: null, value2: null }],
      },
    ];
    const inEditor: FlagRule[] = [
      {
        ...two[0],
        conditions: [{ column_name: "outcome", operator: "is_null", value: "", value2: "" }],
      },
    ];
    render(<Harness initial={inEditor} saved={fromEngine} />);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("does not take a null list for an edit either", () => {
    // The engine sends list_id: null on a condition that names no list, and a
    // rule the editor built has no list_id at all. Neither is a change.
    const fromEngine: FlagRule[] = [
      {
        ...two[0],
        conditions: [{ column_name: "amount", operator: "gt", value: "5", value2: null, list_id: null }],
      },
    ];
    const inEditor: FlagRule[] = [
      { ...two[0], conditions: [{ column_name: "amount", operator: "gt", value: "5" }] },
    ];
    render(<Harness initial={inEditor} saved={fromEngine} />);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(screen.queryByText("Edited")).toBeNull();
  });

  it("marks an edited rule and the editor as a whole", async () => {
    render(<Harness initial={two} saved={two} />);
    await userEvent.click(line("Very large transfer"));
    await userEvent.type(screen.getByLabelText("Rule name"), "!");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Close rule Very large transfer!/ })).toHaveTextContent(
      "Edited",
    );
    expect(screen.getByRole("button", { name: "Edit rule Watchlist terminal" })).not.toHaveTextContent(
      "Edited",
    );
  });

  it("marks a rule added since the last save as new", async () => {
    render(<Harness initial={two} saved={two} />);
    await userEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Close rule Rule 3/ })).toHaveTextContent("New");
  });

  it("counts a removed rule as a change too", async () => {
    render(<Harness initial={two} saved={two} />);
    await userEvent.click(line("Very large transfer"));
    await userEvent.click(screen.getByRole("button", { name: /Remove rule/ }));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("treats every rule as new when nothing has been saved yet", () => {
    render(<Harness initial={two} saved={[]} />);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getAllByText("New")).toHaveLength(2);
  });

  it("clears once the edit is undone", async () => {
    render(<Harness initial={two} saved={two} />);
    await userEvent.click(line("Very large transfer"));
    await userEvent.type(screen.getByLabelText("Rule name"), "!");
    await userEvent.type(screen.getByLabelText("Rule name"), "{Backspace}");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });
});

describe("the write payload", () => {
  it("is exactly the FlagRule shape, whatever the view looks like", async () => {
    const onRules = vi.fn();
    render(<Harness initial={two} onRules={onRules} />);
    await userEvent.click(line("Very large transfer"));
    await userEvent.selectOptions(screen.getByLabelText("Severity"), "low");
    const [next] = onRules.mock.calls.at(-1) as [FlagRule[]];
    expect(Object.keys(next[0]).sort()).toEqual(["conditions", "enabled", "name", "severity"]);
    expect(next[0].severity).toBe("low");
    expect(Object.keys(next[0].conditions[0]).sort()).toEqual(["column_name", "operator", "value"]);
  });
});
