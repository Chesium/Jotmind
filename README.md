# JotMind

Privacy-first, self-hostable graph-based personal knowledge app with notes, sources, typed
entities, provenance-aware claims, custom schemas, AI proposal review, and restricted Datalog
reasoning.

## Monorepo layout

```
apps/
  api/        Express API server (@jotmind/api)
  web/        React + Vite web app (@jotmind/web)
packages/
  schemas/    Shared Zod schemas, types, and utilities (@jotmind/schemas)
infra/
  db/         Reference PostgreSQL image (Apache AGE + pgvector) + init scripts
```

The shared `@jotmind/schemas` package is imported by both the API and the web app to keep request
and response contracts in sync.

## Prerequisites

- Node.js >= 18.18
- pnpm 9 (`npm install -g pnpm@9` or via corepack)

## Getting started

```bash
pnpm install

# Run both apps in parallel (web on :5173, API on :3001)
pnpm dev

# Or run individually
pnpm --filter @jotmind/api dev
pnpm --filter @jotmind/web dev
```

The web dev server proxies `/api/*` to the API at `http://127.0.0.1:3001`.

## Quality scripts

| Script              | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `pnpm format`       | Format all files with Prettier                 |
| `pnpm format:check` | Verify formatting                              |
| `pnpm typecheck`    | Type-check every workspace package             |
| `pnpm lint`         | Lint with ESLint (flat config)                 |
| `pnpm test`         | Run unit tests (schemas + web)                 |
| `pnpm test:api`     | Run API tests                                  |
| `pnpm test:e2e`     | Run Playwright end-to-end tests                |
| `pnpm verify:quick` | `format:check` + `typecheck` + `lint` + `test` |
| `pnpm verify`       | Full suite incl. `test:api` and `test:e2e`     |

> Note: `pnpm test:e2e` requires Playwright browsers. Install them once with
> `pnpm --filter @jotmind/web exec playwright install chromium`.

## Database (PostgreSQL + Apache AGE + pgvector)

The canonical store is PostgreSQL 18 with [Apache AGE](https://age.apache.org/) (graph) and
[pgvector](https://github.com/pgvector/pgvector) (embeddings). A reference image and Compose file
are provided.

```bash
# Build & start PostgreSQL (binds to 127.0.0.1:5432 by default)
docker compose up -d --build db

# Point the API at it (or copy .env.example -> .env)
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/jotmind

# Apply migrations to create the initial schema
pnpm --filter @jotmind/api db:migrate

# Generate a new migration after editing src/db/schema.ts
pnpm --filter @jotmind/api db:generate
```

The API `/api/health` endpoint reports database connectivity and whether the `age` and `vector`
extensions are available. With no `DATABASE_URL` configured it reports `database.configured: false`
and stays `ok` (useful for unit tests and AI-disabled local runs).

API integration tests that need a live database (migrations + extension checks) run only when
`DATABASE_URL` is set; otherwise they are skipped so the default `pnpm test:api` stays green.

## Deployment

The reference `docker compose up -d --build` starts a **stateless Node API
container** (which also serves the built web assets for a simple single-origin
deployment at `http://127.0.0.1:3001`) alongside the PostgreSQL container. The
API binds to **localhost by default**; LAN/public exposure is an explicit opt-in,
and **CORS is deny-by-default** (never `*`). See
[docs/deployment.md](docs/deployment.md) for local development, local/LAN
production-style use, VPS/cloud self-hosting, separately-deployed static
frontends (`VITE_API_BASE_URL`), and the public-internet hardening checklist
(HTTPS/TLS reverse proxy, allowed origins, strong auth).

## Authentication & accounts

JotMind uses **local/server accounts** — no mandatory cloud account.

- **First-run setup:** when no users exist, the web app shows a setup screen that creates the
  initial **admin** account. `GET /api/auth/setup-status` reports whether setup is still required;
  `POST /api/auth/setup` is rejected once any account exists.
- **Passwords** are hashed with **Argon2id** (via `@node-rs/argon2`); plaintext is never stored.
- **Sessions** are server-side and **PostgreSQL-backed** (`sessions` table). The session token lives
  in a `jm_session` **HTTP-only** cookie (`Secure` in production / when `COOKIE_SECURE=true`,
  `SameSite=Lax`).
- **CSRF:** cookie-authenticated mutations require a synchronizer token. Each session has a
  `csrfToken` exposed via the readable `jm_csrf` cookie and the login/setup/`/me` responses; clients
  must echo it in the `x-csrf-token` header on `POST/PUT/PATCH/DELETE`.
- **Account creation is admin-controlled** after first-run setup: only `admin` accounts may call
  `POST /api/auth/users`.

## Data & privacy

Canonical data lives in **PostgreSQL**, persisted in the `jotmind-db` Docker volume. **Back up that
volume** (or use `pg_dump`) to preserve your data — losing it loses your Knowledge Bases.

Browser storage is **non-canonical**: it is only a cache/working copy and must never be treated as
the source of truth. Clearing browser data does not lose canonical content; deleting the database
volume does.

### Export & backup

A Knowledge Base owner/admin can export a KB from the in-app administration panel as **portable JSON**
(full-fidelity backup/restore), **Markdown** (human-readable, not full-fidelity), or **CSV** (structured
subset). Importing a portable JSON always creates a new Knowledge Base. Provider secrets such as API keys
are excluded from portable exports. Whole-instance PostgreSQL dump/restore is an operator maintenance
task. See [docs/backup-restore.md](docs/backup-restore.md) for details.
