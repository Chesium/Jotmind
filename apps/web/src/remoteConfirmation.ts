import type { AiContentCategory, RemoteCallConfirmation } from '@jotmind/schemas';

const CATEGORY_LABELS: Record<AiContentCategory, string> = {
  note_text: 'note text',
  source_text: 'source text',
  entity_data: 'entity data',
  claim_data: 'claim data',
  search_query: 'search/query text',
  graph_context: 'graph context',
};

export function confirmRemoteAiCall(confirmation: RemoteCallConfirmation): boolean {
  const categories = confirmation.contentCategories.map((c) => CATEGORY_LABELS[c]).join(', ');
  return window.confirm(
    [
      'Confirm remote AI call',
      `Feature: ${confirmation.feature}`,
      `Provider: ${confirmation.provider}`,
      `Model: ${confirmation.model}`,
      `Content categories sent: ${categories || 'none'}`,
      'Raw prompts, API keys, and hidden system metadata are not shown here or stored in audit metadata.',
    ].join('\n'),
  );
}
