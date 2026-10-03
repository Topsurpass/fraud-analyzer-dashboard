import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishRequestRead, UserRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { PublishRequestsProvider } from "@/services/publishing/PublishRequestsContext";
import ApprovalsPage from "./page";

/**
 * The administrators' queue: read the SQL, then approve or reject.
 *
 * What these hold: nothing here is reachable by an analyst, a decision calls the
 * engine exactly once and the list updates from the engine's answer (never by
 * deleting a row locally), and the definition is one click from every request so
 * a chart is not approved unread.
 */

const listPublishRequests = vi.hoisted(() => vi.fn());
const approvePublishRequest = vi.hoisted(() => vi.fn());
const rejectPublishRequest = vi.hoisted(() => vi.fn());
const getChartDefinition = vi.hoisted(() => vi.fn());
const signedInAs = vi.hoisted(() => ({ role: "admin" as "admin" | "analyst" }));

vi.mock("@/services/api-client", async () => {
	const actual = await vi.importActual<typeof import("@/services/api-client")>(
		"@/services/api-client",
	);
	return {
		...actual,
		listPublishRequests,
		approvePublishRequest,
		rejectPublishRequest,
		getChartDefinition,
	};
});

vi.mock("@/components/PageBody", () => ({
	PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const account = (): UserRead => ({
	id: signedInAs.role === "admin" ? "u1" : "u2",
	email: `${signedInAs.role}@example.com`,
	full_name: signedInAs.role,
	role: signedInAs.role,
	is_active: true,
	must_change_password: false,
	last_login_at: null,
	created_at: "2026-10-01T00:00:00Z",
});
vi.mock("@/services/auth/AuthContext", () => ({
	useAuth: () => ({ user: account() }),
	useOptionalUser: () => account(),
}));

const waiting = (id: string, name: string): PublishRequestRead => ({
	chart: {
		id,
		query_id: `q-${id}`,
		name,
		position: 0,
		chart_type: "line",
		x_field: "bucket",
		y_field: "n",
		series_field: null,
		surge_threshold_pct: null,
		is_public: false,
		published_by: null,
		published_at: null,
		publish_status: "pending",
		created_at: "2026-10-01T09:00:00Z",
		updated_at: "2026-10-01T09:00:00Z",
	},
	query_id: `q-${id}`,
	query_name: `${name} query`,
	connection_id: "c1",
	connection_name: "Payments (prod)",
	requested_by: { id: "u2", full_name: "Grace Hopper", email: "grace@example.com" },
	requested_at: new Date(Date.now() - 5 * 60_000).toISOString(),
	definition_fingerprint: `fp-${id}`,
});

const mount = () =>
	render(
		<PublishRequestsProvider>
			<ApprovalsPage />
		</PublishRequestsProvider>,
	);

beforeEach(() => {
	signedInAs.role = "admin";
	listPublishRequests.mockReset().mockResolvedValue([waiting("a", "Decline rate"), waiting("b", "Volume")]);
	approvePublishRequest.mockReset().mockResolvedValue({});
	rejectPublishRequest.mockReset().mockResolvedValue({});
	getChartDefinition.mockReset().mockResolvedValue({
		chart: waiting("a", "Decline rate").chart,
		query: {
			id: "q-a",
			name: "Decline rate query",
			description: null,
			sql_text: "SELECT 1 AS n",
			row_limit: 1000,
			poll_interval_ms: 60000,
		},
		rules: [],
		connection_name: "Payments (prod)",
		owner_name: "Grace Hopper",
		read_only: false,
	});
});

describe("for an analyst", () => {
	it("says administrators only, and asks the engine for nothing", async () => {
		signedInAs.role = "analyst";
		mount();
		expect(await screen.findByText("Administrators only")).toBeInTheDocument();
		expect(listPublishRequests).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
	});
});

describe("for an administrator", () => {
	it("lists each request with who asked, what, from which query and connection", async () => {
		mount();
		const row = (await screen.findByText("Decline rate")).closest("li") as HTMLElement;
		expect(row).toHaveTextContent("Grace Hopper");
		expect(row).toHaveTextContent("grace@example.com");
		expect(row).toHaveTextContent("Decline rate query");
		expect(row).toHaveTextContent("Payments (prod)");
		expect(row).toHaveTextContent("5m ago");
		expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(2);
	});

	it("says plainly when nothing is waiting", async () => {
		listPublishRequests.mockResolvedValue([]);
		mount();
		expect(await screen.findByText("Nothing is waiting")).toBeInTheDocument();
	});

	it("explains a failed read and offers to retry", async () => {
		listPublishRequests.mockRejectedValue(
			new ApiError({ kind: "http", status: 500, message: "engine down", url: "" }),
		);
		mount();
		expect(await screen.findByText("Could not load the requests")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
	});

	it("opens the read-only definition so the SQL is read before approving", async () => {
		const user = userEvent.setup();
		mount();
		const row = (await screen.findByText("Decline rate")).closest("li") as HTMLElement;
		await user.click(within(row).getByRole("button", { name: "View definition" }));

		expect(await screen.findByLabelText("SQL")).toHaveTextContent("SELECT 1 AS n");
		expect(getChartDefinition).toHaveBeenCalledWith("a", expect.anything());
	});

	it("approves through the engine, once, and the list comes from the engine's answer", async () => {
		const user = userEvent.setup();
		mount();
		const row = (await screen.findByText("Decline rate")).closest("li") as HTMLElement;

		listPublishRequests.mockResolvedValue([waiting("b", "Volume")]);
		await user.click(within(row).getByRole("button", { name: "Approve" }));

		await waitFor(() => expect(approvePublishRequest).toHaveBeenCalledTimes(1));
		// The fingerprint of the request on screen goes with the approval, so the
		// engine can refuse if the definition changed since it was looked at.
		expect(approvePublishRequest).toHaveBeenCalledWith("a", "fp-a");
		await waitFor(() => expect(screen.queryByText("Decline rate")).not.toBeInTheDocument());
		expect(screen.getByText("Volume")).toBeInTheDocument();
		// And the page says what happened, since the row that would have is gone.
		expect(screen.getByRole("status")).toHaveTextContent("Approved “Decline rate”");
	});

	it("rejects with the reason, trimmed by the client call, and not before it is sent", async () => {
		const user = userEvent.setup();
		mount();
		const row = (await screen.findByText("Decline rate")).closest("li") as HTMLElement;

		await user.click(within(row).getByRole("button", { name: "Reject" }));
		expect(rejectPublishRequest).not.toHaveBeenCalled(); // opening the form decides nothing
		await user.type(within(row).getByLabelText(/Reason/), "Remove the card number column");
		listPublishRequests.mockResolvedValue([waiting("b", "Volume")]);
		await user.click(within(row).getByRole("button", { name: "Send rejection" }));

		await waitFor(() =>
			expect(rejectPublishRequest).toHaveBeenCalledWith("a", "Remove the card number column"),
		);
		await waitFor(() => expect(screen.queryByText("Decline rate")).not.toBeInTheDocument());
		expect(screen.getByRole("status")).toHaveTextContent("Rejected “Decline rate”");
	});

	it("lets a rejection go without a reason", async () => {
		const user = userEvent.setup();
		mount();
		const row = (await screen.findByText("Decline rate")).closest("li") as HTMLElement;
		await user.click(within(row).getByRole("button", { name: "Reject" }));
		await user.click(within(row).getByRole("button", { name: "Send rejection" }));
		await waitFor(() => expect(rejectPublishRequest).toHaveBeenCalledWith("a", ""));
	});

	it("can back out of a rejection without deciding anything", async () => {
		const user = userEvent.setup();
		mount();
		const row = (await screen.findByText("Decline rate")).closest("li") as HTMLElement;
		await user.click(within(row).getByRole("button", { name: "Reject" }));
		await user.click(within(row).getByRole("button", { name: "Cancel" }));
		expect(rejectPublishRequest).not.toHaveBeenCalled();
		expect(within(row).getByRole("button", { name: "Approve" })).toBeInTheDocument();
	});

	it("shows the engine's reason and re-reads when somebody else decided first", async () => {
		const user = userEvent.setup();
		approvePublishRequest.mockRejectedValue(
			new ApiError({ kind: "http", status: 409, message: "This chart is not waiting for approval.", url: "" }),
		);
		mount();
		const row = (await screen.findByText("Decline rate")).closest("li") as HTMLElement;
		const reads = listPublishRequests.mock.calls.length;

		listPublishRequests.mockResolvedValue([waiting("b", "Volume")]);
		await user.click(within(row).getByRole("button", { name: "Approve" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("not waiting for approval");
		await waitFor(() => expect(listPublishRequests.mock.calls.length).toBeGreaterThan(reads));
		// The row is gone after the re-read, and the explanation must outlive it.
		await waitFor(() => expect(screen.queryByText("Decline rate")).not.toBeInTheDocument());
		expect(screen.getByRole("alert")).toHaveTextContent("not waiting for approval");
	});

	it("keeps a network failure in the row, which stays so it can be retried", async () => {
		const user = userEvent.setup();
		approvePublishRequest.mockRejectedValue(
			new ApiError({ kind: "network", message: "offline", url: "" }),
		);
		mount();
		const row = (await screen.findByText("Decline rate")).closest("li") as HTMLElement;
		await user.click(within(row).getByRole("button", { name: "Approve" }));

		expect(await within(row).findByRole("alert")).toHaveTextContent("Cannot reach engine");
		expect(within(row).getByRole("button", { name: "Approve" })).toBeEnabled();
	});

	it("does not approve twice from a double click", async () => {
		const user = userEvent.setup();
		let release: () => void = () => {};
		approvePublishRequest.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
		mount();
		const row = (await screen.findByText("Decline rate")).closest("li") as HTMLElement;
		const approve = within(row).getByRole("button", { name: "Approve" });

		await user.click(approve);
		await user.click(within(row).getByRole("button", { name: "Approving…" }));
		release();

		await waitFor(() => expect(approvePublishRequest).toHaveBeenCalledTimes(1));
	});
});
