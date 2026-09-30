import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Emit a self-contained server bundle at `.next/standalone`.
   *
   * Without this, running the app in production means shipping the whole
   * `node_modules` tree - 386 packages, most of them build-time only. Next
   * traces what the server actually imports at runtime and copies just that,
   * which is what lets the runtime image start from a bare `node:22-slim` with
   * no `npm install` step and no build tooling in the final layer.
   *
   * The trade is that `.next/static` and `public/` are NOT part of the traced
   * output - Next assumes a CDN serves them - so the Dockerfile copies both in
   * by hand. If a deploy ever comes up with working HTML and no CSS, that copy
   * is the first place to look.
   *
   * ## Why this is conditional
   *
   * Vercel does its own file tracing, and its packaging step reads the
   * `.nft.json` trace files from `.next/`. Standalone mode moves them under
   * `.next/standalone/`, so that step opens a path that is no longer there and
   * the deployment fails after a build that looked fine:
   *
   *     ENOENT: no such file or directory,
   *     open '/vercel/path0/.next/next-server.js.nft.json'
   *
   * It fails only there, because the file does exist locally - standalone
   * produces it, just somewhere else. Standalone is a self-hosting option; on a
   * platform that traces for you it is not merely unnecessary but actively
   * wrong.
   *
   * `VERCEL` is set to "1" by Vercel's build environment, so neither side needs
   * configuring. The default direction is deliberate: production is Docker, so
   * the Docker path is the one that must not be forgettable. An opt-in flag
   * that went missing would produce an image that dies at
   * `COPY .next/standalone`; this way the only environment that deviates is the
   * one that identifies itself.
   *
   * `src/next-config.test.ts` holds both branches to their behaviour.
   */
  output: process.env.VERCEL ? undefined : "standalone",

  /**
   * Do not name the framework and its version in a header on every response.
   * It tells an attacker which CVE list to work through and tells a legitimate
   * user nothing.
   */
  poweredByHeader: false,

  /**
   * Lets a second `next dev` run beside the main one (for example against
   * `scripts/mock-engine.mjs`) without fighting it over `.next`. Unset in
   * every real environment, where this is the framework default.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",

  /**
   * The reverse proxy compresses, not this process.
   *
   * Measured: with this at its default, a 209,790-byte proxied payload reached
   * a client that had sent `Accept-Encoding: gzip` as 209,790 uncompressed
   * bytes - so the default was not buying anything on the route that carries
   * the large payloads, while leaving the door open for a future Next release
   * to start compressing behind a proxy that already does. Caddy's `encode
   * zstd gzip` (engine repo, deploy/Caddyfile) does it once, offers zstd,
   * and does it in Go rather than on the Node event loop.
   *
   * If this app is ever run without a compressing proxy in front of it, flip
   * this back to true - otherwise every response goes out raw.
   */
  compress: false,
};

export default nextConfig;
