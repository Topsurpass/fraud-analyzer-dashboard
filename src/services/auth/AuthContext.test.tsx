import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import { AuthProvider, useAuth } from "./AuthContext";
import { getToken, resetTokenForTests, setToken } from "./token";

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
	window.localStorage.clear();
	resetTokenForTests();
	me.mockReset();
	login.mockReset();
	logout.mockReset().mockResolvedValue(undefined);
	changePassword.mockReset().mockResolvedValue(undefined);
});

afterEach(() => resetTokenForTests());

describe("bootstrapping", () => {
	it("settles straight to signed out with no token, and asks the engine nothing", async () => {
		// A visitor with no session should see the login form immediately rather
		// than a spinner waiting on a request that was never worth making.
		mount();

		await waitFor(() => expect(status()).toBe("signedOut"));
		expect(me).not.toHaveBeenCalled();
	});

	it("resolves a stored token into a user", async () => {
		setToken("stored");
		me.mockResolvedValue(user());

		mount();

		await waitFor(() => expect(status()).toBe("signedIn"));
		expect(screen.getByTestId("who")).toHaveTextContent("ada@example.com");
	});

	it("reports mustChangePassword as its own state, not as signed in", async () => {
		// Every route guard has to treat it as "not usable yet". A boolean on
		// signedIn is the shape that invites the guard which forgets to check.
		setToken("stored");
		me.mockResolvedValue(user({ must_change_password: true }));

		mount();

		await waitFor(() => expect(status()).toBe("mustChangePassword"));
	});

	it("grants no capability while that gate is up, even to an admin", async () => {
		setToken("stored");
		me.mockResolvedValue(user({ role: "admin", must_change_password: true }));

		mount();

		await waitFor(() => expect(status()).toBe("mustChangePassword"));
		expect(screen.getByTestId("manage")).toHaveTextContent("false");
	});

	it("falls back to signed out when the very first read fails", async () => {
		setToken("stored");
		me.mockRejectedValue(new ApiError({ kind: "network", message: "offline", url: "" }));

		mount();

		await waitFor(() => expect(status()).toBe("signedOut"));
	});

	it("keeps the token after a network failure, so a retry can still work", async () => {
		// Only the engine gets to end a session. Signing somebody out over a
		// dropped packet would mean retyping a password because of a blip.
		setToken("stored");
		me.mockRejectedValue(new ApiError({ kind: "network", message: "offline", url: "" }));

		mount();

		await waitFor(() => expect(status()).toBe("signedOut"));
		expect(getToken()).toBe("stored");
	});
});

describe("signing in", () => {
	it("stores the token and shows the user from the login response", async () => {
		login.mockResolvedValue({ token: "fresh", user: user({ role: "admin" }) });
		mount();
		await waitFor(() => expect(status()).toBe("signedOut"));

		await userEvent.click(screen.getByText("sign in"));

		await waitFor(() => expect(status()).toBe("signedIn"));
		expect(getToken()).toBe("fresh");
		expect(screen.getByTestId("manage")).toHaveTextContent("true");
	});

	it("does not spend a second round trip asking who just signed in", async () => {
		// The login response already carries the user. Re-reading /auth/me would
		// be a wasted request on the one screen where latency is most visible.
		login.mockResolvedValue({ token: "fresh", user: user() });
		mount();
		await waitFor(() => expect(status()).toBe("signedOut"));

		await userEvent.click(screen.getByText("sign in"));
		await waitFor(() => expect(status()).toBe("signedIn"));

		expect(me).not.toHaveBeenCalled();
	});

	it("stays signed out and keeps no token when the engine refuses", async () => {
		login.mockRejectedValue(
			new ApiError({ kind: "http", message: "no", url: "", status: 401 }),
		);
		mount();
		await waitFor(() => expect(status()).toBe("signedOut"));

		await userEvent.click(screen.getByText("sign in"));

		await waitFor(() => expect(status()).toBe("signedOut"));
		expect(getToken()).toBeNull();
	});
});

describe("signing out", () => {
	it("drops the token and the user", async () => {
		setToken("stored");
		me.mockResolvedValue(user());
		mount();
		await waitFor(() => expect(status()).toBe("signedIn"));

		await userEvent.click(screen.getByText("sign out"));

		await waitFor(() => expect(status()).toBe("signedOut"));
		expect(getToken()).toBeNull();
		expect(screen.getByTestId("who")).toHaveTextContent("nobody");
	});

	it("signs out locally even when the engine never answers", async () => {
		// A sign-out that fails because the network is down, and leaves somebody
		// looking signed in, is the worst of both.
		setToken("stored");
		me.mockResolvedValue(user());
		logout.mockRejectedValue(new ApiError({ kind: "network", message: "offline", url: "" }));
		mount();
		await waitFor(() => expect(status()).toBe("signedIn"));

		await userEvent.click(screen.getByText("sign out"));

		await waitFor(() => expect(status()).toBe("signedOut"));
		expect(getToken()).toBeNull();
	});
});

describe("a token that changes underneath the app", () => {
	it("signs this tab out when another tab does", async () => {
		setToken("stored");
		me.mockResolvedValue(user());
		mount();
		await waitFor(() => expect(status()).toBe("signedIn"));

		act(() => {
			window.localStorage.removeItem("fae.session-token");
			window.dispatchEvent(
				new StorageEvent("storage", { key: "fae.session-token", newValue: null }),
			);
		});

		await waitFor(() => expect(status()).toBe("signedOut"));
	});

	it("re-resolves when a different session appears", async () => {
		setToken("first");
		me.mockResolvedValue(user());
		mount();
		await waitFor(() => expect(status()).toBe("signedIn"));

		me.mockResolvedValue(user({ id: "u2", email: "grace@navy.example", role: "admin" }));
		act(() => setToken("second"));

		await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("grace@navy.example"));
		expect(screen.getByTestId("manage")).toHaveTextContent("true");
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
		setToken("stored");
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
		setToken("stored");
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
		setToken("stored");
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
