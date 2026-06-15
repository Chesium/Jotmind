import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Proposals } from './Proposals.js';
import type { KnowledgeBase, Proposal } from '@jotmind/schemas';

function mockFetch(
  handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown },
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const { status = 200, body = {} } = handler(url, init);
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      } as Response);
    }),
  );
}

const now = new Date().toISOString();
const kb: KnowledgeBase = {
  id: '00000000-0000-0000-0000-000000000520',
  name: 'Proposal Editing KB',
  description: null,
  createdBy: '00000000-0000-0000-0000-000000000001',
  role: 'editor',
  createdAt: now,
  updatedAt: now,
};

function makeProposal(): Proposal {
  return {
    id: '00000000-0000-0000-0000-000000000521',
    knowledgeBaseId: kb.id,
    kind: 'import',
    status: 'pending',
    changes: {
      items: [
        {
          op: 'create_entity',
          ref: 'ada',
          type: 'Person',
          name: 'Ada',
          aliases: [],
          tags: [],
          properties: {},
        },
        {
          op: 'create_claim',
          predicate: 'studied',
          confidence: 0.5,
          arguments: [{ role: 'subject', kind: 'entity', ref: 'ada' }],
          properties: {},
        },
        { op: 'create_note', title: 'Draft', content: 'body', properties: {} },
        {
          op: 'create_source',
          title: 'Source',
          sourceType: 'article',
          uri: '',
          content: 'source body',
          properties: {},
        },
      ],
    },
    sourceNoteId: null,
    sourceSourceId: null,
    sourceExcerptId: null,
    provider: null,
    model: null,
    reviewReason: null,
    metadata: {},
    createdBy: '00000000-0000-0000-0000-000000000001',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('Proposals', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('edits common proposal item types through structured fields and keeps JSON available', async () => {
    const proposal = makeProposal();
    let current = proposal;
    let patchBody: unknown;

    mockFetch((url, init) => {
      if (url.includes(`/api/knowledge-bases/${kb.id}/proposals/${proposal.id}`)) {
        patchBody = JSON.parse(String(init?.body));
        current = { ...current, changes: (patchBody as { changes: Proposal['changes'] }).changes };
        return { body: current };
      }
      if (url.includes(`/api/knowledge-bases/${kb.id}/proposals`)) {
        return { body: [current] };
      }
      return { status: 404 };
    });

    render(<Proposals kb={kb} csrfToken="tok" />);
    await waitFor(() => expect(screen.getByTestId(`proposal-${proposal.id}`)).toBeInTheDocument());

    fireEvent.click(screen.getByTestId(`proposal-edit-${proposal.id}`));

    fireEvent.change(screen.getByTestId(`proposal-edit-${proposal.id}-0-entity-name`), {
      target: { value: 'Ada Lovelace' },
    });
    fireEvent.change(screen.getByTestId(`proposal-edit-${proposal.id}-0-entity-aliases`), {
      target: { value: 'Enchantress of Numbers, Countess Lovelace' },
    });
    fireEvent.change(screen.getByTestId(`proposal-edit-${proposal.id}-0-entity-tags`), {
      target: { value: 'math, history' },
    });
    fireEvent.change(screen.getByTestId(`proposal-edit-${proposal.id}-0-entity-properties`), {
      target: { value: '{ "born": 1815 }' },
    });
    fireEvent.change(screen.getByTestId(`proposal-edit-${proposal.id}-1-claim-predicate`), {
      target: { value: 'wrote' },
    });
    fireEvent.change(screen.getByTestId(`proposal-edit-${proposal.id}-1-claim-confidence`), {
      target: { value: '0.82' },
    });
    fireEvent.change(screen.getByTestId(`proposal-edit-${proposal.id}-1-claim-valid-start`), {
      target: { value: '1842-01-01T00:00:00.000Z' },
    });
    fireEvent.change(screen.getByTestId(`proposal-edit-${proposal.id}-1-claim-properties`), {
      target: { value: '{ "basis": "translation notes" }' },
    });
    fireEvent.change(screen.getByTestId(`proposal-edit-${proposal.id}-2-note-title`), {
      target: { value: 'Edited note' },
    });
    fireEvent.change(screen.getByTestId(`proposal-edit-${proposal.id}-2-note-content`), {
      target: { value: 'edited body' },
    });
    fireEvent.change(screen.getByTestId(`proposal-edit-${proposal.id}-3-source-title`), {
      target: { value: 'Edited source' },
    });
    fireEvent.change(screen.getByTestId(`proposal-edit-${proposal.id}-3-source-uri`), {
      target: { value: 'https://example.test/source' },
    });

    fireEvent.click(screen.getByTestId(`proposal-edit-advanced-${proposal.id}`));
    expect(screen.getByTestId(`proposal-edit-json-${proposal.id}`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`proposal-edit-advanced-${proposal.id}`));

    fireEvent.click(screen.getByTestId(`proposal-edit-save-${proposal.id}`));

    await waitFor(() => expect(patchBody).toBeTruthy());
    expect(patchBody).toMatchObject({
      changes: {
        items: [
          {
            op: 'create_entity',
            name: 'Ada Lovelace',
            aliases: ['Enchantress of Numbers', 'Countess Lovelace'],
            tags: ['math', 'history'],
            properties: { born: 1815 },
          },
          {
            op: 'create_claim',
            predicate: 'wrote',
            confidence: 0.82,
            validStart: '1842-01-01T00:00:00.000Z',
            properties: { basis: 'translation notes' },
          },
          { op: 'create_note', title: 'Edited note', content: 'edited body' },
          {
            op: 'create_source',
            title: 'Edited source',
            uri: 'https://example.test/source',
          },
        ],
      },
    });
  });

  it('blocks invalid structured edits before saving', async () => {
    const proposal = makeProposal();
    let patchCount = 0;

    mockFetch((url) => {
      if (url.includes(`/api/knowledge-bases/${kb.id}/proposals/${proposal.id}`)) {
        patchCount += 1;
        return { body: proposal };
      }
      if (url.includes(`/api/knowledge-bases/${kb.id}/proposals`)) {
        return { body: [proposal] };
      }
      return { status: 404 };
    });

    render(<Proposals kb={kb} csrfToken="tok" />);
    await waitFor(() => expect(screen.getByTestId(`proposal-${proposal.id}`)).toBeInTheDocument());

    fireEvent.click(screen.getByTestId(`proposal-edit-${proposal.id}`));
    expect(screen.queryByTestId(`proposal-accept-${proposal.id}`)).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId(`proposal-edit-${proposal.id}-0-entity-name`), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByTestId(`proposal-edit-save-${proposal.id}`));

    await waitFor(() =>
      expect(screen.getByTestId(`proposal-error-${proposal.id}`)).toHaveTextContent(
        'Invalid proposal changes',
      ),
    );
    expect(patchCount).toBe(0);
  });
});
