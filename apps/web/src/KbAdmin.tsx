import { useCallback, useEffect, useState } from 'react';
import {
  kbRoleSatisfies,
  portableKnowledgeBaseExportSchema,
  type AuditEvent,
  type KnowledgeBase,
  type PortableImportResult,
  type PublicJob,
} from '@jotmind/schemas';
import {
  csvExportUrl,
  importPortableKnowledgeBase,
  listKbAudit,
  listKbJobs,
  markdownExportUrl,
  portableJsonExportUrl,
} from './api.js';
import { useInvalidationEffect } from './invalidation.js';

/**
 * Admin/owner panel for a Knowledge Base (US-014 AC4). Surfaces the audit
 * summary and background job status so KB admins/owners can inspect activity
 * without needing a system-admin account. Only rendered for callers whose KB
 * role is at least `admin`.
 */
export function KbAdmin({ kb, csrfToken }: { kb: KnowledgeBase; csrfToken: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const canAdmin = kbRoleSatisfies(kb.role, 'admin');

  const load = useCallback(async () => {
    if (!canAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const [auditEvents, jobRows] = await Promise.all([listKbAudit(kb.id), listKbJobs(kb.id)]);
      setEvents(auditEvents);
      setJobs(jobRows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load admin data');
    } finally {
      setLoading(false);
    }
  }, [kb.id, canAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  // Job/audit status must not stay permanently stale after selected-KB jobs
  // change in another panel (e.g. an import enqueues or completes) — US-040 AC4.
  useInvalidationEffect(['jobs', 'audit'], () => void load());

  if (!canAdmin) return null;

  return (
    <section aria-label="kb-admin" data-testid="kb-admin">
      <h3>Administration — {kb.name}</h3>

      <ExportBackup kb={kb} csrfToken={csrfToken} />
      {error && <p data-testid="kb-admin-error">{error}</p>}
      {loading && <p data-testid="kb-admin-loading">Loading…</p>}

      <h4>Audit summary</h4>
      {events.length === 0 ? (
        <p data-testid="kb-audit-empty">No audit events yet.</p>
      ) : (
        <ul data-testid="kb-audit-list">
          {events.map((e) => (
            <li key={e.id} data-testid={`kb-audit-${e.id}`}>
              <code>{e.action}</code> on {e.targetType}
              {e.actorUserId ? ` by ${e.actorUserId}` : ''} —{' '}
              {new Date(e.createdAt).toLocaleString()}
            </li>
          ))}
        </ul>
      )}

      <h4>Job status</h4>
      {jobs.length === 0 ? (
        <p data-testid="kb-jobs-empty">No background jobs for this Knowledge Base.</p>
      ) : (
        <ul data-testid="kb-jobs-list">
          {jobs.map((j) => (
            <li key={j.id} data-testid={`kb-job-${j.id}`}>
              <code>{j.type}</code> — {j.status} (attempt {j.attempts}/{j.maxAttempts})
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Export & backup controls (US-032). Portable JSON is the full-fidelity
 * backup/restore format; Markdown is human-readable only; CSV is a structured
 * subset. Importing a portable JSON always creates a NEW Knowledge Base.
 */
function ExportBackup({ kb, csrfToken }: { kb: KnowledgeBase; csrfToken: string }) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PortableImportResult | null>(null);

  async function onImportFile(file: File) {
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const parsed = portableKnowledgeBaseExportSchema.parse(JSON.parse(await file.text()));
      const imported = await importPortableKnowledgeBase(parsed, csrfToken);
      setResult(imported);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div data-testid="kb-export">
      <h4>Export &amp; backup</h4>
      <p>
        <strong>Portable JSON</strong> is the full-fidelity backup format. <strong>Markdown</strong>{' '}
        is human-readable only (not a guaranteed round-trip). <strong>CSV</strong> is a structured
        subset (entities only). Server PostgreSQL dump/restore is an operator maintenance task — see
        the docs.
      </p>
      <ul>
        <li>
          <a data-testid="kb-export-json" href={portableJsonExportUrl(kb.id)}>
            Download portable JSON (full fidelity)
          </a>
        </li>
        <li>
          <a data-testid="kb-export-markdown" href={markdownExportUrl(kb.id)}>
            Download Markdown (human-readable)
          </a>
        </li>
        <li>
          <a data-testid="kb-export-csv" href={csvExportUrl(kb.id)}>
            Download CSV (structured subset)
          </a>
        </li>
      </ul>
      <p>
        <label>
          Import portable JSON (creates a new Knowledge Base):{' '}
          <input
            type="file"
            accept="application/json,.json"
            data-testid="kb-import-file"
            disabled={importing}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImportFile(file);
            }}
          />
        </label>
      </p>
      {importing && <p data-testid="kb-import-loading">Importing…</p>}
      {error && <p data-testid="kb-import-error">{error}</p>}
      {result && (
        <p data-testid="kb-import-result">
          Imported into new Knowledge Base “{result.knowledgeBaseName}” — {result.counts.entities}{' '}
          entities, {result.counts.claims} claims, {result.counts.notes} notes,{' '}
          {result.counts.sources} sources, {result.counts.citations} citations,{' '}
          {result.counts.schemaDefinitions} schemas, {result.counts.rules} rules.
          {result.warnings.length > 0 && ` (${String(result.warnings.length)} warning(s))`}
        </p>
      )}
    </div>
  );
}
