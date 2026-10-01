import type { UserRead } from "@/contracts/api";
import { ApiError } from "./errors";

/** The fields the app reads off the signed-in user without checking. */
const REQUIRED = ["id", "email", "full_name", "role"] as const;

/**
 * Accept the engine's account object only if it has what the app depends on.
 *
 * The user comes from the engine as JSON and the rail, the overview and the
 * account page read `full_name` and `email` straight off it. An engine that
 * sends something else (an older or different build than this dashboard was
 * written for) used to get past sign-in and then crash the whole app a moment
 * later with "Cannot read properties of undefined (reading 'trim')", on a
 * screen that said nothing about why. Checked here, at the one place the user
 * comes in, the same mismatch is a sign-in error that names the missing
 * fields and shows what was sent, which is what anyone needs to fix it.
 */
export function assertUserRead(raw: unknown, url: string): UserRead {
  const received = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const missing = REQUIRED.filter((field) => typeof received?.[field] !== "string" || received[field] === "");
  if (received && missing.length === 0) return received as unknown as UserRead;

  const sent = received ? Object.keys(received) : [typeof raw];
  // `{token, user}` is the engine's own login answer. This app's `/api/auth/login`
  // route unwraps it into the user and a cookie, so seeing it here means the
  // request never went through that route.
  if (received && "token" in received && "user" in received) {
    throw new ApiError({
      kind: "http",
      status: 502,
      errorCode: "BYPASSED_PROXY",
      url,
      message:
        "The browser reached the engine directly instead of going through this dashboard's /api route. " +
        "Remove NEXT_PUBLIC_API_BASE_URL from the deployment's environment variables and redeploy; " +
        "ENGINE_BASE_URL is the only variable that should point at the engine.",
      detail: { missing, sent },
    });
  }
  throw new ApiError({
    kind: "http",
    status: 502,
    errorCode: "UNEXPECTED_ENGINE_RESPONSE",
    url,
    message: received
      ? `The engine sent an account without ${missing.join(", ")}. It is probably a different build of the engine than this dashboard expects (it sent: ${sent.join(", ") || "nothing"}).`
      : "The engine answered with something that is not an account.",
    detail: { missing, sent },
  });
}
