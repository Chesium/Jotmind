import { useEffect, useState } from 'react';
import {
  kbRoleSatisfies,
  type AuditEvent,
  type KnowledgeBase,
  type PublicJob,
} from '@jotmind/schemas';
import { listKbAudit, listKbJobs } from './api.js';

/**
 * Admin/owner panel for a Knowledge Base (US-014 AC4). Surfaces the audit
 * summary and background job status so KB admins/owners can inspect activity
 * without needing a system-admin account. Only rendered for callers whose KB
 * role is at least `admin`.
 */
export function KbAdmin({ kb }: { kb: KnowledgeBase }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const canAdmin = kbRoleSatisfies(kb.role, 'admin');

  useEffect(() => {
    if (!canAdmin) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([listKbAudit(kb.id), listKbJobs(kb.id)])
      .then(([auditEvents, jobRows]) => {
        if (cancelled) return;
        setEvents(auditEvents);
        setJobs(jobRows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load admin data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kb.id, canAdmin]);

  if (!canAdmin) return null;

  return (
    <section aria-label="kb-admin" data-testid="kb-admin">
      <h3>Administration — {kb.name}</h3>
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
