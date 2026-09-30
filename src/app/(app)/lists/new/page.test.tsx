import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/services/api-client";
import NewListPage from "./page";

const createList = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const reload = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
	const actual =
		await vi.importActual<typeof import("@/services/api-client")>("@/services/api-client");
	return { ...actual, createList };
});

vi.mock("@/lib/ListsContext", () => ({ useLists: () => ({ reload }) }));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
	usePathname: () => "/lists/new",
}));

vi.mock("@/components/PageBody", () => ({
	PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

beforeEach(() => {
	createList.mockReset().mockResolvedValue({ id: "l9", received: 4, kept: 3, duplicates_dropped: 1 });
	push.mockReset();
	reload.mockReset();
	window.sessionStorage.clear();
});

async function fill(name: string, items: string, description = "") {
	if (name) await userEvent.type(screen.getByLabelText("Name"), name);
	if (description) await userEvent.type(screen.getByLabelText("Description"), description);
	if (items) await userEvent.type(screen.getByLabelText("Items"), items);
}

describe("creating a list", () => {
	it("posts trimmed name, description and parsed items, then opens the list", async () => {
		render(<NewListPage />);
		await fill("  Blocked terminals ", "T-1\nT-2\nT-3", "August wave");
		await userEvent.click(screen.getByRole("button", { name: "Create" }));

		await waitFor(() => expect(createList).toHaveBeenCalledTimes(1));
		expect(createList).toHaveBeenCalledWith({
			name: "Blocked terminals",
			description: "August wave",
			items: ["T-1", "T-2", "T-3"],
		});
		expect(reload).toHaveBeenCalled();
		expect(push).toHaveBeenCalledWith("/lists/l9");
		expect(JSON.parse(window.sessionStorage.getItem("fae:list-created:l9") ?? "null")).toEqual({
			received: 4,
			kept: 3,
		});
	});

	it("keeps a comma inside an item once the paste has line breaks", async () => {
		render(<NewListPage />);
		await fill("People", "Smith, John\nDoe, Jane");
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(createList).toHaveBeenCalled());
		expect(createList.mock.calls[0][0].items).toEqual(["Smith, John", "Doe, Jane"]);
		expect(screen.getByText(/commas stay part of the item/)).toBeInTheDocument();
	});

	it("sends a blank description as null", async () => {
		render(<NewListPage />);
		await fill("Watchlist", "a");
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(createList).toHaveBeenCalled());
		expect(createList.mock.calls[0][0].description).toBeNull();
	});

	it("counts items live and says how many duplicates will be dropped", async () => {
		render(<NewListPage />);
		await userEvent.type(screen.getByLabelText("Items"), "NG, ng, GH, 2, 2.0");
		expect(screen.getByText("3 items, 2 duplicates will be dropped")).toBeInTheDocument();
	});

	it("refuses to submit without a name or items, and says which", async () => {
		render(<NewListPage />);
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		expect(screen.getByText("A name is required.")).toBeInTheDocument();
		expect(screen.getByText("Add at least one item.")).toBeInTheDocument();
		expect(createList).not.toHaveBeenCalled();
	});

	it("refuses an item the engine would reject for length", async () => {
		render(<NewListPage />);
		await fill("Long", "x".repeat(501));
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		expect(screen.getByText(/1 item is over 500 characters/)).toBeInTheDocument();
		expect(createList).not.toHaveBeenCalled();
	});

	it("explains a name that is taken and stays on the form", async () => {
		createList.mockRejectedValue(
			new ApiError({
				kind: "http",
				status: 409,
				errorCode: "LIST_NAME_TAKEN",
				message: "taken",
				url: "/lists",
			}),
		);
		render(<NewListPage />);
		await fill("Watchlist", "a");
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(/already has that name/i);
		expect(push).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
	});

	it("cancels back to the index", async () => {
		render(<NewListPage />);
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(push).toHaveBeenCalledWith("/lists");
	});

	it("keeps the hint visible beside an error, so the rule is still on screen", async () => {
		render(<NewListPage />);
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		expect(screen.getByText("A name is required.")).toBeInTheDocument();
		expect(screen.getByText(/Rules show this name/)).toBeInTheDocument();
		expect(screen.getByText("Add at least one item.")).toBeInTheDocument();
		expect(screen.getByText(/commas stay part of the item/)).toBeInTheDocument();
	});

	it("starts with the cursor in Name, which only the new-list page does", () => {
		render(<NewListPage />);
		expect(screen.getByLabelText("Name")).toHaveFocus();
	});
});
