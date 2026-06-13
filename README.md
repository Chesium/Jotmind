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

## Data & privacy

Canonical data lives in **PostgreSQL**, persisted in the `jotmind-db` Docker volume. **Back up that
volume** (or use `pg_dump`) to preserve your data — losing it loses your Knowledge Bases.

Browser storage is **non-canonical**: it is only a cache/working copy and must never be treated as
the source of truth. Clearing browser data does not lose canonical content; deleting the database
volume does.
