/**
 * Signing the script lanes in.
 *
 * Every endpoint on the engine except `/health`, `/ready` and `/auth/login`
 * now needs a session, so the seeding and smoke scripts need one too. This is
 * the one place that knows how to get it, because four scripts each growing
 * their own copy is four places to fix when the header changes.
 *
 * The first administrator cannot be created over HTTP - deliberately, and the
 * engine's own CLI docstring says why: an endpoint that mints an administrator
 * is reachable by anything that can reach the service. So these scripts sign in
 * as an account that already exists, and say exactly which command creates one
 * when they cannot.
 */

/** Where the browser keeps the token. Must match `src/services/auth/token.ts`. */
export const TOKEN_STORAGE_KEY = "fae.session-token";

export const DEFAULT_EMAIL = process.env.FAE_SMOKE_EMAIL ?? "admin@example.com";
export const DEFAULT_PASSWORD = process.env.FAE_SMOKE_PASSWORD ?? "";

/**
 * Exchange credentials for a token, or explain what to do instead.
 *
 * Exits rather than throwing: every caller is a script whose remaining work is
 * meaningless without a session, and a stack trace here would bury the one line
 * that actually helps.
 */
export async function signIn(engine, { email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD } = {}) {
  if (!password) {
    console.error(
      "no password given. Pass --password=..., or set FAE_SMOKE_PASSWORD.\n" +
        "To create the account in the first place, from services/analyzer:\n" +
        "  uv run switchboard create-admin",
    );
    process.exit(2);
  }

  let response;
  try {
    response = await fetch(`${engine}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (cause) {
    console.error(`could not reach ${engine}: ${cause.message}`);
    process.exit(2);
  }

  if (!response.ok) {
    const body = await response.text();
    console.error(`sign-in as ${email} failed (HTTP ${response.status}): ${body}`);
    if (response.status === 401) {
      console.error(
        "If this account does not exist yet, create it from services/analyzer:\n" +
          "  uv run switchboard create-admin",
      );
    }
    process.exit(2);
  }

  const { token, user } = await response.json();
  return { token, user };
}

/** `fetch` with the session attached. Same signature as `fetch` otherwise. */
export function authed(token) {
  return (url, init = {}) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    });
}

/**
 * Make a browser context arrive already signed in.
 *
 * An init script rather than driving the login form: these lanes are testing
 * charts and layout, and making every one of them type a password first would
 * be slow and would make an unrelated login regression fail all of them. The
 * lane that tests signing in does drive the form - see `scripts/smoke-auth.mjs`.
 *
 * `addInitScript` runs before any page script on every navigation in the
 * context, which is what the app's own token store reads on boot.
 */
export async function seedSession(context, token) {
  await context.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // A browser refusing storage. The lane will fail at the first guarded
        // page with a clear message rather than here.
      }
    },
    [TOKEN_STORAGE_KEY, token],
  );
}
