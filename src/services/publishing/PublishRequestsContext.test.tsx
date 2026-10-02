import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishRequestRead, UserRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { PublishRequestsProvider, usePublishRequests } from "./PublishRequestsContext";

/**
 * The queue is administrators' business. For anyone else the provider must not
 * even ask: an analyst's browser calling an endpoint that refuses it would put
 * a 403 in the console on every page, and a count in the rail for a queue they
 * cannot open.
 */

const listPublishRequests = vi.hoisted(() => vi.fn());
const signedIn = vi.hoisted(() => ({ user: null as UserRead | null }));

vi.mock("@/services/api-client", async () => {
	const actual = await vi.importActual<typeof import("@/services/api-client")>(
		"@/services/api-client",
	);
	return { ...actual, listPublishRequests };
});
vi.mock("@/services/auth/AuthContext", () => ({ useOptionalUser: () => signedIn.user }));

const person = (role: "admin" | "analyst"): UserRead => ({
	id: role === "admin" ? "u1" : "u2",
	email: `${role}@example.com`,
	full_name: role,
	role,
	is_active: true,
	must_change_password: false,
	last_login_at: null,
	created_at: "2026-10-01T00:00:00Z",
});

const request = (id: string): PublishRequestRead => ({
	chart: { id } as PublishRequestRead["chart"],
	query_id: `q-${id}`,
	query_name: "Query",
	connection_id: "c1",
	connection_name: "Payments",
	requested_by: { id: "u2", full_name: "Grace", email: "grace@example.com" },
	requested_at: "2026-10-01T10:00:00Z",
	definition_fingerprint: `fp-${id}`,
});

function Probe() {
	const queue = usePublishRequests();
	return (
		<div>
			<span data-testid="count">{queue.count}</span>
			<span data-testid="error">{queue.error?.displayMessage ?? ""}</span>
			<button onClick={queue.reload}>reload</button>
		</div>
	);
}

const mount = () =>
	render(
		<PublishRequestsProvider>
			<Probe />
		</PublishRequestsProvider>,
	);

beforeEach(() => {
	listPublishRequests.mockReset().mockResolvedValue([request("a"), request("b")]);
	signedIn.user = person("admin");
});

describe("PublishRequestsProvider", () => {
	it("gives an administrator the waiting requests and their count", async () => {
		mount();
		await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
		expect(listPublishRequests).toHaveBeenCalled();
	});

	it("never asks the engine on behalf of an analyst, and reports nothing waiting", async () => {
		signedIn.user = person("analyst");
		mount();
		// Give any request a chance to go out.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		expect(listPublishRequests).not.toHaveBeenCalled();
		expect(screen.getByTestId("count")).toHaveTextContent("0");
	});

	it("never asks while nobody is signed in", async () => {
		signedIn.user = null;
		mount();
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		expect(listPublishRequests).not.toHaveBeenCalled();
	});

	it("reads again on reload, so a decision drops the count at once", async () => {
		const user = userEvent.setup();
		mount();
		await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));

		listPublishRequests.mockResolvedValue([request("a")]);
		await user.click(screen.getByRole("button", { name: "reload" }));

		await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
	});

	it("reports a failed read without inventing a count", async () => {
		listPublishRequests.mockRejectedValue(
			new ApiError({ kind: "http", status: 500, message: "boom", url: "" }),
		);
		mount();
		await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("boom"));
		expect(screen.getByTestId("count")).toHaveTextContent("0");
	});
});

describe("usePublishRequests with no provider", () => {
	it("says nothing is waiting instead of throwing", () => {
		render(<Probe />);
		expect(screen.getByTestId("count")).toHaveTextContent("0");
	});
});
