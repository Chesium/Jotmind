import {
  ImportParseError,
  buildImportChanges,
  type ImportJobPayload,
  type ImportJobResult,
} from '@jotmind/schemas';
import type { ProposalStore } from '../proposals/store.js';

export interface ImportRunnerDeps {
  proposalStore: ProposalStore;
}

/**
 * Process an import (US-031). Pure orchestration over an injectable
 * {@link ProposalStore} so it unit-tests with an in-memory fake (no live DB).
 *
 * The import is parsed into candidate {@link ProposalChange}s and stored as a
 * single pending proposal of kind `import` (AC3) — it NEVER writes canonical
 * graph records directly. A parse/mapping failure ({@link ImportParseError}) is
 * surfaced as an `error` result so the durable job records a clear, user-visible
 * failure reason (AC4). On success the returned result references the created
 * proposal so reviewers can find it.
 */
export async function runImport(
  deps: ImportRunnerDeps,
  payload: ImportJobPayload,
): Promise<ImportJobResult> {
  const { proposalStore } = deps;
  const { knowledgeBaseId, requestedBy, request } = payload;

  let changes;
  let rowCount: number;
  try {
    const built = buildImportChanges(request);
    changes = built.changes;
    rowCount = built.rowCount;
  } catch (err) {
    if (err instanceof ImportParseError) {
      return { status: 'error', proposalId: null, itemCount: 0, rowCount: 0, error: err.message };
    }
    throw err;
  }

  if (changes.length === 0) {
    return { status: 'empty', proposalId: null, itemCount: 0, rowCount, error: null };
  }

  if (!requestedBy) {
    // The import endpoint always records the acting editor; a missing actor is a
    // programming error (the proposal's createdBy/audit FK requires a real user).
    throw new Error('Import job is missing the requesting user');
  }

  const proposal = await proposalStore.createProposal({
    knowledgeBaseId,
    kind: 'import',
    changes: { items: changes },
    metadata: { source: 'import', format: request.format, rowCount },
    actorUserId: requestedBy,
  });

  return {
    status: 'created',
    proposalId: proposal.id,
    itemCount: changes.length,
    rowCount,
    error: null,
  };
}
