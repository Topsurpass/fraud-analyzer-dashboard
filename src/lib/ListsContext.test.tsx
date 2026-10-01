import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ListsProvider, useLists } from "./ListsContext";

const listLists = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/services/api-client")>("@/services/api-client");
  return { ...actual, listLists };
});

const summary = (id: string, name: string) => ({
  id,
  name,
  description: null,
  item_count: 1,
  rule_count: 0,
  created_by: "u1",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
});

function Probe() {
  const { lists, initial, reload } = useLists();
  return (
    <div>
      <p>{initial ? "loading" : lists.map((list) => list.name).join(",") || "none"}</p>
      <button onClick={reload}>reload</button>
    </div>
  );
}

beforeEach(() => {
  listLists.mockReset().mockResolvedValue([summary("l1", "Blocked")]);
});

describe("ListsProvider", () => {
  it("loads once and shares the result", async () => {
    render(
      <ListsProvider>
        <Probe />
        <Probe />
      </ListsProvider>,
    );
    await waitFor(() => expect(screen.getAllByText("Blocked")).toHaveLength(2));
    expect(listLists).toHaveBeenCalledTimes(1);
  });

  it("refetches on reload, which is how a mutation shows up in the picker", async () => {
    render(
      <ListsProvider>
        <Probe />
      </ListsProvider>,
    );
    await screen.findByText("Blocked");

    listLists.mockResolvedValue([summary("l1", "Blocked"), summary("l2", "Watch")]);
    await act(async () => {
      screen.getByRole("button", { name: "reload" }).click();
    });
    expect(await screen.findByText("Blocked,Watch")).toBeInTheDocument();
    expect(listLists).toHaveBeenCalledTimes(2);
  });

  it("refuses to be used outside the provider", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/inside <ListsProvider>/);
    quiet.mockRestore();
  });
});
