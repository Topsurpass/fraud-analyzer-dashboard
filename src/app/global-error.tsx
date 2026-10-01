"use client";

/**
 * What shows when something fails above the page: the root layout, the auth
 * provider, or a server render. `(app)/error.tsx` cannot catch those (an error
 * boundary sits below its layout), so without this file Next shows its own
 * built-in screen, "This page couldn't load", on a black page, with no message
 * and nothing to report. That is exactly what a reader of a deployed copy saw
 * after signing in, and with no error text there was nothing to go on.
 *
 * This screen says what failed. A message thrown from a client component is
 * shown as it is; one thrown while rendering on the server arrives as a generic
 * sentence plus a `digest`, and the digest is what to search for in the
 * server's log. Both are printed so a screenshot is enough to diagnose from.
 *
 * It replaces the root layout when it renders, so it brings its own `<html>`
 * and cannot use the app's stylesheet or theme script: it carries a few inline
 * styles and follows the operating system's light or dark setting.
 */
export default function GlobalError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  /** Re-fetches the page from the server, then re-renders. Preferred. */
  retry?: () => void;
  /** Re-renders without re-fetching. The fallback on an older Next. */
  reset?: () => void;
}) {
  const again = retry ?? reset;
  return (
    <html lang="en">
      <head>
        <title>Fraud Analyzer: something went wrong</title>
        <style>{`
          :root { color-scheme: light dark; --bg:#f5f6fa; --card:#fff; --ink:#0f1222; --muted:#5b6078; --line:#dfe2ee; --accent:#4f46e5; --alert:#e11d48; }
          @media (prefers-color-scheme: dark) { :root { --bg:#080a13; --card:#0f1322; --ink:#eef0fb; --muted:#9aa1bd; --line:#232942; --accent:#7c7cff; } }
          body { margin:0; min-height:100dvh; display:grid; place-items:center; background:var(--bg); color:var(--ink); font:14px/1.5 system-ui, sans-serif; }
          main { box-sizing:border-box; width:min(30rem, 100% - 2rem); padding:1.5rem; border:1px solid var(--line); border-radius:12px; background:var(--card); }
          h1 { margin:0 0 .4rem; font-size:1.05rem; }
          p { margin:0; color:var(--muted); }
          pre { margin:1rem 0 0; padding:.6rem .75rem; max-height:9rem; overflow:auto; white-space:pre-wrap; word-break:break-word; border:1px solid var(--line); border-radius:8px; font:12px/1.5 ui-monospace, monospace; color:var(--ink); }
          .row { display:flex; gap:.5rem; margin-top:1rem; }
          button { padding:.45rem .9rem; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--ink); font:inherit; cursor:pointer; }
          button.primary { border-color:var(--accent); background:var(--accent); color:#fff; }
        `}</style>
      </head>
      <body>
        <main role="alert">
          <h1>The dashboard failed to load</h1>
          <p>
            Something broke before the page could be drawn. Your saved queries, rules and
            findings are stored on the engine and are unaffected.
          </p>
          {error.message || error.digest ? (
            <pre data-testid="error-detail">
              {[error.message, error.digest ? `digest: ${error.digest}` : ""]
                .filter(Boolean)
                .join("\n")}
            </pre>
          ) : null}
          <div className="row">
            {again ? (
              <button type="button" className="primary" onClick={() => again()}>
                Try again
              </button>
            ) : null}
            <button type="button" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
