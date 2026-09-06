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
   */
  output: "standalone",

  /**
   * Do not name the framework and its version in a header on every response.
   * It tells an attacker which CVE list to work through and tells a legitimate
   * user nothing.
   */
  poweredByHeader: false,

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
