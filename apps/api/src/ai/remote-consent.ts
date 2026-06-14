import type {
  AiContentCategory,
  RemoteAiAuditMetadata,
  RemoteCallConfirmation,
} from '@jotmind/schemas';
import { buildRemoteAiAuditMetadata, remoteCallConfirmationSchema } from '@jotmind/schemas';
import { getDb } from '../db/client.js';
import { auditEvents } from '../db/schema.js';

export const REMOTE_CONFIRMATION_REQUIRED = 'Remote AI confirmation required';

export interface RemoteAiAuditInput {
  knowledgeBaseId: string;
  actorUserId: string | null;
  confirmation: RemoteCallConfirmation;
  targetId?: string | null;
}

export interface RemoteAiAuditStore {
  recordRemoteCall(input: RemoteAiAuditInput): Promise<void>;
}

export function buildRemoteConfirmation(input: {
  provider: string;
  model: string | null;
  feature: string;
  contentCategories: AiContentCategory[];
}): RemoteCallConfirmation {
  return remoteCallConfirmationSchema.parse({
    provider: input.provider,
    model: input.model ?? 'default',
    feature: input.feature,
    contentCategories: input.contentCategories,
  });
}

export function remoteConfirmationMatches(
  provided: unknown,
  expected: RemoteCallConfirmation,
): boolean {
  const parsed = remoteCallConfirmationSchema.safeParse(provided);
  if (!parsed.success) return false;
  const value = parsed.data;
  return (
    value.provider === expected.provider &&
    value.model === expected.model &&
    value.feature === expected.feature &&
    value.contentCategories.length === expected.contentCategories.length &&
    value.contentCategories.every((category, i) => category === expected.contentCategories[i])
  );
}

export function remoteConfirmationRequiredBody(confirmation: RemoteCallConfirmation): {
  error: string;
  confirmation: RemoteCallConfirmation;
} {
  return { error: REMOTE_CONFIRMATION_REQUIRED, confirmation };
}

export function safeRemoteAiAuditMetadata(
  confirmation: RemoteCallConfirmation,
): RemoteAiAuditMetadata {
  return buildRemoteAiAuditMetadata({
    ...confirmation,
  });
}

export const dbRemoteAiAuditStore: RemoteAiAuditStore = {
  async recordRemoteCall(input) {
    await getDb()
      .insert(auditEvents)
      .values({
        knowledgeBaseId: input.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'ai.remote_call',
        targetType: 'remote_ai_call',
        targetId: input.targetId ?? input.confirmation.feature,
        metadata: safeRemoteAiAuditMetadata(input.confirmation),
      });
  },
};
