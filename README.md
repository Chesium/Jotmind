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

## Data & privacy

Persistent canonical data lives in PostgreSQL (added in later milestones). Browser storage is
**non-canonical**; preserve the database volume and back it up to avoid data loss.
