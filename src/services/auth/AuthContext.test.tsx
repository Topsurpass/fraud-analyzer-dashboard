import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { AuthProvider, useAuth } from "./AuthContext";

const me = vi.hoisted(() => vi.fn());
const login = vi.hoisted(() => vi.fn());
const logout = vi.hoisted(() => vi.fn());
const changePassword = vi.hoisted(() => vi.fn());

vi.mock("@/services/api-client", async () => {
	const actual =
		await vi.importActual<typeof import("@/services/api-client")>("@/services/api-client");
	return { ...actual, me, login, logout, changePassword };
});

function user(over: Partial<UserRead> = {}): UserRead {
	return {
		id: "u1",
		email: "ada@example.com",
		full_name: "Ada Lovelace",
		role: "analyst",
		is_active: true,
		must_change_password: false,
		last_login_at: null,
		created_at: "2026-08-01T00:00:00Z",
		...over,
	};
}

/** Prints the pieces of the context each test asserts on. */
function Probe() {
	const { status, user: current, can, signIn, signOut, changeOwnPassword, refresh } = useAuth();
	return (
		<div>
			<p data-testid="status">{status}</p>
			<p data-testid="who">{current?.email ?? "nobody"}</p>
			<p data-testid="manage">{String(can("users.manage"))}</p>
			<button onClick={() => void signIn("ada@example.com", "hunter2hunter2").catch(() => {})}>
				sign in
			</button>
			<button onClick={() => void signOut()}>sign out</button>
			<button onClick={() => void changeOwnPassword("old", "new-and-long-enough")}>change</button>
			<button onClick={refresh}>refresh</button>
		</div>
	);
}

function mount() {
	return render(
		<AuthProvider>
			<Probe />
		</AuthProvider>,
	);
}

const status = () => screen.getByTestId("status").textContent;

beforeEach(() => {
	me.mockReset();
	login.mockReset();
	logout.mockReset().mockResolvedValue(undefined);
	changePassword.mockReset().mockResolvedValue(undefined);
});

describe("bootstrapping", () => {
	it("asks /auth/me once on mount - there is no token to check first", async () => {
		// The session lives in an httpOnly cookie this code cannot read, so
		// unlike the old token-gated version, "is anybody signed in" can only be
		// answered by asking the engine. There is no shortcut that skips it.
		me.mockRejectedValue(new ApiError({ kind: "http", message: "no", url: "", status: 401 }));

		mount();

		await waitFor(() => expect(status()).toBe("signedOut"));
		expect(me).toHaveBeenCalledTimes(1);
	});

	it("resolves a live cookie into a user", async () => {
		me.mockResolvedValue(user());

		mount();

		await waitFor(() => expect(status()).toBe("signedIn"));
		expect(screen.getByTestId("who")).toHaveTextContent("ada@example.com");
	});

	it("reports mustChangePassword as its own state, not as signed in", async () => {
		// Every route guard has to treat it as "not usable yet". A boolean on
		// signedIn is the shape that invites the guard which forgets to check.
		me.mockResolvedValue(user({ must_change_password: true }));

		mount();

		await waitFor(() => expect(status()).toBe("mustChangePassword"));
	});

	it("grants no capability while that gate is up, even to an admin", async () => {
		me.mockResolvedValue(user({ role: "admin", must_change_password: true }));

		mount();

		await waitFor(() => expect(status()).toBe("mustChangePassword"));
		expect(screen.getByTestId("manage")).toHaveTextContent("false");
	});

	it("falls back to signed out when the very first read fails", async () => {
		me.mockRejectedValue(new ApiError({ kind: "network", message: "offline", url: "" }));

		mount();

		await waitFor(() => expect(status()).toBe("signedOut"));
	});
});

