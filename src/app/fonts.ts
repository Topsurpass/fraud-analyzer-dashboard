import localFont from "next/font/local";

/**
 * The three type roles the design brief specifies, self-hosted.
 *
 * These are the same Google Fonts the brief names, in the same latin variable
 * cuts, but the files come from the `@fontsource-variable/*` packages rather
 * than from a build-time download or from binaries committed to this repo.
 *
 * Why not `next/font/google`: it downloads and self-hosts at build time, so the
 * runtime result is identical - no layout shift, no request to Google - but its
 * fetch times out on this machine under both Turbopack and webpack and fails
 * `next build` outright, while `curl` and node's `fetch` reach the same URLs
 * fine. Pointing `next/font/local` at an npm-provided file keeps every
 * `next/font` benefit (self-hosting, preload, size-adjusted fallback metrics)
 * with no network step in the build and nothing binary in version control.
 */

/** Display: page titles and dashboard names only. Used sparingly. */
export const spaceGrotesk = localFont({
  src: "../../node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2",
  weight: "300 700",
  style: "normal",
  display: "swap",
  variable: "--font-space-grotesk",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

/** UI: nav, labels, buttons, form fields, prose. */
export const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-inter",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

/** Data: every number, timestamp, hash and axis value in the app. */
export const jetBrainsMono = localFont({
  src: "../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  weight: "100 800",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains-mono",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});
