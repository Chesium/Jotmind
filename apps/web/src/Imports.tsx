import { useCallback, useEffect, useRef, useState } from 'react';
import {
  kbRoleSatisfies,
  type ImportRequest,
  type JobStatus,
  type KnowledgeBase,
  type PublicJob,
} from '@jotmind/schemas';
import { createImport, listImports } from './api.js';
import { useInvalidate, useInvalidationEffect } from './invalidation.js';

/** Jobs in these states are finished; no further status changes are expected. */
const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'succeeded',
  'failed',
  'cancelled',
]);

/**
 * Reviewable data import (US-031). Editors import plain text/Markdown as a
 * Note/Source (AC1) or structured CSV mapped to entity/claim fields (AC2). An
 * import never mutates the graph directly: it enqueues a durable job (AC4) that
 * builds a pending **Proposal** (AC3); the candidate changes then appear in the
 * Proposals queue for review/accept. Viewers can watch import status read-only.
 */
export function Imports({ kb, csrfToken }: { kb: KnowledgeBase; csrfToken: string }) {
  const canEdit = kbRoleSatisfies(kb.role, 'editor');
  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const invalidate = useInvalidate();
  // Last-seen status per import job, so a poll/refresh can detect when a job
  // transitions into a terminal state and a new pending proposal may exist.
  const lastStatusRef = useRef<Map<string, JobStatus>>(new Map());

  // Text/Markdown import form state.
  const [textFormat, setTextFormat] = useState<'text' | 'markdown'>('text');
  const [textTarget, setTextTarget] = useState<'note' | 'source'>('note');
  const [textTitle, setTextTitle] = useState('');
  const [textContent, setTextContent] = useState('');

  // CSV import form state.
  const [csvContent, setCsvContent] = useState('');
  const [csvNameColumn, setCsvNameColumn] = useState('name');
  const [csvType, setCsvType] = useState('Person');

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const next = await listImports(kb.id);
      setJobs(next);
      // Detect any import job that just finished. Completion means the job may
      // have produced a pending Proposal, so refresh the Proposals queue and the
      // job-status surfaces (KbAdmin) without a page reload (US-040 AC2).
      let completed = false;
      for (const job of next) {
        const prev = lastStatusRef.current.get(job.id);
        if (prev && !TERMINAL_JOB_STATUSES.has(prev) && TERMINAL_JOB_STATUSES.has(job.status)) {
          completed = true;
        }
      }
      lastStatusRef.current = new Map(next.map((j) => [j.id, j.status]));
      if (completed) invalidate(['proposals', 'jobs', 'audit']);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load imports');
    }
  }, [kb.id, invalidate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refresh import status when jobs change elsewhere (e.g. a job is processed).
  useInvalidationEffect(['jobs'], () => void refresh());

  // While any import job is still queued/running, poll so its completion (and
  // the resulting pending proposal) surfaces without a manual refresh (AC2).
  const hasPendingJobs = jobs.some((j) => !TERMINAL_JOB_STATUSES.has(j.status));
  useEffect(() => {
    if (!hasPendingJobs) return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [hasPendingJobs, refresh]);

  async function submit(request: ImportRequest, label: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await createImport(kb.id, request, csrfToken);
      setNotice(`${label} queued (job ${res.jobId.slice(0, 8)}…). Review it in Proposals shortly.`);
      // Enqueuing creates a durable job + an audit event; refresh the job-status
      // panels (KbAdmin) without a reload (US-040 AC1).
      invalidate(['jobs', 'audit']);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="imports" data-testid="imports">
      <h3>Import data</h3>
      <p>
        Import existing notes or structured data. Imports create reviewable proposals — nothing is
        added to the graph until you accept it in the Proposals queue.
      </p>

      {canEdit ? (
        <>
          <fieldset data-testid="imports-text">
            <legend>Import text / Markdown</legend>
            <label>
              Format{' '}
              <select
                data-testid="imports-text-format"
                value={textFormat}
                onChange={(e) => setTextFormat(e.target.value as 'text' | 'markdown')}
              >
                <option value="text">Plain text</option>
                <option value="markdown">Markdown</option>
              </select>
            </label>{' '}
            <label>
              Store as{' '}
              <select
                data-testid="imports-text-target"
                value={textTarget}
                onChange={(e) => setTextTarget(e.target.value as 'note' | 'source')}
              >
                <option value="note">Note</option>
                <option value="source">Source</option>
              </select>
            </label>
            <br />
            <input
              type="text"
              placeholder="Title (optional)"
              data-testid="imports-text-title"
              value={textTitle}
              onChange={(e) => setTextTitle(e.target.value)}
            />
            <br />
            <textarea
              placeholder="Paste text or Markdown to import"
              data-testid="imports-text-content"
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              rows={4}
            />
            <br />
            <button
              type="button"
              disabled={busy || textContent.trim() === ''}
              data-testid="imports-text-submit"
              onClick={() =>
                void submit(
                  {
                    format: textFormat,
                    target: textTarget,
                    ...(textTitle.trim() ? { title: textTitle.trim() } : {}),
                    content: textContent,
                  },
                  'Text import',
                )
              }
            >
              Import as {textTarget}
            </button>
          </fieldset>

          <fieldset data-testid="imports-csv">
            <legend>Import CSV → entities</legend>
            <p>
              <small>
                Paste CSV with a header row. Each data row becomes a proposed entity of the chosen
                type, named from the chosen column.
              </small>
            </p>
            <label>
              Entity type{' '}
              <input
                type="text"
                data-testid="imports-csv-type"
                value={csvType}
                onChange={(e) => setCsvType(e.target.value)}
              />
            </label>{' '}
            <label>
              Name column{' '}
              <input
                type="text"
                data-testid="imports-csv-name-column"
                value={csvNameColumn}
                onChange={(e) => setCsvNameColumn(e.target.value)}
              />
            </label>
            <br />
            <textarea
              placeholder={'name,role\nAda Lovelace,Mathematician\nCharles Babbage,Inventor'}
              data-testid="imports-csv-content"
              value={csvContent}
              onChange={(e) => setCsvContent(e.target.value)}
              rows={4}
            />
            <br />
            <button
              type="button"
              disabled={
                busy ||
                csvContent.trim() === '' ||
                csvType.trim() === '' ||
                csvNameColumn.trim() === ''
              }
              data-testid="imports-csv-submit"
              onClick={() =>
                void submit(
                  {
                    format: 'csv',
                    content: csvContent,
                    mapping: {
                      target: 'entity',
                      type: csvType.trim(),
                      nameColumn: csvNameColumn.trim(),
                    },
                  },
                  'CSV import',
                )
              }
            >
              Import CSV
            </button>
          </fieldset>
        </>
      ) : (
        <p data-testid="imports-readonly">You need editor access to import data.</p>
      )}

      {notice && <p data-testid="imports-notice">{notice}</p>}
      {error && <p data-testid="imports-error">{error}</p>}

      <h4>Recent imports</h4>
      <button type="button" onClick={() => void refresh()} data-testid="imports-refresh">
        Refresh status
      </button>
      {jobs.length === 0 ? (
        <p data-testid="imports-empty">No imports yet.</p>
      ) : (
        <ul data-testid="imports-list">
          {jobs.map((job) => {
            const result = job.result as
              | { status?: string; itemCount?: number; error?: string | null }
              | null
              | undefined;
            return (
              <li key={job.id} data-testid={`imports-job-${job.id}`}>
                <strong>{job.status}</strong>
                {result?.status ? ` · ${result.status}` : ''}
                {typeof result?.itemCount === 'number'
                  ? ` · ${String(result.itemCount)} proposed change(s)`
                  : ''}
                {job.failureReason && (
                  <span data-testid={`imports-job-failure-${job.id}`}>
                    {' '}
                    — failed: {job.failureReason}
                  </span>
                )}
                {result?.error && (
                  <span data-testid={`imports-job-error-${job.id}`}> — {result.error}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
