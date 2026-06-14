import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmRemoteAiCall } from './remoteConfirmation.js';

describe('confirmRemoteAiCall', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('discloses provider/model/feature/categories without raw prompts or secrets', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    expect(
      confirmRemoteAiCall({
        provider: 'Remote OpenAI',
        model: 'gpt-test',
        feature: 'Command interpretation',
        contentCategories: ['search_query'],
      }),
    ).toBe(true);

    const message = confirm.mock.calls[0]?.[0] ?? '';
    expect(message).toContain('Remote OpenAI');
    expect(message).toContain('gpt-test');
    expect(message).toContain('Command interpretation');
    expect(message).toContain('search/query text');
    expect(message).not.toContain('Ada Lovelace');
    expect(message).not.toContain('apiKey');
  });
});
