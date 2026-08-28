import { ApiError } from "@/services/api-client";

/**
 * One line to show a person when an auth action fails.
 *
 * The rule is: the engine's own message wins whenever there is one. It is
 * already written for a human ("Too many failed attempts. Try again in 15
 * minutes.", "This needs an administrator account.") and it is the half that
 * knows the specifics - how many minutes, which rule the password broke.
 * Rewriting it here would produce two vocabularies for one system and lose the
 * detail in the process.
 *
 * What this adds is the cases the engine never got to answer, where an
 * `ApiError` carries a transport failure and no message worth showing. Those
 * are the ones a user is most likely to misread as "wrong password", so they
 * are named explicitly rather than falling through to a status code.
 */
export function authErrorMessage(error: unknown): string {
	if (!(error instanceof ApiError)) {
		return error instanceof Error && error.message
			? error.message
			: "Something went wrong. Try again.";
	}

	switch (error.kind) {
		case "network":
			return "Cannot reach the engine. Check that it is running, then try again.";
		case "timeout":
			return "The engine did not answer in time. Try again.";
		case "aborted":
			return "Cancelled.";
	}

	// An HTTP failure with the engine's envelope. `messageFromBody` has already
	// pulled `message` out of it, so `error.message` is the engine's sentence.
	if (error.message && !error.message.startsWith("Engine returned HTTP")) {
		return error.message;
	}

	// No envelope: a proxy or a gateway answered instead of the engine.
	if (error.status === 401) return "That email and password do not match an account.";
	if (error.status === 429) return "Too many attempts. Wait a moment, then try again.";
	if (error.status && error.status >= 500) {
		return "The engine failed to answer. Try again in a moment.";
	}
	return "Something went wrong. Try again.";
}

/**
 * Whether a failed sign-in should keep the password in the field.
 *
 * A wrong password is worth clearing - the next attempt is a different string.
 * Everything else (the engine was unreachable, it rate-limited us, it was
 * mid-restart) is the same attempt again, and wiping the field means retyping a
 * 16-character generated password to retry something that was never about the
 * password.
 */
export function shouldClearPassword(error: unknown): boolean {
	return error instanceof ApiError && error.errorCode === "INVALID_CREDENTIALS";
}
