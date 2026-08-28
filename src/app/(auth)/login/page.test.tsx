import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";
import LoginPage from "./page";

const replace = vi.hoisted(() => vi.fn());
const searchParams = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
	useSearchParams: () => searchParams.current,
	usePathname: () => "/login",
}));

const signIn = vi.hoisted(() => vi.fn());
const authStatus = vi.hoisted(() => ({ current: "signedOut" as string }));

vi.mock("@/services/auth/AuthContext", () => ({
	useAuth: () => ({
		status: authStatus.current,
		user: null,
		busy: false,
		signIn,
		signOut: vi.fn(),
		changeOwnPassword: vi.fn(),
		refresh: vi.fn(),
		can: () => false,
	}),
}));

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

async function fillAndSubmit(password = "hunter2hunter2") {
	await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
	await userEvent.type(screen.getByLabelText("Password"), password);
	await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
	replace.mockReset();
	signIn.mockReset();
	searchParams.current = new URLSearchParams();
	authStatus.current = "signedOut";
});

describe("signing in", () => {
	it("sends the credentials and lands on the app", async () => {
		signIn.mockResolvedValue(user());
		render(<LoginPage />);

		await fillAndSubmit();

		await waitFor(() => expect(signIn).toHaveBeenCalledWith("ada@example.com", "hunter2hunter2"));
		expect(replace).toHaveBeenCalledWith("/");
	});

	it("trims an email somebody pasted with a space on the end", async () => {
		signIn.mockResolvedValue(user());
		render(<LoginPage />);

		await userEvent.type(screen.getByLabelText("Email"), "  ada@example.com  ");
		await userEvent.type(screen.getByLabelText("Password"), "hunter2hunter2");
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

		await waitFor(() => expect(signIn).toHaveBeenCalledWith("ada@example.com", "hunter2hunter2"));
	});

	it("never trims the password", async () => {
		// A generated password could legitimately have whitespace at the edge,
		// and silently altering what somebody typed is the worst kind of bug to
		// diagnose from a login screen.
		signIn.mockResolvedValue(user());
		render(<LoginPage />);

		await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
		await userEvent.type(screen.getByLabelText("Password"), " spaced out ");
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

		await waitFor(() => expect(signIn).toHaveBeenCalledWith("ada@example.com", " spaced out "));
	});

	it("resumes where the visitor was headed", async () => {
		searchParams.current = new URLSearchParams("next=%2Fconnections%2Fc1%2Fflagged");
		signIn.mockResolvedValue(user());
		render(<LoginPage />);

		await fillAndSubmit();

		await waitFor(() => expect(replace).toHaveBeenCalledWith("/connections/c1/flagged"));
	});

	it("refuses to be used as an open redirect", async () => {
		// A link to /login?next=https://evil.example sends somebody through a
		// page they trust and out to one they do not.
		searchParams.current = new URLSearchParams("next=https%3A%2F%2Fevil.example%2Fharvest");
		signIn.mockResolvedValue(user());
		render(<LoginPage />);

		await fillAndSubmit();

		await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
	});

	it("sends a temporary password straight to the change screen", async () => {
		searchParams.current = new URLSearchParams("next=%2Fadmin%2Fusers");
		signIn.mockResolvedValue(user({ must_change_password: true }));
		render(<LoginPage />);

		await fillAndSubmit();

		await waitFor(() => expect(replace).toHaveBeenCalledWith("/change-password"));
	});
});

describe("when it goes wrong", () => {
	it("shows the engine's own sentence", async () => {
		signIn.mockRejectedValue(
			new ApiError({
				kind: "http",
				message: "Too many failed attempts. Try again in 15 minutes.",
				url: "",
				status: 429,
				errorCode: "ACCOUNT_LOCKED",
			}),
		);
		render(<LoginPage />);

		await fillAndSubmit();

		expect(
			await screen.findByText("Too many failed attempts. Try again in 15 minutes."),
		).toBeInTheDocument();
		expect(replace).not.toHaveBeenCalled();
	});

	it("announces the failure rather than only drawing it", async () => {
		// A sign-in failure moves no focus and changes nothing else on screen,
		// so without a live region a screen-reader user hears nothing happen.
		signIn.mockRejectedValue(
			new ApiError({ kind: "http", message: "Wrong.", url: "", status: 401, errorCode: "INVALID_CREDENTIALS" }),
		);
		render(<LoginPage />);

		await fillAndSubmit();

		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("Wrong.");
		expect(alert).toHaveAttribute("aria-live", "assertive");
	});

	it("clears the password after a wrong one, since the next try differs", async () => {
		signIn.mockRejectedValue(
			new ApiError({ kind: "http", message: "Wrong.", url: "", status: 401, errorCode: "INVALID_CREDENTIALS" }),
		);
		render(<LoginPage />);

		await fillAndSubmit();

		await screen.findByRole("alert");
		expect(screen.getByLabelText("Password")).toHaveValue("");
	});

	it("keeps the password when the engine was simply unreachable", async () => {
		// Same attempt again, not a different one. Wiping the field means
		// retyping a 16-character generated password to retry a network blip.
		signIn.mockRejectedValue(new ApiError({ kind: "network", message: "boom", url: "" }));
		render(<LoginPage />);

		await fillAndSubmit();

		await screen.findByRole("alert");
		expect(screen.getByLabelText("Password")).toHaveValue("hunter2hunter2");
	});

	it("names an unreachable engine instead of blaming the password", async () => {
		signIn.mockRejectedValue(new ApiError({ kind: "network", message: "boom", url: "" }));
		render(<LoginPage />);

		await fillAndSubmit();

		expect(await screen.findByText(/Cannot reach the engine/i)).toBeInTheDocument();
	});
});

describe("the password field", () => {
	it("is masked until the reveal is pressed", async () => {
		// Every password this app issues is a generated 16-character string read
		// off a screen or out of a chat message. Typing one blind is where the
		// support conversation starts.
		render(<LoginPage />);
		const field = screen.getByLabelText("Password");
		expect(field).toHaveAttribute("type", "password");

		await userEvent.click(screen.getByRole("button", { name: "Show password" }));
		expect(field).toHaveAttribute("type", "text");

		await userEvent.click(screen.getByRole("button", { name: "Hide password" }));
		expect(field).toHaveAttribute("type", "password");
	});

	it("reports which state it is in, not only what it will do", async () => {
		render(<LoginPage />);
		const toggle = screen.getByRole("button", { name: "Show password" });
		expect(toggle).toHaveAttribute("aria-pressed", "false");

		await userEvent.click(toggle);
		expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	it("does not submit the form when toggled", async () => {
		// A bare <button> inside a form defaults to type="submit", which would
		// try to sign in with a half-typed password on every reveal.
		render(<LoginPage />);
		await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
		await userEvent.click(screen.getByRole("button", { name: "Show password" }));
		expect(signIn).not.toHaveBeenCalled();
	});
});

describe("somebody who is already signed in", () => {
	it("is sent on rather than shown the form again", async () => {
		searchParams.current = new URLSearchParams("next=%2Fdashboards%2Fd1");
		authStatus.current = "signedIn";
		render(<LoginPage />);

		await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboards/d1"));
	});

	it("is sent to the change screen when a temporary password is outstanding", async () => {
		authStatus.current = "mustChangePassword";
		render(<LoginPage />);

		await waitFor(() => expect(replace).toHaveBeenCalledWith("/change-password"));
	});
});
