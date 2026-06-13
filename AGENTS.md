# JotMind — Agent Guide

## Environment constraints

- Only **Node 18** is available in this environment. Pin tooling to Node-18-compatible versions:
  Vite 5, Vitest 2, ESLint 9, TypeScript 5.x. Latest pnpm requires Node 22, so use **pnpm 9**
  (`npm install -g pnpm@9`; npm global prefix is set to `~/.npm-global`, so ensure
  `~/.npm-global/bin` is on `PATH`).

## Monorepo structure

- pnpm workspace: `apps/*` and `packages/*` (see `pnpm-workspace.yaml`).
- `@jotmind/schemas` is the shared Zod schema/type/util package, consumed by both apps via
  `"workspace:*"`. Its `package.json` `exports`/`main` point at **TypeScript source** (`./src/index.ts`),
  not built `dist`. This lets `tsc` (with `moduleResolution: "Bundler"`) and Vite/Vitest resolve it
  directly without a build step.

## TypeScript conventions

- All tsconfigs extend `tsconfig.base.json` (strict, `verbatimModuleSyntax`, `isolatedModules`,
  `noUncheckedIndexedAccess`). Because of `verbatimModuleSyntax`, import types with
  `import { type Foo }` / `import type`.
- Relative imports use `.js` extensions (ESM + Bundler resolution) even for `.ts`/`.tsx` files.
- **Do NOT** add TS project `references` from apps to `packages/schemas`. Composite references make
  `tsc` resolve the dependency from unbuilt `dist/*.d.ts` and fail with TS6305. Rely on package
  `exports` → source instead.

## Validation

- Run `pnpm verify:quick` for fast feedback; `pnpm verify` for the full suite (adds API + e2e).
- `pnpm test` excludes `@jotmind/api` (uses a `--filter=!@jotmind/api`); API tests run via
  `pnpm test:api`. Keep this split when adding packages.
- Playwright browsers must be installed once:
  `pnpm --filter @jotmind/web exec playwright install chromium`.
- Prettier ignores Ralph/agent scaffolding (`prd.json`, `progress.txt`, `prompt.md`, `.agents`, etc.)
  via `.prettierignore`. Add new non-source top-level files there if they trip `format:check`.
