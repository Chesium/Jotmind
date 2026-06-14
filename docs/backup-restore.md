# Backup, export, and restore (US-032)

JotMind offers two distinct kinds of backup, for two different audiences.

## 1. Per-user portable export/import (in-app)

Available to a Knowledge Base **owner/admin** from the KB administration panel.

| Format            | Purpose                             | Round-trip?                          |
| ----------------- | ----------------------------------- | ------------------------------------ |
| **Portable JSON** | Full-fidelity portable graph backup | ✅ Yes — use this for backup/restore |
| **Markdown**      | Human-readable review/reading       | ❌ No — not guaranteed full-fidelity |
| **CSV**           | Structured subset (entities only)   | ❌ No — subset only                  |

### Portable JSON

The portable JSON export captures the canonical graph content of a single Knowledge Base:

- entities
- claims, claim arguments, and claim **provenance**
- notes and sources
- citations (source excerpts)
- custom schemas **with their full version history**
- rules (with built-in module/pack provenance where applicable)
- export-time audit metadata (for reference only)

It **excludes operator/server secrets** such as AI provider API keys — those live in environment
configuration and the `ai_policies` table, never in portable graph data. Secret fields (e.g.
`apiKey`) are additionally stripped from every JSONB field on export.

**Importing** a portable JSON document always creates a **new Knowledge Base** owned by the
importer, with all internal IDs regenerated and cross-references (claim arguments, citation links,
schema versions) remapped. Import never mutates an existing Knowledge Base, so there is no merge or
conflict handling to reason about. The import generates its own audit events for the new Knowledge
Base; it does not replay the exported audit rows.

Endpoints:

- `GET /api/knowledge-bases/:kbId/export/json` (admin/owner)
- `GET /api/knowledge-bases/:kbId/export/markdown` (admin/owner)
- `GET /api/knowledge-bases/:kbId/export/csv` (admin/owner)
- `POST /api/knowledge-bases/import-portable` (authenticated + CSRF)

## 2. Server PostgreSQL dump/restore (operator maintenance)

This is **operator/administrator maintenance**, not a normal per-user portable export. Use it for
whole-instance restore that must preserve exact IDs, timestamps, users, sessions, jobs, and audit
history across **all** Knowledge Bases.

Canonical data lives in PostgreSQL, persisted in the `jotmind-db` Docker volume.

Back up:

```bash
docker compose exec db pg_dump -U postgres jotmind > jotmind-backup.sql
# or back up the whole volume
```

Restore:

```bash
docker compose exec -T db psql -U postgres jotmind < jotmind-backup.sql
```

Notes:

- This is a server-side operation requiring database/host access — it is not exposed to end users.
- Losing the `jotmind-db` volume loses all Knowledge Bases; the portable per-KB JSON export is the
  user-facing way to avoid lock-in for an individual Knowledge Base.
- Browser storage is non-canonical (cache only) and is never a backup.
