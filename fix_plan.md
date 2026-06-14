# V1 verification and hardening (US-034)

## Verification gates

### `pnpm verify` — authoritative no-infra gate

Runs `format:check`, `typecheck`, `lint`, `test`, `test:api`, `test:e2e` (AC1).
Requires no PostgreSQL, no API server, and no Ollama.

- `test:api` runs with `JOTMIND_VERIFY=true`, which loads
  `apps/api/src/test/verify-env.ts` — it strips real AI provider key env vars and
  rejects any non-`mock` `AI_PROVIDER_CONFIG`, so every AI/embedding assertion
  uses the deterministic local mock provider only (AC2).
- DB integration tests `describe.skipIf(!DATABASE_URL)`, so they no-op here.
- `test:e2e` runs only the no-infra smoke spec (`e2e/smoke.spec.ts`).

### `pnpm verify:db` — infra-backed acceptance gate

`pnpm test:api:db && pnpm test:e2e:real`. Requires the compose database
(`docker compose up -d --build db`).

- `test:api:db` applies migrations then runs the full API suite (including the 18
  integration test files) against the test PostgreSQL container (AC5).
- `test:e2e:real` boots the real Express API (mock AI provider) + Vite dev server
  and runs `e2e/v1-flows.real.spec.ts`, covering login/setup, KB selection,
  entity/claim CRUD, search/views, AI proposal review (mock provider), reasoning
  run, and JSON export/import (AC4). `global-setup.ts` migrates + resets the DB
  first. The mock AI provider is injected via the Playwright webServer `env`.

### `pnpm verify:local-ai` — manual local-inference gate (AC3)

Runs `apps/api/src/ai/ollama.local-ai.test.ts` via `vitest.local-ai.config.ts`.
EXCLUDED from `pnpm verify` (the default vitest config excludes
`**/*.local-ai.test.ts`). Skips entirely unless `OLLAMA_BASE_URL` is set:

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434 \
OLLAMA_LLM_MODEL=llama3 \
OLLAMA_EMBEDDING_MODEL=nomic-embed-text \
pnpm verify:local-ai
```

## Interactive browser verification (AC6)

The `dev-browser` interactive verification skill/tooling is **not available** in
this environment. Headless Playwright + Chromium coverage substitutes for it via
`pnpm test:e2e` (smoke) and `pnpm test:e2e:real` (critical flows). Manual
interactive browser verification is therefore **deferred** and does not block V1
while Playwright is green.

Deferred manual interactive checklist (re-run by hand if/when a browser tool is
available):

- [ ] First-run setup + login/logout look correct.
- [ ] KB creation/selection UX.
- [ ] Entity / claim create / edit / delete.
- [ ] Search + Network / Timeline / Table / Sources views render.
- [ ] Mock AI proposal review (capture → propose → accept).
- [ ] Rule authoring + run + accept-as-claim.
- [ ] Portable JSON export download + import.

## Remaining stubs / deferred behavior in V1 (AC7)

| Stub / deferral                                                          | Default?                                                                           | Runtime visibility                                                                                                                                        | On critical path?                      |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `stubProjector` (`GRAPH_PROJECTOR=stub`)                                 | No — real `ageProjector` is default                                                | Logged once at boot; exposed via `GET /api/graph/projection/status` (`stubbed` flag) and surfaced in the GraphViews UI banner (`graph-projector-stubbed`) | No                                     |
| Mock AI / `MockGraphExtractor` + mock command/answer/embedding providers | No — only when `AI_PROVIDER_CONFIG` is mock and `AI_DEMO_EXTRACTION=true`/non-prod | Labeled `Mock AI / deterministic demo output` in the capture/proposal UI (`capture-demo-label`)                                                           | No                                     |
| Query-time vector search (embedding the query at search time)            | Deferred                                                                           | UI shows `*-vector-unavailable` notices in command/answers/search when semantic search isn't available; manual token search always works                  | No — token search is the promised path |
| AI-assisted schema migration (US-028 AC7 "if present")                   | Not implemented (vacuously satisfied)                                              | n/a                                                                                                                                                       | No                                     |

None of these are on a critical promised V1 path: the real AGE projector,
deterministic mock for demos/tests, and relational token search are the defaults.
