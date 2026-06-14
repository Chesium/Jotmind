# syntax=docker/dockerfile:1
#
# Reference image for the stateless JotMind API container (US-033).
#
# It runs the Express API (and, by default, serves the built web assets for a
# single-origin deployment) on Node 18. The app is run via `tsx` — the same
# runtime already used by the `dev`, `worker`, and `db:migrate` scripts —
# because the shared `@jotmind/schemas` package exports TypeScript source. The
# container is STATELESS: all canonical data lives in PostgreSQL (the `db`
# service / `jotmind-db` volume).

FROM node:18-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# Install workspace dependencies first (cached unless a manifest changes).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/schemas/package.json packages/schemas/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

# Copy the sources and build the web assets (served single-origin by the API).
COPY . .
RUN pnpm --filter @jotmind/web build
# Typecheck/emit the API to fail the build on type errors (the runtime uses tsx).
RUN pnpm --filter @jotmind/api build

FROM node:18-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# Bring over the installed workspace (incl. tsx) and the built web assets.
COPY --from=build /app /app

# Serve the built web assets single-origin (US-033 AC2) and bind on all
# interfaces INSIDE the container — publish to the host only via the compose
# port mapping (loopback by default).
ENV WEB_DIST_PATH=/app/apps/web/dist
ENV HOST=0.0.0.0
ENV PORT=3001
EXPOSE 3001

# Run pending migrations, then start the API.
CMD ["sh", "-c", "pnpm --filter @jotmind/api db:migrate && pnpm --filter @jotmind/api start"]
