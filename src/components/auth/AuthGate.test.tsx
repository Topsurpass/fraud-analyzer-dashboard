import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "./AuthGate";

const replace = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ pathname: "/", search: "" }));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
	usePathname: () => route.pathname,
	useSearchParams: () => new URLSearchParams(route.search),
}));

const authStatus = vi.hoisted(() => ({ current: "loading" as string }));

vi.mock("@/services/auth/AuthContext", () => ({
	useAuth: () => ({
		status: authStatus.current,
		user: null,
		busy: false,
		signIn: vi.fn(),
		signOut: vi.fn(),
		changeOwnPassword: vi.fn(),
		refresh: vi.fn(),
		can: () => false,
	}),
}));

function mount() {
	return render(
		<AuthGate>
			<p>the application</p>
		</AuthGate>,
	);
}

beforeEach(() => {
	replace.mockReset();
	route.pathname = "/";
	route.search = "";
	authStatus.current = "loading";
});

describe("what the gate renders", () => {
	it("shows the app only once the session is established", () => {
		authStatus.current = "signedIn";
		mount();
		expect(screen.getByText("the application")).toBeInTheDocument();
	});

	it("renders nothing of the app while the session is still resolving", () => {
		/*
		 * The shell's providers fetch on mount. Mounting them before the token is
		 * known means firing requests that are about to be either unnecessary or
		 * unauthorised, and a rail full of "Engine unreachable" behind them.
		 */
		mount();
		expect(screen.queryByText("the application")).not.toBeInTheDocument();
	});

	it("says it is loading rather than showing a blank screen", () => {
		mount();
		expect(screen.getByText("Loading")).toBeInTheDocument();
	});

	it("hides the app the moment a session ends mid-use", () => {
		authStatus.current = "signedOut";
		mount();
		expect(screen.queryByText("the application")).not.toBeInTheDocument();
	});
});

describe("where the gate sends people", () => {
	it("sends a signed-out visitor to log in", async () => {
		authStatus.current = "signedOut";
		mount();
		await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2F"));
	});

	it("remembers the page they were trying to reach", async () => {
		authStatus.current = "signedOut";
		route.pathname = "/connections/c1/flagged";
		mount();
		await waitFor(() =>
			expect(replace).toHaveBeenCalledWith("/login?next=%2Fconnections%2Fc1%2Fflagged"),
		);
	});

	it("carries the query string too", async () => {
		// A deep link into a filtered view is exactly the kind of URL somebody
		// pastes to a colleague who is not signed in yet.
		authStatus.current = "signedOut";
		route.pathname = "/dashboards/d1";
		route.search = "card=q7&window=24h";
		mount();
		await waitFor(() =>
			expect(replace).toHaveBeenCalledWith(
				"/login?next=%2Fdashboards%2Fd1%3Fcard%3Dq7%26window%3D24h",
			),
		);
	});

	it("sends a temporary password to the one screen that clears it", async () => {
		authStatus.current = "mustChangePassword";
		route.pathname = "/admin/users";
		mount();
		await waitFor(() => expect(replace).toHaveBeenCalledWith("/change-password"));
	});

	it("sends nobody anywhere while it is still working out who they are", async () => {
		// Redirecting on "loading" bounces a signed-in user to the login screen
		// on every full page load.
		mount();
		await Promise.resolve();
		expect(replace).not.toHaveBeenCalled();
	});

	it("leaves a signed-in user where they are", async () => {
		authStatus.current = "signedIn";
		route.pathname = "/admin/users";
		mount();
		await Promise.resolve();
		expect(replace).not.toHaveBeenCalled();
	});
});
