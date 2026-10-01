import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import writeXlsxFile from "write-excel-file/universal";
import { describe, expect, it, vi } from "vitest";
import { ListForm } from "./ListForm";

function setup(over: Partial<React.ComponentProps<typeof ListForm>> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <ListForm
      initial={{ name: "", description: "", itemsText: "" }}
      submitLabel="Create"
      busyLabel="Creating…"
      busy={false}
      error={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...over}
    />,
  );
  return { onSubmit, onCancel };
}

const items = () => (screen.getByLabelText("Items") as HTMLTextAreaElement).value;
const file = (text: string, name: string) => new File([text], name);
// `applyAccept: false`: the picker's "All files" lets a person choose a type the
// input does not list, and refusing those in words is part of what is tested.
const upload = (f: File) =>
  userEvent
    .setup({ applyAccept: false })
    .upload(document.querySelector('input[type="file"]') as HTMLInputElement, f);

describe("the list form", () => {
  it("submits a trimmed name, a description and parsed items", async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByLabelText("Name"), "  Blocked terminals ");
    await userEvent.type(screen.getByLabelText("Description"), "August wave");
    await userEvent.type(screen.getByLabelText("Items"), "T-1\nT-2\nT-3");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Blocked terminals",
      description: "August wave",
      items: ["T-1", "T-2", "T-3"],
    });
  });

  it("sends a blank description as null", async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByLabelText("Name"), "Watchlist");
    await userEvent.type(screen.getByLabelText("Items"), "a");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onSubmit.mock.calls[0][0].description).toBeNull();
  });

  it("keeps a comma inside an item once the paste has line breaks", async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByLabelText("Name"), "People");
    await userEvent.type(screen.getByLabelText("Items"), "Smith, John\nDoe, Jane");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onSubmit.mock.calls[0][0].items).toEqual(["Smith, John", "Doe, Jane"]);
  });

  it("counts items live and says how many duplicates will be dropped", async () => {
    setup();
    await userEvent.type(screen.getByLabelText("Items"), "NG, ng, GH, 2, 2.0");
    expect(screen.getByText(/3 items, 2 duplicates will be dropped/)).toBeInTheDocument();
  });

  it("refuses to submit without a name or items, and says which", async () => {
    const { onSubmit } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText("A name is required.")).toBeInTheDocument();
    expect(screen.getByText("Add at least one item.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses an item the engine would reject for length", async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByLabelText("Name"), "Long");
    fireEvent.change(screen.getByLabelText("Items"), { target: { value: "x".repeat(501) } });
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText(/1 item is over 500 characters/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the hint visible beside an error, so the rule is still on screen", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText("A name is required.")).toBeInTheDocument();
    expect(screen.getByText(/Rules show this name/)).toBeInTheDocument();
    expect(screen.getByText(/commas stay part of the item/)).toBeInTheDocument();
  });

  it("puts the cursor in Name only when asked to", () => {
    setup({ autoFocus: true });
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it("offers no import to somebody who cannot edit the list", () => {
    setup({ readOnly: true, initial: { name: "x", description: "", itemsText: "a" } });
    expect(screen.queryByRole("button", { name: /Import from Excel/ })).not.toBeInTheDocument();
  });
});

describe("importing a column from a file", () => {
  it("previews the chosen column and adds it to the box on confirm", async () => {
    setup();
    await upload(file("terminal,country\nT-1,NG\nT-2,US\nT-3,GB\n", "terminals.csv"));

    const panel = await screen.findByRole("region", { name: /Import from terminals\.csv/ });
    // Headings are recognised, the first column is offered, and what will be
    // added is listed before anything is.
    expect(within(panel).getByLabelText("First row is column headings")).toBeChecked();
    expect(within(panel).getByLabelText("Column")).toHaveDisplayValue("terminal");
    expect(panel).toHaveTextContent("3 items to add");
    const preview = within(within(panel).getByRole("list", { name: "Preview" }));
    expect(preview.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "T-1",
      "T-2",
      "T-3",
    ]);

    await userEvent.click(within(panel).getByRole("button", { name: "Add 3 items" }));
    expect(items()).toBe("T-1\nT-2\nT-3");
    expect(screen.queryByRole("region", { name: /Import from/ })).not.toBeInTheDocument();
    expect(screen.getByText("Added 3 values from terminals.csv.")).toBeInTheDocument();
  });

  it("lets the person pick another column", async () => {
    setup();
    await upload(file("terminal,country\nT-1,NG\nT-2,US\n", "t.csv"));
    const panel = await screen.findByRole("region", { name: /Import from/ });
    await userEvent.selectOptions(within(panel).getByLabelText("Column"), "country");
    await userEvent.click(within(panel).getByRole("button", { name: "Add 2 items" }));
    expect(items()).toBe("NG\nUS");
  });

  it("includes the first row when it is not headings", async () => {
    setup();
    await upload(file("Terminal\nT-1\nT-2\n", "one.csv"));
    const panel = await screen.findByRole("region", { name: /Import from/ });
    // One column: no guess is made, so the "heading" is offered as an item.
    expect(within(panel).getByLabelText("First row is column headings")).not.toBeChecked();
    expect(panel).toHaveTextContent("3 items to add");
    await userEvent.click(within(panel).getByLabelText("First row is column headings"));
    expect(panel).toHaveTextContent("2 items to add");
  });

  it("adds to what is already in the box, keeping a hand-typed comma list as separate items", async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByLabelText("Name"), "Mixed");
    await userEvent.type(screen.getByLabelText("Items"), "A, B");
    await upload(file("T-1\nT-2\n", "more.txt"));
    await userEvent.click(await screen.findByRole("button", { name: "Add 2 items" }));

    // Joined naively this would be the single item "A, B".
    expect(items()).toBe("A\nB\nT-1\nT-2");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onSubmit.mock.calls[0][0].items).toEqual(["A", "B", "T-1", "T-2"]);
  });

  it("can replace what is in the box instead", async () => {
    setup({ initial: { name: "x", description: "", itemsText: "old1\nold2" } });
    await upload(file("T-1\nT-2\n", "new.txt"));
    const panel = await screen.findByRole("region", { name: /Import from/ });
    await userEvent.click(within(panel).getByLabelText(/Replace the items already in the box/));
    await userEvent.click(within(panel).getByRole("button", { name: "Add 2 items" }));
    expect(items()).toBe("T-1\nT-2");
    expect(screen.getByText("Replaced with 2 values from new.txt.")).toBeInTheDocument();
  });

  it("says how many duplicates in the file will be dropped", async () => {
    setup();
    await upload(file("T-1\nt-1\nT-2\n", "dupes.txt"));
    const panel = await screen.findByRole("region", { name: /Import from/ });
    expect(panel).toHaveTextContent("2 items to add, 1 duplicate in the file will be dropped");
  });

  it("cancels without touching the box", async () => {
    setup({ initial: { name: "x", description: "", itemsText: "keep" } });
    await upload(file("T-1\n", "x.txt"));
    const panel = await screen.findByRole("region", { name: /Import from/ });
    // The form has its own Cancel; this one belongs to the import.
    await userEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
    expect(items()).toBe("keep");
    expect(screen.queryByRole("region", { name: /Import from/ })).not.toBeInTheDocument();
  });

  it("reads a real .xlsx, offering each sheet", async () => {
    setup();
    const blob = await (
      writeXlsxFile as unknown as (s: unknown) => { toBlob(): Promise<Blob> }
    )([
      { sheet: "Terminals", data: [[{ value: "Terminal" }], [{ value: "T-1" }], [{ value: "T-2" }]] },
      { sheet: "Countries", data: [[{ value: "Country" }], [{ value: "NG" }]] },
    ]).toBlob();
    await upload(new File([blob], "book.xlsx"));

    const panel = await screen.findByRole("region", { name: /Import from book\.xlsx/ });
    await userEvent.selectOptions(within(panel).getByLabelText("Sheet"), "Countries");
    await userEvent.click(within(panel).getByLabelText("First row is column headings"));
    await userEvent.click(within(panel).getByRole("button", { name: "Add 1 item" }));
    expect(items()).toBe("NG");
  });

  it("explains an unsupported file in words, and offers nothing to add", async () => {
    setup();
    await upload(file("x", "old.xls"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Old \.xls workbooks are not supported/);
    expect(screen.queryByRole("region", { name: /Import from/ })).not.toBeInTheDocument();
  });

  it("clears the error once a good file is chosen", async () => {
    setup();
    await upload(file("x", "old.xls"));
    await screen.findByRole("alert");
    await upload(file("T-1\n", "ok.txt"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByRole("region", { name: /Import from ok\.txt/ })).toBeInTheDocument();
  });

  it("disables importing while a save is in flight", () => {
    setup({ busy: true });
    expect(screen.getByRole("button", { name: /Import from Excel/ })).toBeDisabled();
  });
});
