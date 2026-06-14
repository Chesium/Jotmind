import type { AnswerCitation, AnswerClaimEntity } from '@jotmind/schemas';
import { dbSearchStore, type SearchStore } from '../search/store.js';
import { dbClaimStore, type ClaimStore } from '../claims/store.js';
import { dbEntityStore, type EntityStore } from '../entities/store.js';

/**
 * Gathers the graph evidence a provenance-aware answer (US-020) may cite. The
 * evidence is built ENTIRELY from real records so the citations cannot be
 * fabricated by the model (AC3): for each candidate claim we resolve its
 * predicate, role-labeled connected entities, confidence, and provenance.
 *
 * Defined as an interface so the answer router can run against an in-memory fake
 * in unit tests; the default impl composes the existing search/claim/entity
 * stores (all KB-scoped + soft-delete aware).
 */
export interface AnswerEvidenceStore {
  /**
   * Find up to `limit` evidence citations relevant to `query` in one KB, each
   * assigned a stable `ref` index (0-based) the answer statements reference.
   */
  gatherEvidence(knowledgeBaseId: string, query: string, limit: number): Promise<AnswerCitation[]>;
}

function truncate(text: string | null, max = 280): string | null {
  if (text === null) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function snapshotProvenance(
  provenance: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!provenance) return null;
  return Object.keys(provenance).length > 0 ? provenance : null;
}

/**
 * Default evidence store. Reuses manual token search (US-012) to find relevant
 * records, then enriches each claim hit with its arguments + entity names so a
 * cited claim displays predicate / connected entities / confidence / provenance
 * (AC3). Note/source hits are cited with their title + snippet.
 */
export function createAnswerEvidenceStore(deps?: {
  searchStore?: SearchStore;
  claimStore?: ClaimStore;
  entityStore?: EntityStore;
}): AnswerEvidenceStore {
  const searchStore = deps?.searchStore ?? dbSearchStore;
  const claimStore = deps?.claimStore ?? dbClaimStore;
  const entityStore = deps?.entityStore ?? dbEntityStore;

  return {
    async gatherEvidence(knowledgeBaseId, query, limit) {
      const results = await searchStore.search(knowledgeBaseId, {
        query,
        kinds: ['claim', 'note', 'source'],
        limit,
      });

      // Cache entity name lookups so a multi-argument claim resolves names once.
      const entityNames = new Map<string, string>();
      const resolveEntityName = async (entityId: string): Promise<string> => {
        const cached = entityNames.get(entityId);
        if (cached !== undefined) return cached;
        const entity = await entityStore.getEntity(knowledgeBaseId, entityId);
        const name = entity?.name ?? '(unknown entity)';
        entityNames.set(entityId, name);
        return name;
      };

      const citations: AnswerCitation[] = [];
      for (const result of results) {
        if (citations.length >= limit) break;
        const ref = citations.length;

        if (result.kind === 'claim') {
          const claim = await claimStore.getClaim(knowledgeBaseId, result.id);
          if (!claim) continue;
          const entities: AnswerClaimEntity[] = [];
          for (const arg of claim.arguments) {
            if (arg.argumentKind === 'entity' && arg.entityId) {
              entities.push({
                role: arg.role,
                entityId: arg.entityId,
                name: await resolveEntityName(arg.entityId),
              });
            } else {
              entities.push({
                role: arg.role,
                entityId: null,
                name: formatLiteral(arg.value),
              });
            }
          }
          citations.push({
            ref,
            kind: 'claim',
            id: claim.id,
            knowledgeBaseId,
            title: claim.predicate,
            snippet: truncate(claim.description),
            predicate: claim.predicate,
            entities,
            confidence: claim.confidence,
            provenance: snapshotProvenance(claim.provenance as Record<string, unknown> | null),
          });
          continue;
        }

        // note / source: cite the title + snippet from the search hit.
        // (Search was scoped to claim/note/source, so `entity` never appears.)
        if (result.kind !== 'note' && result.kind !== 'source') continue;
        citations.push({
          ref,
          kind: result.kind,
          id: result.id,
          knowledgeBaseId,
          title: result.title,
          snippet: result.snippet,
          predicate: null,
          entities: [],
          confidence: null,
          provenance: null,
        });
      }
      return citations;
    },
  };
}

function formatLiteral(value: unknown): string {
  if (value === null || value === undefined) return '(literal)';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** Default PostgreSQL-backed evidence store. */
export const dbAnswerEvidenceStore: AnswerEvidenceStore = createAnswerEvidenceStore();
