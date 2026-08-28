import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/services/api-client";
import { MIN_PASSWORD_LENGTH } from "@/contracts/api";
import ChangePasswordPage from "./page";

const replace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
	usePathname: () => "/change-password",
}));

const changeOwnPassword = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
const authStatus = vi.hoisted(() => ({ current: "mustChangePassword" as string }));

vi.mock("@/services/auth/AuthContext", () => ({
	useAuth: () => ({
		status: authStatus.current,
		user: {
			id: "u1",
			email: "ada@example.com",
			full_name: "Ada Lovelace",
			role: "analyst",
			is_active: true,
			must_change_password: authStatus.current === "mustChangePassword",
			last_login_at: null,
			created_at: "2026-08-01T00:00:00Z",
		},
		busy: false,
		signIn: vi.fn(),
		signOut,
		changeOwnPassword,
		refresh: vi.fn(),
		can: () => false,
	}),
}));

const GOOD = "a-perfectly-fine-password";

async function fill({ current = "temp-one", next = GOOD, confirm = GOOD } = {}) {
	await userEvent.type(screen.getByLabelText(/password$/i, { selector: "#current-password" }), current);
	await userEvent.type(screen.getByLabelText("New password"), next);
	await userEvent.type(screen.getByLabelText("Confirm new password"), confirm);
}

const submit = () => screen.getByRole("button", { name: /Save new password/i });

beforeEach(() => {
	replace.mockReset();
	changeOwnPassword.mockReset().mockResolvedValue(undefined);
	signOut.mockReset().mockResolvedValue(undefined);
	authStatus.current = "mustChangePassword";
});

describe("the forced change", () => {
	it("says why it is being asked, and calls the old one temporary", async () => {
		render(<ChangePasswordPage />);
		expect(screen.getByText(/using a temporary password/i)).toBeInTheDocument();
		expect(screen.getByLabelText("Temporary password")).toBeInTheDocument();
	});

	it("offers a way out that is not just trying again", async () => {
		// Somebody who cannot reach the person who issued the password has to be
		// able to leave rather than being trapped on this screen.
		render(<ChangePasswordPage />);
		await userEvent.click(screen.getByRole("button", { name: /Sign out instead/i }));
		await waitFor(() => expect(signOut).toHaveBeenCalled());
	});

	it("saves and moves on to the app", async () => {
		render(<ChangePasswordPage />);
		await fill();
		await userEvent.click(submit());

		await waitFor(() => expect(changeOwnPassword).toHaveBeenCalledWith("temp-one", GOOD));
		expect(replace).toHaveBeenCalledWith("/");
	});

	it("says the other sessions are ending, because they are", async () => {
		render(<ChangePasswordPage />);
		expect(screen.getByText(/Every other session on this account is signed out/i)).toBeInTheDocument();
	});
});

describe("the voluntary change", () => {
	it("drops the temporary framing and names the account", () => {
		authStatus.current = "signedIn";
		render(<ChangePasswordPage />);
		expect(screen.getByText(/Signed in as ada@example.com/)).toBeInTheDocument();
		expect(screen.getByLabelText("Current password")).toBeInTheDocument();
		expect(screen.queryByText(/Sign out instead/)).not.toBeInTheDocument();
	});
});

describe("what it refuses before spending a round trip", () => {
	it("will not submit a password below the engine's minimum", async () => {
		render(<ChangePasswordPage />);
		await fill({ next: "short", confirm: "short" });
		expect(submit()).toBeDisabled();
		expect(changeOwnPassword).not.toHaveBeenCalled();
	});

	it("says how many characters are still missing", async () => {
		render(<ChangePasswordPage />);
		await userEvent.type(screen.getByLabelText("New password"), "abcdefghij");
		expect(screen.getByText(`${MIN_PASSWORD_LENGTH - 10} more characters needed.`)).toBeInTheDocument();
	});

	it("catches a mistyped confirmation on the field, not after the request", async () => {
		render(<ChangePasswordPage />);
		await fill({ confirm: "a-perfectly-fine-passworx" });
		expect(screen.getByText("These do not match.")).toBeInTheDocument();
		expect(submit()).toBeDisabled();
	});

	it("refuses to set the password to the one already in use", async () => {
		render(<ChangePasswordPage />);
		await fill({ current: GOOD, next: GOOD, confirm: GOOD });
		expect(screen.getByText(/different from the current one/i)).toBeInTheDocument();
		expect(submit()).toBeDisabled();
	});
});

describe("when the engine refuses", () => {
	it("shows its sentence and stays put", async () => {
		changeOwnPassword.mockRejectedValue(
			new ApiError({
				kind: "http",
				message: "That password is too common. Choose another.",
				url: "",
				status: 400,
				errorCode: "WEAK_PASSWORD",
			}),
		);
		render(<ChangePasswordPage />);
		await fill();
		await userEvent.click(submit());

		expect(
			await screen.findByText("That password is too common. Choose another."),
		).toBeInTheDocument();
		expect(replace).not.toHaveBeenCalled();
	});

	it("does not wipe what was typed", async () => {
		// The client blocklist is advisory; the engine holds the real one. Being
		// sent back to an empty form for a rule only the engine knows is hostile.
		changeOwnPassword.mockRejectedValue(
			new ApiError({ kind: "http", message: "Too common.", url: "", status: 400 }),
		);
		render(<ChangePasswordPage />);
		await fill();
		await userEvent.click(submit());

		await screen.findByText("Too common.");
		expect(screen.getByLabelText("New password")).toHaveValue(GOOD);
	});
});
