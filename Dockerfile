# Production image for the Switchboard dashboard.
#
# Build context is this directory:
#     docker build -t switchboard-dashboard .
#
# Three stages, because the thing that installs 386 npm packages and the thing
# that serves requests should not be the same filesystem. The runtime layer
# carries a Node runtime, the traced server bundle, and nothing else: no npm,
# no TypeScript, no test framework, no source.
#
# The base is pinned by digest as well as tag, so a rebuild next year installs
# the same Node and the same libc. It also removes a tag-to-digest lookup from
# every build: with only a tag, BuildKit contacts the registry even when the
# image is already local, and that request is a build failure whenever the
# registry is slow - observed here twice as `failed to fetch anonymous token:
# TLS handshake timeout` on a machine that had the image sitting in its cache.
#
# Bump it deliberately:
#     docker buildx imagetools inspect node:22-slim --format '{{.Manifest.Digest}}'
ARG NODE_IMAGE=node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5


# --- deps -------------------------------------------------------------------
# Separated from the build so a source-only change reuses the install layer.
# `npm ci` and not `npm install`: it installs exactly what package-lock.json
# pins and fails if the lockfile disagrees with package.json, which is the
# difference between a reproducible image and one that drifts on a Tuesday.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci


# --- builder ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next inlines NEXT_PUBLIC_* variables into the client bundle at build time.
# There are none here on purpose - ENGINE_BASE_URL is read at runtime, in the
# server-side proxy, precisely so the engine's address never reaches a browser
# - so nothing has to be passed in here, and nothing environment-specific is
# baked into the image. One image runs in any environment.
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
RUN npm run build


# --- runtime ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as a non-root user. `node` already exists in this image at uid 1000.
# Deliberately NOT --chown: the application files stay root-owned and read-only
# to the service account, so a bug in the running server cannot rewrite its own
# code. The process writes nothing to disk - all state is in the engine.
COPY --from=builder /app/.next/standalone ./
# `output: "standalone"` traces what the server imports and copies only that.
# In next.config.ts that setting is conditional - off when VERCEL is set,
# because Vercel traces files itself and standalone moves the traces out from
# under it - so a reader who greps the config and finds a ternary rather than a
# plain string is looking at the right thing. This COPY is what fails, loudly,
# if standalone ever stops being produced for the image build.
# These two are outside that trace because Next assumes a CDN serves them, so
# they are copied in by hand. Without them the app returns correct HTML with no
# CSS and no fonts, which is the confusing failure this comment exists to
# shorten.
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER node
EXPOSE 3000

# Liveness. `/healthz` deliberately does not check the engine: a healthcheck
# that fails on a dependency outage makes Docker restart a dashboard that was
# working, turning one outage into a restart loop on top of it. `/readyz` is
# the one that looks downstream, and nothing restarts on its answer.
#
# Uses Node rather than curl or wget, neither of which exists in a slim base.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so node is PID 1 and takes SIGTERM directly: `docker stop` drains
# in milliseconds instead of waiting out the ten-second kill timeout.
CMD ["node", "server.js"]
