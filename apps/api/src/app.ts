import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import {
  healthStatusSchema,
  parseOrThrow,
  type DatabaseHealth,
  type HealthStatus,
} from '@jotmind/schemas';
import { checkDatabaseHealth, isDatabaseHealthy } from './db/health.js';
import { createAuthRouter } from './auth/index.js';
import { dbAuthStore, type AuthStore } from './auth/store.js';
import { createKnowledgeBaseRouter, type KnowledgeBaseStore } from './kb/index.js';
import { createEntityRouter, type EntityStore } from './entities/index.js';
import { createClaimRouter, type ClaimStore } from './claims/index.js';
import { createNoteRouter, type NoteStore } from './notes/index.js';
import { createSourceRouter, type SourceStore } from './sources/index.js';
import { createSourceExcerptRouter, type SourceExcerptStore } from './source-excerpts/index.js';
import {
  createGraphRouter,
  stubProjector,
  type Projector,
  type ProjectionStore,
} from './graph/index.js';
import { createJobsRouter, type JobStore } from './jobs/index.js';
import { createSearchRouter, type SearchStore } from './search/index.js';
import {
  createAiPolicyKbRouter,
  createAiPolicyRouter,
  type AiPolicyStore,
} from './ai-policy/index.js';
import {
  createCaptureRouter,
  createProposalRouter,
  type ProposalStore,
} from './proposals/index.js';
import { resolveExtractorFromEnv, type GraphExtractor } from './extraction/index.js';
import {
  createCommandRouter,
  resolveCommandInterpreterFromEnv,
  type CommandInterpreter,
} from './command/index.js';
import {
  createAnswerRouter,
  resolveAnswerGeneratorFromEnv,
  type AnswerEvidenceStore,
  type AnswerGenerator,
} from './answers/index.js';

export const SERVICE_NAME = 'jotmind-api';
export const SERVICE_VERSION = '0.0.0';

// Log the stubbed-projection notice once per process (US-006 AC3) rather than
// on every createApp call, which would flood test output.
let loggedStubProjector = false;

export interface AppOptions {
  /**
   * Database health probe. Injectable so unit tests can supply a deterministic
   * result without a live PostgreSQL connection. Defaults to the real probe.
   */
  checkDatabase?: () => Promise<DatabaseHealth>;
  /**
   * Account/session store. Injectable so unit tests can use an in-memory
   * implementation. Defaults to the PostgreSQL-backed store.
   */
  authStore?: AuthStore;
  /**
   * Knowledge Base store. Injectable so unit tests can use an in-memory
   * implementation. Defaults to the PostgreSQL-backed store.
   */
  kbStore?: KnowledgeBaseStore;
  /**
   * Entity store (US-008). Injectable for unit tests. Defaults to the
   * PostgreSQL-backed store.
   */
  entityStore?: EntityStore;
  /**
   * Claim store (US-009). Injectable for unit tests. Defaults to the
   * PostgreSQL-backed store.
   */
  claimStore?: ClaimStore;
  /**
   * Note store (US-011). Injectable for unit tests. Defaults to the
   * PostgreSQL-backed store.
   */
  noteStore?: NoteStore;
  /**
   * Source store (US-011). Injectable for unit tests. Defaults to the
   * PostgreSQL-backed store.
   */
  sourceStore?: SourceStore;
  /**
   * Source excerpt / citation store (US-011). Injectable for unit tests.
   * Defaults to the PostgreSQL-backed store.
   */
  sourceExcerptStore?: SourceExcerptStore;
  /**
   * Graph projection store. Injectable for unit tests. Defaults to the
   * PostgreSQL-backed store.
   */
  projectionStore?: ProjectionStore;
  /**
   * Graph projector. Defaults to the stub projector (US-006), which logs but
   * does not yet write to Apache AGE.
   */
  projector?: Projector;
  /**
   * Durable job store (US-007). Injectable for unit tests. Defaults to the
   * PostgreSQL-backed store.
   */
  jobStore?: JobStore;
  /**
   * Manual search store (US-012). Injectable for unit tests. Defaults to the
   * PostgreSQL-backed store.
   */
  searchStore?: SearchStore;
  /**
   * Layered AI privacy policy store (US-016). Injectable for unit tests.
   * Defaults to the PostgreSQL-backed store.
   */
  aiPolicyStore?: AiPolicyStore;
  /**
   * AI proposal store (US-017). Injectable for unit tests. Defaults to the
   * PostgreSQL-backed store.
   */
  proposalStore?: ProposalStore;
  /**
   * Graph extractor for quick-capture (US-017). Injectable for unit tests.
   * Defaults to the env-configured extractor, or `null` for a No-AI install.
   */
  extractor?: GraphExtractor | null;
  /**
   * Command interpreter for the universal command box (US-019). Injectable for
   * unit tests. Defaults to the env-configured interpreter, or `null` for a
   * No-AI install (manual search still works).
   */
  commandInterpreter?: CommandInterpreter | null;
  /**
   * Provenance-aware AI answer generator (US-020). Injectable for unit tests.
   * Defaults to the env-configured generator, or `null` for a No-AI install
   * (manual search fallback still works).
   */
  answerGenerator?: AnswerGenerator | null;
  /**
   * Evidence store backing AI answers (US-020). Injectable for unit tests.
   * Defaults to the store composing search/claim/entity stores.
   */
  answerEvidenceStore?: AnswerEvidenceStore;
}

