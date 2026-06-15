import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Proposals } from './Proposals.js';
import type {
  CaptureResponse,
  ExtractionStatus,
  KnowledgeBase,
  Note,
  Proposal,
} from '@jotmind/schemas';

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

function makeNote(): Note {
  return {
    id: '00000000-0000-0000-0000-000000000522',
    knowledgeBaseId: kb.id,
    title: 'Captured',
    content: 'Captured content',
    properties: {},
    createdBy: '00000000-0000-0000-0000-000000000001',
    createdAt: now,
    updatedAt: now,
  };
}

function makeCaptureResponse(status: ExtractionStatus): CaptureResponse {
  const proposal = status === 'created' ? makeProposal() : null;
  return {
    kind: 'note',
    note: makeNote(),
    source: null,
    extraction: {
      status,
      availability: {
        available: status !== 'unavailable',
        reason: status === 'unavailable' ? 'AI is disabled by policy' : null,
        provider: status === 'unavailable' ? null : 'Mock Extractor',
        model: status === 'unavailable' ? null : 'mock',
        demo: status !== 'unavailable',
        verified: true,
        label: status === 'unavailable' ? null : 'Mock AI / deterministic demo output',
      },
      proposal,
      error: status === 'error' ? 'Extractor crashed' : null,
    },
  };
}

describe('Proposals', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['created', 'capture-extracted', 'AI proposed 4 change(s) for review.'],
    ['empty', 'capture-empty', 'AI found nothing to propose.'],
    ['unavailable', 'capture-unavailable', 'AI extraction unavailable: AI is disabled by policy.'],
    ['error', 'capture-error', 'AI extraction failed: Extractor crashed.'],
  ] as const)(
    'shows the quick-capture %s extraction state',
    async (status, expectedTestId, expectedText) => {
      const proposal = makeProposal();
      let captured = false;

      mockFetch((url) => {
        if (url.includes(`/api/knowledge-bases/${kb.id}/capture`)) {
          captured = true;
          return { status: 201, body: makeCaptureResponse(status) };
        }
        if (url.includes(`/api/knowledge-bases/${kb.id}/proposals`)) {
          return { body: captured && status === 'created' ? [proposal] : [] };
        }
        return { status: 404 };
      });

      render(<Proposals kb={kb} csrfToken="tok" />);
      await waitFor(() => expect(screen.getByTestId('capture-form')).toBeInTheDocument());

      fireEvent.change(screen.getByTestId('capture-content'), {
        target: { value: 'Ada wrote detailed notes.' },
      });
      fireEvent.click(screen.getByTestId('capture-submit'));

      await waitFor(() =>
        expect(screen.getByTestId(expectedTestId)).toHaveTextContent(expectedText),
      );
      expect(screen.getByTestId('capture-outcome')).toHaveTextContent('Saved as note');
      if (status === 'created') {
        expect(screen.getByTestId('capture-demo-label')).toHaveTextContent(
          'Mock AI / deterministic demo output',
        );
        await waitFor(() =>
          expect(screen.getByTestId(`proposal-${proposal.id}`)).toBeInTheDocument(),
        );
      } else if (status === 'unavailable') {
        expect(screen.queryByTestId('capture-demo-label')).not.toBeInTheDocument();
        expect(screen.getByTestId('proposals-empty')).toBeInTheDocument();
      } else {
        expect(screen.getByTestId('capture-demo-label')).toHaveTextContent(
          'Mock AI / deterministic demo output',
        );
        expect(screen.getByTestId('proposals-empty')).toBeInTheDocument();
      }
    },
  );

  it('shows proposal review controls and performs accept-selected and reject actions', async () => {
    const first = {
      ...makeProposal(),
      id: '00000000-0000-0000-0000-000000000541',
    };
    const second = {
      ...makeProposal(),
      id: '00000000-0000-0000-0000-000000000542',
      changes: {
        items: [{ op: 'create_entity' as const, ref: 'grace', type: 'Person', name: 'Grace' }],
      },
    };
    let pending = [first, second];
    const reviewCalls: Array<{ action: string; id: string; body: unknown }> = [];

    mockFetch((url, init) => {
      if (url.includes(`/api/knowledge-bases/${kb.id}/proposals/${first.id}/accept`)) {
        reviewCalls.push({
          action: 'accept',
          id: first.id,
          body: JSON.parse(String(init?.body ?? '{}')) as unknown,
        });
        pending = pending.filter((p) => p.id !== first.id);
        return {
          body: {
            proposal: { ...first, status: 'accepted', reviewedAt: now },
            createdEntityIds: ['00000000-0000-0000-0000-000000000543'],
            createdClaimIds: [],
            createdNoteIds: [],
            createdSourceIds: [],
          },
        };
      }
      if (url.includes(`/api/knowledge-bases/${kb.id}/proposals/${second.id}/reject`)) {
        reviewCalls.push({
          action: 'reject',
          id: second.id,
          body: JSON.parse(String(init?.body ?? '{}')) as unknown,
        });
        pending = pending.filter((p) => p.id !== second.id);
        return { body: { ...second, status: 'rejected', reviewedAt: now } };
      }
      if (url.includes(`/api/knowledge-bases/${kb.id}/proposals`)) {
        return { body: pending };
      }
      return { status: 404 };
    });

    render(<Proposals kb={kb} csrfToken="tok" />);
    await waitFor(() => expect(screen.getByTestId(`proposal-${first.id}`)).toBeInTheDocument());
    expect(screen.getByTestId(`proposal-accept-${first.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`proposal-reject-${first.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`proposal-edit-${first.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`proposal-accept-selected-${first.id}`)).toBeDisabled();

    fireEvent.click(screen.getByTestId(`proposal-select-${first.id}-0`));
    expect(screen.getByTestId(`proposal-accept-selected-${first.id}`)).toHaveTextContent(
      'Accept selected (1)',
    );
    fireEvent.click(screen.getByTestId(`proposal-accept-selected-${first.id}`));

    await waitFor(() =>
      expect(screen.queryByTestId(`proposal-${first.id}`)).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId(`proposal-reject-${second.id}`));

    await waitFor(() => expect(screen.getByTestId('proposals-empty')).toBeInTheDocument());
    expect(reviewCalls).toEqual([
      { action: 'accept', id: first.id, body: { itemIndexes: [0] } },
      { action: 'reject', id: second.id, body: {} },
    ]);
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
