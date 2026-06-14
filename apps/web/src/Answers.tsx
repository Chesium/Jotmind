import { useState, type FormEvent } from 'react';
import type {
  AnswerCitation,
  AnswerFactKind,
  AnswerResponse,
  KnowledgeBase,
} from '@jotmind/schemas';
import { answerQuestion } from './api.js';
import {
  useInvalidationEffect,
  RESULT_STALE_DOMAINS,
  RESULT_STALE_MESSAGE,
  AI_POLICY_STALE_MESSAGE,
} from './invalidation.js';

/**
 * Provenance-aware AI answers (US-020). One box asks a natural-language
 * question. Manual search always runs as a fallback so the box stays useful
 * with AI disabled (AC2). When AI is configured + permitted, an answer is
 * generated whose statements are labeled known/inferred/uncertain/missing
 * (AC5) and which cite the graph claims/notes/sources used as evidence (AC1).
 * Each cited claim shows predicate, connected entities, confidence, and
 * provenance (AC3); clicking a citation opens its detail panel (AC4).
 */

const FACT_LABELS: Record<AnswerFactKind, string> = {
  known: 'Known fact',
  inferred: 'Inferred',
  uncertain: 'Uncertain',
  missing: 'Missing info',
};

export function Answers({ kb }: { kb: KnowledgeBase }) {
  const [q, setQ] = useState('');
  const [response, setResponse] = useState<AnswerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openCitation, setOpenCitation] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [policyStale, setPolicyStale] = useState(false);

  // Mark an existing answer stale when underlying graph data changes (US-043).
  useInvalidationEffect(RESULT_STALE_DOMAINS, () => setStale(true));

  // Mark the AI-availability indicator stale when any AI policy layer changes
  // (US-045 AC4); the user-initiated rerun reflects the new effective policy.
  useInvalidationEffect(['aiPolicy'], () => setPolicyStale(true));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    setOpenCitation(null);
    try {
      setResponse(await answerQuestion(kb.id, q.trim()));
      setStale(false);
      setPolicyStale(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Answer failed');
      setResponse(null);
    } finally {
      setBusy(false);
    }
  }

  const answer = response?.answer ?? null;

  return (
    <section data-testid="answers">
      <h3>Ask (AI answers)</h3>
      <form onSubmit={submit}>
        <label>
          Ask a question
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Who does Ada know?"
            data-testid="answers-query"
          />
        </label>
        <button type="submit" disabled={busy} data-testid="answers-submit">
          Ask
        </button>
      </form>
      {error && <p data-testid="answers-error">{error}</p>}
      {response && stale && <p data-testid="answers-stale">{RESULT_STALE_MESSAGE}</p>}
      {response && policyStale && (
        <p data-testid="answers-ai-policy-stale">{AI_POLICY_STALE_MESSAGE}</p>
      )}

      {response && (
        <div data-testid="answers-results">
          <p data-testid="answers-ai-status">
            {response.ai.available
              ? `AI answers: ${response.ai.attempted ? 'on' : 'idle'}`
              : `AI unavailable${response.ai.reason ? ` — ${response.ai.reason}` : ''}`}
            {response.ai.label && ` (${response.ai.label})`}
            {response.ai.repaired && ' [repaired]'}
            {response.ai.attempted && !response.ai.verified && ' [unverified remote adapter]'}
          </p>

          {answer ? (
            <div data-testid="answers-answer">
              <h4>Answer</h4>
              <p data-testid="answers-summary">{answer.summary}</p>
              <ul>
                {answer.statements.map((s, i) => (
                  <li key={`stmt:${i}`} data-testid={`answers-statement-${s.factKind}`}>
                    <span data-testid="answers-statement-badge">[{FACT_LABELS[s.factKind]}]</span>{' '}
                    {s.text}
                    {s.citations.length > 0 && (
                      <span>
                        {' '}
                        {s.citations.map((ref) => (
                          <button
                            key={`cite:${i}:${ref}`}
                            type="button"
                            onClick={() => setOpenCitation(ref)}
                            data-testid={`answers-statement-cite-${ref}`}
                          >
                            [{ref + 1}]
                          </button>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              <h4>Citations</h4>
              {response.citations.length === 0 ? (
                <p data-testid="answers-citations-empty">No supporting evidence.</p>
              ) : (
                <ol data-testid="answers-citations">
                  {response.citations.map((c) => (
                    <li key={`c:${c.ref}`} data-testid={`answers-citation-${c.ref}`}>
                      <button
                        type="button"
                        onClick={() => setOpenCitation(openCitation === c.ref ? null : c.ref)}
                        data-testid={`answers-citation-open-${c.ref}`}
                      >
                        [{c.kind}] {c.title}
                      </button>
                      {openCitation === c.ref && <CitationDetail citation={c} />}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <p data-testid="answers-no-answer">
              No AI answer — showing manual search results below.
            </p>
          )}

          <div data-testid="answers-fallback">
            <h4>Search results</h4>
            {!response.fallback.vectorSearch.available && (
              <p data-testid="answers-vector-unavailable">
                Semantic (vector) search unavailable: {response.fallback.vectorSearch.reason}
              </p>
            )}
            <p data-testid="answers-fallback-count">{response.fallback.results.length} result(s)</p>
            <ul>
              {response.fallback.results.map((r) => (
                <li key={`f:${r.kind}:${r.id}`} data-testid={`answers-fallback-result-${r.kind}`}>
                  <strong>[{r.kind}]</strong> {r.title}
                  {r.type && ` — ${r.type}`}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

/** Detail of one citation: claims show predicate/entities/confidence/provenance (AC3). */
function CitationDetail({ citation }: { citation: AnswerCitation }) {
  return (
    <div data-testid={`answers-citation-detail-${citation.ref}`}>
      <p>
        <strong>{citation.kind}</strong>: {citation.title}
      </p>
      {citation.snippet && <p>{citation.snippet}</p>}
      {citation.kind === 'claim' && (
        <>
          <p>Predicate: {citation.predicate}</p>
          {citation.entities.length > 0 && (
            <ul>
              {citation.entities.map((e, i) => (
                <li key={`e:${citation.ref}:${i}`}>
                  {e.role}: {e.name}
                </li>
              ))}
            </ul>
          )}
          <p data-testid={`answers-citation-confidence-${citation.ref}`}>
            Confidence: {citation.confidence ?? 'n/a'}
          </p>
          {citation.provenance && (
            <p data-testid={`answers-citation-provenance-${citation.ref}`}>
              Provenance: {JSON.stringify(citation.provenance)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