export function createApp(options: AppOptions = {}): Express {
  const { checkDatabase = checkDatabaseHealth } = options;
  const authStore = options.authStore ?? dbAuthStore;
  const projector = options.projector ?? stubProjector;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  if (projector.stubbed && !loggedStubProjector) {
    // Make the stubbed projection state visible in logs (US-006 AC3).
    loggedStubProjector = true;
    console.log(
      `[graph-projector:${projector.name}] STUB active — graph_outbox events are consumed but NOT projected to Apache AGE yet`,
    );
  }

  app.use('/api/auth', createAuthRouter({ store: authStore }));
  app.use(
    '/api/knowledge-bases',
    createKnowledgeBaseRouter({ store: options.kbStore, authStore, jobStore: options.jobStore }),
  );
  app.use(
    '/api/knowledge-bases/:kbId/entities',
    createEntityRouter({ store: options.entityStore, kbStore: options.kbStore, authStore }),
  );
  app.use(
    '/api/knowledge-bases/:kbId/claims',
    createClaimRouter({ store: options.claimStore, kbStore: options.kbStore, authStore }),
  );
  app.use(
    '/api/knowledge-bases/:kbId/notes',
    createNoteRouter({ store: options.noteStore, kbStore: options.kbStore, authStore }),
  );
  app.use(
    '/api/knowledge-bases/:kbId/sources',
    createSourceRouter({ store: options.sourceStore, kbStore: options.kbStore, authStore }),
  );
  app.use(
    '/api/knowledge-bases/:kbId/source-excerpts',
    createSourceExcerptRouter({
      store: options.sourceExcerptStore,
      kbStore: options.kbStore,
      authStore,
    }),
  );
  app.use(
    '/api/knowledge-bases/:kbId/search',
    createSearchRouter({ store: options.searchStore, kbStore: options.kbStore, authStore }),
  );
  const commandInterpreter =
    options.commandInterpreter !== undefined
      ? options.commandInterpreter
      : resolveCommandInterpreterFromEnv();
  app.use(
    '/api/knowledge-bases/:kbId/command',
    createCommandRouter({
      searchStore: options.searchStore,
      kbStore: options.kbStore,
      authStore,
      aiPolicyStore: options.aiPolicyStore,
      interpreter: commandInterpreter,
    }),
  );
  const answerGenerator =
    options.answerGenerator !== undefined
      ? options.answerGenerator
      : resolveAnswerGeneratorFromEnv();
  app.use(
    '/api/knowledge-bases/:kbId/answers',
    createAnswerRouter({
      searchStore: options.searchStore,
      evidenceStore: options.answerEvidenceStore,
      kbStore: options.kbStore,
      authStore,
      aiPolicyStore: options.aiPolicyStore,
      generator: answerGenerator,
    }),
  );
  app.use(
    '/api/knowledge-bases/:kbId/ai/policy',
    createAiPolicyKbRouter({
      store: options.aiPolicyStore,
      kbStore: options.kbStore,
      authStore,
    }),
  );
  const extractor = options.extractor !== undefined ? options.extractor : resolveExtractorFromEnv();
  app.use(
    '/api/knowledge-bases/:kbId/proposals',
    createProposalRouter({
      store: options.proposalStore,
      kbStore: options.kbStore,
      authStore,
      entityStore: options.entityStore,
      claimStore: options.claimStore,
    }),
  );
  app.use(
    '/api/knowledge-bases/:kbId/capture',
    createCaptureRouter({
      proposalStore: options.proposalStore,
      noteStore: options.noteStore,
      sourceStore: options.sourceStore,
      aiPolicyStore: options.aiPolicyStore,
      kbStore: options.kbStore,
      authStore,
      extractor,
    }),
  );
  app.use('/api/ai', createAiPolicyRouter({ store: options.aiPolicyStore, authStore }));
  app.use(
    '/api/graph',
    createGraphRouter({ authStore, projectionStore: options.projectionStore, projector }),
  );
  app.use('/api/jobs', createJobsRouter({ authStore, store: options.jobStore }));

  app.get('/api/health', (_req, res, next) => {
    void (async () => {
      try {
        const database = await checkDatabase();
        const payload: HealthStatus = {
          status: isDatabaseHealthy(database) ? 'ok' : 'degraded',
          service: SERVICE_NAME,
          version: SERVICE_VERSION,
          timestamp: new Date().toISOString(),
          database,
        };
        // Validate outgoing response against the shared schema.
        res.json(parseOrThrow(healthStatusSchema, payload));
      } catch (err) {
        next(err);
      }
    })();
  });

  return app;
}
