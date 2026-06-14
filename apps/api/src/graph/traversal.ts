import { withAge } from './age.js';
import { dbProjectionStatusStore, type ProjectionStatusStore } from './projector.js';

/**
 * Graph traversal service abstraction (US-026 AC6).
 *
 * Traversal-dependent views/rules query the derived AGE projection ONLY through
 * this service, never by issuing Cypher directly. The service refuses to serve
 * results while the projection is `rebuilding` (callers fall back to relational
 * queries / show an "Indexing Graph..." state, AC5) and surfaces a typed error
 * so callers can degrade gracefully.
 */

export interface TraversalNode {
  id: string;
  kind: 'entity' | 'claim';
  properties: Record<string, unknown>;
}

export interface TraversalEdge {
  fromClaimId: string;
  toEntityId: string;
  role: string;
  position: number;
}

export interface NeighborhoodResult {
  nodes: TraversalNode[];
  edges: TraversalEdge[];
}

export interface EntityNeighborhoodInput {
  knowledgeBaseId: string;
  entityId: string;
  limit?: number;
}

export interface GraphTraversalService {
  getEntityNeighborhood(input: EntityNeighborhoodInput): Promise<NeighborhoodResult>;
}

/** Thrown when the AGE projection cannot serve a traversal (e.g. rebuilding). */
export class GraphProjectionUnavailableError extends Error {
  readonly reason: 'rebuilding' | 'failed';
  constructor(reason: 'rebuilding' | 'failed') {
    super(
      reason === 'rebuilding'
        ? 'Graph projection is rebuilding; traversal is temporarily unavailable.'
        : 'Graph projection failed; traversal is unavailable until it is rebuilt.',
    );
    this.name = 'GraphProjectionUnavailableError';
    this.reason = reason;
  }
}

/** Parse an AGE agtype scalar/vertex JSON string into a JS value. */
function parseAgtype(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  // AGE returns e.g. `{"id":...}::vertex` — strip the trailing `::type` tag.
  const stripped = value.replace(/::\w+$/, '');
  try {
    return JSON.parse(stripped);
  } catch {
    return value;
  }
}

export interface AgeTraversalServiceOptions {
  statusStore?: ProjectionStatusStore;
}

/** Apache AGE-backed traversal service. */
export function createAgeTraversalService(
  options: AgeTraversalServiceOptions = {},
): GraphTraversalService {
  const statusStore = options.statusStore ?? dbProjectionStatusStore;

  return {
    async getEntityNeighborhood(input) {
      const status = await statusStore.get();
      if (status.state === 'rebuilding') throw new GraphProjectionUnavailableError('rebuilding');
      if (status.state === 'failed') throw new GraphProjectionUnavailableError('failed');

      const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
      const rows = await withAge((age) =>
        age.cypher(
          `MATCH (start:Entity {id: $entityId, kbId: $kbId})<-[r:ARGUMENT]-(c:Claim)
           OPTIONAL MATCH (c)-[r2:ARGUMENT]->(neighbor:Entity)
           WHERE neighbor.kbId = $kbId
           RETURN start, c, r, r2, neighbor`,
          'start agtype, c agtype, r agtype, r2 agtype, neighbor agtype',
          { entityId: input.entityId, kbId: input.knowledgeBaseId },
        ),
      );

      const nodes = new Map<string, TraversalNode>();
      const edges: TraversalEdge[] = [];

      const addNode = (raw: unknown, kind: 'entity' | 'claim') => {
        const v = parseAgtype(raw) as { properties?: Record<string, unknown> } | null;
        const props = v?.properties;
        const id = props?.id;
        if (typeof id === 'string' && !nodes.has(id)) {
          nodes.set(id, { id, kind, properties: props ?? {} });
        }
        return typeof id === 'string' ? id : null;
      };

      for (const row of rows.slice(0, limit)) {
        addNode(row.start, 'entity');
        const claimId = addNode(row.c, 'claim');
        const edge = parseAgtype(row.r) as { properties?: Record<string, unknown> } | null;
        if (claimId && edge?.properties) {
          const role = edge.properties.role;
          const position = edge.properties.position;
          edges.push({
            fromClaimId: claimId,
            toEntityId: input.entityId,
            role: typeof role === 'string' ? role : '',
            position: typeof position === 'number' ? position : 0,
          });
        }
        const neighborId = row.neighbor ? addNode(row.neighbor, 'entity') : null;
        const edge2 = parseAgtype(row.r2) as { properties?: Record<string, unknown> } | null;
        if (claimId && neighborId && edge2?.properties) {
          const role = edge2.properties.role;
          const position = edge2.properties.position;
          edges.push({
            fromClaimId: claimId,
            toEntityId: neighborId,
            role: typeof role === 'string' ? role : '',
            position: typeof position === 'number' ? position : 0,
          });
        }
      }

      return { nodes: [...nodes.values()], edges };
    },
  };
}

/** Default AGE traversal service. */
export const ageTraversalService: GraphTraversalService = createAgeTraversalService();
