import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/services/api-client";
import { SchemaBrowser } from "./SchemaBrowser";

const listTables = vi.hoisted(() => vi.fn());
const listColumns = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/services/api-client")>(
    "@/services/api-client",
  );
  return { ...actual, listTables, listColumns };
});

const TABLES = {
  connection_id: "c1",
  tables: [
    { name: "transactions", kind: "table" },
    { name: "daily_totals", kind: "view" },
  ],
};

const COLUMNS = {
  connection_id: "c1",
  table: "transactions",
  columns: [
    { name: "id", type: "INTEGER", nullable: false, primary_key: true },
    { name: "amount", type: "REAL", nullable: false, primary_key: false },
    { name: "note", type: "TEXT", nullable: true, primary_key: false },
  ],
};

beforeEach(() => {
  listTables.mockReset().mockResolvedValue(TABLES);
  listColumns.mockReset().mockResolvedValue(COLUMNS);
});

describe("SchemaBrowser", () => {
  it("lists the target's tables with their kind", async () => {
    render(<SchemaBrowser connectionId="c1" />);
    expect(await screen.findByText("transactions")).toBeInTheDocument();
    expect(screen.getByText("daily_totals")).toBeInTheDocument();
    expect(screen.getByText("view")).toBeInTheDocument();
  });

  it("does not fetch columns until a table is opened", async () => {
    const user = userEvent.setup();
    render(<SchemaBrowser connectionId="c1" />);
    await screen.findByText("transactions");

    // A warehouse can hold hundreds of tables; the analyst opens two.
    expect(listColumns).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { expanded: false, name: /transactions/ }));
    await waitFor(() => expect(listColumns).toHaveBeenCalledWith("c1", "transactions", expect.anything()));
  });

  it("shows each column's type and key metadata", async () => {
    const user = userEvent.setup();
    render(<SchemaBrowser connectionId="c1" />);
    await screen.findByText("transactions");
    await user.click(screen.getByRole("button", { expanded: false, name: /transactions/ }));

    expect(await screen.findByText("id")).toBeInTheDocument();
    expect(screen.getByText("INTEGER · pk")).toBeInTheDocument();
    expect(screen.getByText("REAL · not null")).toBeInTheDocument();
    // A nullable column says only its type.
    expect(screen.getByText("TEXT")).toBeInTheDocument();
  });

  it("collapses an open table again", async () => {
    const user = userEvent.setup();
    render(<SchemaBrowser connectionId="c1" />);
    await screen.findByText("transactions");

    const toggle = screen.getByRole("button", { expanded: false, name: /transactions/ });
    await user.click(toggle);
    expect(await screen.findByText("id")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { expanded: true, name: /transactions/ }));
    await waitFor(() => expect(screen.queryByText("id")).not.toBeInTheDocument());
  });

  it("inserts a table name when asked", async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    render(<SchemaBrowser connectionId="c1" onInsert={onInsert} />);
    await screen.findByText("transactions");

    await user.click(screen.getByLabelText("Insert transactions into the query"));
    expect(onInsert).toHaveBeenCalledWith("transactions");
  });

  it("inserts a column name when asked", async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    render(<SchemaBrowser connectionId="c1" onInsert={onInsert} />);
    await screen.findByText("transactions");
    await user.click(screen.getByRole("button", { expanded: false, name: /transactions/ }));

    await user.click(await screen.findByRole("button", { name: /^amount/ }));
    expect(onInsert).toHaveBeenCalledWith("amount");
  });

  it("renders names as plain text when there is nothing to insert into", async () => {
    render(<SchemaBrowser connectionId="c1" />);
    await screen.findByText("transactions");
    expect(screen.queryByLabelText(/Insert transactions/)).not.toBeInTheDocument();
  });

  it("reports a schema it could not read", async () => {
    listTables.mockRejectedValue(
      new ApiError({ kind: "http", message: "permission denied", url: "/x", status: 403 }),
    );
    render(<SchemaBrowser connectionId="c1" />);
    expect(await screen.findByText("permission denied")).toBeInTheDocument();
  });

  it("says so when the user can see no tables", async () => {
    listTables.mockResolvedValue({ connection_id: "c1", tables: [] });
    render(<SchemaBrowser connectionId="c1" />);
    expect(await screen.findByText("No tables visible to this user.")).toBeInTheDocument();
  });
});