describe("signing in", () => {
	it("shows the user from the login response - there is no token in it to store", async () => {
		// Since the BFF migration, POST /api/auth/login returns the user object
		// alone; the session cookie is set server-side and never reaches this
		// code. Asserting the bare user here is the regression test for the
		// break this task fixes: the old mock shape, {token, user}, hid it.
		me.mockRejectedValue(new ApiError({ kind: "http", message: "no", url: "", status: 401 }));
		login.mockResolvedValue(user({ role: "admin" }));
		mount();
		await waitFor(() => expect(status()).toBe("signedOut"));

		await userEvent.click(screen.getByText("sign in"));

		await waitFor(() => expect(status()).toBe("signedIn"));
		expect(screen.getByTestId("manage")).toHaveTextContent("true");
	});

	it("does not spend a second round trip asking who just signed in", async () => {
		// The login response already carries the user. Re-reading /auth/me would
		// be a wasted request on the one screen where latency is most visible.
		me.mockResolvedValue(user({ role: "analyst", email: "before@example.com" }));
		login.mockResolvedValue(user());
		mount();
		await waitFor(() => expect(status()).toBe("signedIn"));
		const callsBeforeSignIn = me.mock.calls.length;

		await userEvent.click(screen.getByText("sign in"));
		await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("ada@example.com"));

		expect(me).toHaveBeenCalledTimes(callsBeforeSignIn);
	});

	it("stays signed out when the engine refuses", async () => {
		me.mockRejectedValue(new ApiError({ kind: "http", message: "no", url: "", status: 401 }));
		login.mockRejectedValue(
			new ApiError({ kind: "http", message: "no", url: "", status: 401 }),
		);
		mount();
		await waitFor(() => expect(status()).toBe("signedOut"));

		await userEvent.click(screen.getByText("sign in"));

		await waitFor(() => expect(status()).toBe("signedOut"));
	});
});

describe("signing out", () => {
	it("drops the user immediately, without asking /auth/me again", async () => {
		// The logout call is what ends the session server-side; there is nothing
		// left for /auth/me to usefully confirm once it has succeeded, so this
		// should not cost a second round trip.
		me.mockResolvedValue(user());
		mount();
		await waitFor(() => expect(status()).toBe("signedIn"));
		const callsBeforeSignOut = me.mock.calls.length;

		await userEvent.click(screen.getByText("sign out"));

		await waitFor(() => expect(status()).toBe("signedOut"));
		expect(screen.getByTestId("who")).toHaveTextContent("nobody");
		expect(me).toHaveBeenCalledTimes(callsBeforeSignOut);
	});

	it("signs out locally even when the engine never answers", async () => {
		// A sign-out that fails because the network is down, and leaves somebody
		// looking signed in, is the worst of both.
		me.mockResolvedValue(user());
		logout.mockRejectedValue(new ApiError({ kind: "network", message: "offline", url: "" }));
		mount();
		await waitFor(() => expect(status()).toBe("signedIn"));

		await userEvent.click(screen.getByText("sign out"));

		await waitFor(() => expect(status()).toBe("signedOut"));
	});
});

describe("changing your own password", () => {
	it("lifts the gate before the caller navigates away", async () => {
		/*
		 * The page redirects the moment this resolves, and AuthGate sends
		 * `mustChangePassword` straight back to the same form. If the re-read
		 * had not landed, the user would be bounced back to the screen they
		 * just completed.
		 */
		me.mockResolvedValue(user({ must_change_password: true }));
		mount();
		await waitFor(() => expect(status()).toBe("mustChangePassword"));

		me.mockResolvedValue(user({ must_change_password: false }));
		await userEvent.click(screen.getByText("change"));

		await waitFor(() => expect(status()).toBe("signedIn"));
	});
});

describe("refreshing", () => {
	it("picks up a role that changed, without blanking the app first", async () => {
		me.mockResolvedValue(user({ role: "analyst" }));
		mount();
		await waitFor(() => expect(screen.getByTestId("manage")).toHaveTextContent("false"));

		me.mockResolvedValue(user({ role: "admin" }));
		await userEvent.click(screen.getByText("refresh"));

		await waitFor(() => expect(screen.getByTestId("manage")).toHaveTextContent("true"));
		// Never passed through "loading" - the user stays on screen throughout.
		expect(status()).toBe("signedIn");
	});

	it("keeps the known user when the refresh itself fails", async () => {
		me.mockResolvedValue(user());
		mount();
		await waitFor(() => expect(status()).toBe("signedIn"));

		me.mockRejectedValue(new ApiError({ kind: "network", message: "offline", url: "" }));
		await userEvent.click(screen.getByText("refresh"));

		await waitFor(() => expect(me).toHaveBeenCalledTimes(2));
		expect(status()).toBe("signedIn");
		expect(screen.getByTestId("who")).toHaveTextContent("ada@example.com");
	});
});
