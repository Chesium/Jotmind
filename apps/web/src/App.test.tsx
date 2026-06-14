import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from './App.js';
import { AiProviderStatusPanel } from './AiPolicySettings.js';
import { Rules } from './Rules.js';
import { Modules } from './Modules.js';
import { InvalidationProvider, useInvalidationEffect } from './invalidation.js';
import type { KnowledgeBase } from '@jotmind/schemas';

function mockFetch(handler: (url: string) => { status?: number; body?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const { status = 200, body = {} } = handler(url);
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      } as Response);
    }),
  );
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the app title', () => {
    mockFetch(() => ({ status: 401 }));
    render(<App />);
    expect(screen.getByRole('heading', { name: 'JotMind' })).toBeInTheDocument();
  });

  it('shows first-run setup when no users exist', async () => {
    mockFetch((url) => {
      if (url.includes('/api/auth/me')) return { status: 401 };
      if (url.includes('/api/auth/setup-status')) return { body: { setupRequired: true } };
      return { status: 404 };
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'First-run setup' })).toBeInTheDocument();
    });
  });

  it('shows the login form when setup is complete', async () => {
    mockFetch((url) => {
      if (url.includes('/api/auth/me')) return { status: 401 };
      if (url.includes('/api/auth/setup-status')) return { body: { setupRequired: false } };
      return { status: 404 };
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    });
  });

  it('shows the signed-in account and admin account creation when authenticated', async () => {
    mockFetch((url) => {
      if (url.includes('/api/auth/me')) {
        return {
          body: {
            user: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'admin@example.com',
              role: 'admin',
              createdAt: new Date().toISOString(),
            },
            csrfToken: 'tok',
          },
        };
      }
      if (url.includes('/api/knowledge-bases')) return { body: [] };
      return { status: 404 };
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('current-user')).toHaveTextContent('admin@example.com');
    });
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument();
  });

  it('lists Knowledge Bases for the authenticated user', async () => {
    mockFetch((url) => {
      if (url.includes('/api/auth/me')) {
        return {
          body: {
            user: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'admin@example.com',
              role: 'admin',
              createdAt: new Date().toISOString(),
            },
            csrfToken: 'tok',
          },
        };
      }
      if (url.includes('/api/knowledge-bases')) {
        return {
          body: [
            {
              id: '00000000-0000-0000-0000-0000000000aa',
              name: 'My KB',
              description: null,
              createdBy: '00000000-0000-0000-0000-000000000001',
              role: 'owner',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        };
      }
      return { status: 404 };
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('kb-list')).toHaveTextContent('My KB (owner)');
    });
  });

  it('lets an editor create an entity in a selected Knowledge Base', async () => {
    const kbId = '00000000-0000-0000-0000-0000000000aa';
    const created = {
      id: '00000000-0000-0000-0000-0000000000e1',
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada Lovelace',
      aliases: ['Ada'],
      description: null,
      tags: [],
      properties: {},
      schemaVersionId: null,
      createdBy: '00000000-0000-0000-0000-000000000001',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    let entityCreated = false;

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';
        const respond = (status: number, body: unknown) =>
          Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
          } as Response);

        if (url.includes('/api/auth/me')) {
          return respond(200, {
            user: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'editor@example.com',
              role: 'member',
              createdAt: new Date().toISOString(),
            },
            csrfToken: 'tok',
          });
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/entities`)) {
          if (method === 'POST') {
            entityCreated = true;
            return respond(201, created);
          }
          return respond(200, entityCreated ? [created] : []);
        }
        if (url.includes('/api/knowledge-bases')) {
          return respond(200, [
            {
              id: kbId,
              name: 'My KB',
              description: null,
              createdBy: '00000000-0000-0000-0000-000000000001',
              role: 'editor',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ]);
        }
        return respond(404, {});
      }),
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId(`kb-select-${kbId}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`kb-select-${kbId}`));

    await waitFor(() => {
      expect(screen.getByTestId('entities')).toBeInTheDocument();
    });
    expect(screen.getByTestId('entities-empty')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('entity-name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.click(screen.getByTestId('entity-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('entities-list')).toHaveTextContent('Ada Lovelace');
    });
  });

  it('renders graph views and navigates from the table to entity detail', async () => {
    const kbId = '00000000-0000-0000-0000-0000000000cc';
    const entityId = '00000000-0000-0000-0000-0000000000e2';
    const now = new Date().toISOString();
    const entity = {
      id: entityId,
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada Lovelace',
      aliases: ['Ada'],
      description: 'Mathematician',
      tags: ['pioneer'],
      properties: {},
      schemaVersionId: null,
      createdBy: '00000000-0000-0000-0000-000000000001',
      createdAt: now,
      updatedAt: now,
    };

    mockFetch((url) => {
      if (url.includes('/api/auth/me')) {
        return {
          body: {
            user: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'editor@example.com',
              role: 'member',
              createdAt: now,
            },
            csrfToken: 'tok',
          },
        };
      }
      if (url.includes(`/api/knowledge-bases/${kbId}/entities`)) return { body: [entity] };
      if (url.includes(`/api/knowledge-bases/${kbId}/claims`)) return { body: [] };
      if (url.includes(`/api/knowledge-bases/${kbId}/notes`)) return { body: [] };
      if (url.includes(`/api/knowledge-bases/${kbId}/sources`)) return { body: [] };
      if (url.includes(`/api/knowledge-bases/${kbId}/source-excerpts`)) return { body: [] };
      if (url.includes(`/api/knowledge-bases/${kbId}/search`)) return { body: { results: [] } };
      if (url.includes('/api/knowledge-bases')) {
        return {
          body: [
            {
              id: kbId,
              name: 'Views KB',
              description: null,
              createdBy: '00000000-0000-0000-0000-000000000001',
              role: 'editor',
              createdAt: now,
              updatedAt: now,
            },
          ],
        };
      }
      return { status: 404 };
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId(`kb-select-${kbId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`kb-select-${kbId}`));

    await waitFor(() => {
      expect(screen.getByTestId('graph-views')).toBeInTheDocument();
    });

    // Network view shows the entity node.
    await waitFor(() => {
      expect(screen.getByTestId(`network-node-${entityId}`)).toBeInTheDocument();
    });

    // Switch to the table view and open the entity detail.
    fireEvent.click(screen.getByTestId('view-tab-table'));
    await waitFor(() => {
      expect(screen.getByTestId(`table-row-${entityId}`)).toBeInTheDocument();
    });
    const row = screen.getByTestId(`table-row-${entityId}`);
    fireEvent.click(within(row).getByText('Ada Lovelace'));

    await waitFor(() => {
      expect(screen.getByTestId('detail-view')).toBeInTheDocument();
    });
    expect(screen.getByTestId('detail-description')).toHaveTextContent('Mathematician');
  });

  it('shows the Indexing Graph state while the projection is rebuilding (US-026)', async () => {
    const kbId = '00000000-0000-0000-0000-0000000000dd';
    const entityId = '00000000-0000-0000-0000-0000000000e3';
    const now = new Date().toISOString();
    const entity = {
      id: entityId,
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Grace Hopper',
      aliases: [],
      description: null,
      tags: [],
      properties: {},
      schemaVersionId: null,
      createdBy: '00000000-0000-0000-0000-000000000001',
      createdAt: now,
      updatedAt: now,
    };

    mockFetch((url) => {
      if (url.includes('/api/auth/me')) {
        return {
          body: {
            user: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'editor@example.com',
              role: 'member',
              createdAt: now,
            },
            csrfToken: 'tok',
          },
        };
      }
      if (url.includes('/api/graph/projection/status')) {
        return {
          body: {
            state: 'rebuilding',
            projector: { name: 'age:jotmind_graph', stubbed: false },
            counts: { pending: 2, processed: 0, failed: 0 },
            activeKnowledgeBaseId: null,
            lastJobId: null,
            lastRebuildStartedAt: now,
            lastSynchronizedAt: null,
            failedAt: null,
            lastError: null,
            updatedAt: now,
          },
        };
      }
      if (url.includes(`/api/knowledge-bases/${kbId}/entities`)) return { body: [entity] };
      if (url.includes(`/api/knowledge-bases/${kbId}/claims`)) return { body: [] };
      if (url.includes(`/api/knowledge-bases/${kbId}/notes`)) return { body: [] };
      if (url.includes(`/api/knowledge-bases/${kbId}/sources`)) return { body: [] };
      if (url.includes(`/api/knowledge-bases/${kbId}/source-excerpts`)) return { body: [] };
      if (url.includes(`/api/knowledge-bases/${kbId}/search`)) return { body: { results: [] } };
      if (url.includes('/api/knowledge-bases')) {
        return {
          body: [
            {
              id: kbId,
              name: 'Indexing KB',
              description: null,
              createdBy: '00000000-0000-0000-0000-000000000001',
              role: 'editor',
              createdAt: now,
              updatedAt: now,
            },
          ],
        };
      }
      return { status: 404 };
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId(`kb-select-${kbId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`kb-select-${kbId}`));

    await waitFor(() => {
      expect(screen.getByTestId('graph-views')).toBeInTheDocument();
    });

    // Network view shows the "Indexing Graph..." state instead of the network.
    await waitFor(() => {
      expect(screen.getByTestId('network-indexing')).toBeInTheDocument();
    });
    expect(screen.queryByTestId(`network-node-${entityId}`)).not.toBeInTheDocument();

    // Core relational views still work: the table renders the entity.
    fireEvent.click(screen.getByTestId('view-tab-table'));
    await waitFor(() => {
      expect(screen.getByTestId(`table-row-${entityId}`)).toBeInTheDocument();
    });
  });

  it('asks a provenance-aware AI answer and shows a cited claim (US-020)', async () => {
    const kbId = '00000000-0000-0000-0000-0000000000aa';
    const claimId = '00000000-0000-0000-0000-0000000000c1';
    const now = new Date().toISOString();

    mockFetch((url) => {
      if (url.includes('/api/auth/me')) {
        return {
          body: {
            user: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'viewer@example.com',
              role: 'member',
              createdAt: now,
            },
            csrfToken: 'tok',
          },
        };
      }
      if (url.includes(`/api/knowledge-bases/${kbId}/answers`)) {
        return {
          body: {
            query: 'Who does Ada know?',
            ai: {
              attempted: true,
              available: true,
              reason: null,
              repaired: false,
              provider: 'Mock Answerer',
              model: 'mock',
              demo: true,
              verified: true,
              label: 'Mock AI / deterministic demo output',
            },
            answer: {
              summary: 'Ada knows Charles.',
              statements: [
                { text: 'Ada knows Charles Babbage.', factKind: 'known', citations: [0] },
              ],
            },
            citations: [
              {
                ref: 0,
                kind: 'claim',
                id: claimId,
                knowledgeBaseId: kbId,
                title: 'knows',
                snippet: null,
                predicate: 'knows',
                entities: [
                  {
                    role: 'subject',
                    entityId: '00000000-0000-0000-0000-0000000000e1',
                    name: 'Ada',
                  },
                  {
                    role: 'object',
                    entityId: '00000000-0000-0000-0000-0000000000e2',
                    name: 'Charles',
                  },
                ],
                confidence: 0.9,
                provenance: { origin: 'manual' },
              },
            ],
            fallback: {
              results: [],
              vectorSearch: { available: false, reason: 'No embeddings.' },
            },
          },
        };
      }
      if (
        url.match(/\/api\/knowledge-bases\/[^/]+\/(entities|claims|notes|sources|source-excerpts)/)
      ) {
        return { body: [] };
      }
      if (url.includes(`/api/knowledge-bases/${kbId}/search`)) return { body: { results: [] } };
      if (url.includes('/api/knowledge-bases')) {
        return {
          body: [
            {
              id: kbId,
              name: 'Ask KB',
              description: null,
              createdBy: '00000000-0000-0000-0000-000000000001',
              role: 'viewer',
              createdAt: now,
              updatedAt: now,
            },
          ],
        };
      }
      return { status: 404 };
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId(`kb-select-${kbId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`kb-select-${kbId}`));

    await waitFor(() => {
      expect(screen.getByTestId('answers')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('answers-query'), {
      target: { value: 'Who does Ada know?' },
    });
    fireEvent.click(screen.getByTestId('answers-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('answers-summary')).toHaveTextContent('Ada knows Charles.');
    });
    expect(screen.getByTestId('answers-statement-known')).toBeInTheDocument();

    // Open the citation detail and verify predicate/confidence/provenance (AC3/AC4).
    fireEvent.click(screen.getByTestId('answers-citation-open-0'));
    await waitFor(() => {
      expect(screen.getByTestId('answers-citation-confidence-0')).toHaveTextContent('0.9');
    });
    expect(screen.getByTestId('answers-citation-provenance-0')).toHaveTextContent('manual');
  });

  it('shows read-only access for viewers', async () => {
    const kbId = '00000000-0000-0000-0000-0000000000bb';
    mockFetch((url) => {
      if (url.includes('/api/auth/me')) {
        return {
          body: {
            user: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'viewer@example.com',
              role: 'member',
              createdAt: new Date().toISOString(),
            },
            csrfToken: 'tok',
          },
        };
      }
      if (url.includes(`/api/knowledge-bases/${kbId}/entities`)) return { body: [] };
      if (url.includes('/api/knowledge-bases')) {
        return {
          body: [
            {
              id: kbId,
              name: 'Shared KB',
              description: null,
              createdBy: '00000000-0000-0000-0000-000000000002',
              role: 'viewer',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        };
      }
      return { status: 404 };
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId(`kb-select-${kbId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`kb-select-${kbId}`));

    await waitFor(() => {
      expect(screen.getByTestId('entities-readonly')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('entity-submit')).not.toBeInTheDocument();
  });

  it('shows a newly created entity in the claim argument dropdown without reload (US-036)', async () => {
    const kbId = '00000000-0000-0000-0000-0000000000dd';
    const now = new Date().toISOString();
    const created = {
      id: '00000000-0000-0000-0000-0000000000e3',
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada Lovelace',
      aliases: [],
      description: null,
      tags: [],
      properties: {},
      schemaVersionId: null,
      createdBy: '00000000-0000-0000-0000-000000000001',
      createdAt: now,
      updatedAt: now,
    };
    let entityCreated = false;

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';
        const respond = (status: number, body: unknown) =>
          Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
          } as Response);

        if (url.includes('/api/auth/me')) {
          return respond(200, {
            user: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'editor@example.com',
              role: 'member',
              createdAt: now,
            },
            csrfToken: 'tok',
          });
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/entities`)) {
          if (method === 'POST') {
            entityCreated = true;
            return respond(201, created);
          }
          return respond(200, entityCreated ? [created] : []);
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/claims`)) return respond(200, []);
        if (url.includes('/api/knowledge-bases') && !url.includes(`${kbId}/`)) {
          return respond(200, [
            {
              id: kbId,
              name: 'Sync KB',
              description: null,
              createdBy: '00000000-0000-0000-0000-000000000001',
              role: 'editor',
              createdAt: now,
              updatedAt: now,
            },
          ]);
        }
        return respond(404, {});
      }),
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId(`kb-select-${kbId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`kb-select-${kbId}`));

    // The Claims panel renders with an entity argument dropdown that initially
    // has no entity options to choose from.
    await waitFor(() => {
      expect(screen.getByTestId('claim-arg-entity-0')).toBeInTheDocument();
    });
    expect(
      within(screen.getByTestId('claim-arg-entity-0')).queryByText(/Ada Lovelace/),
    ).not.toBeInTheDocument();

    // Create an entity in the Entities panel.
    fireEvent.change(screen.getByTestId('entity-name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.click(screen.getByTestId('entity-submit'));

    // Without a page reload or KB reselect, the claim argument dropdown shows it.
    await waitFor(() => {
      expect(
        within(screen.getByTestId('claim-arg-entity-0')).getByText(/Ada Lovelace/),
      ).toBeInTheDocument();
    });
  });

  it('shows a newly created entity in graph views without reload (US-037)', async () => {
    const kbId = '00000000-0000-0000-0000-0000000000ef';
    const entityId = '00000000-0000-0000-0000-0000000000f4';
    const now = new Date().toISOString();
    const created = {
      id: entityId,
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Grace Hopper',
      aliases: [],
      description: null,
      tags: [],
      properties: {},
      schemaVersionId: null,
      createdBy: '00000000-0000-0000-0000-000000000001',
      createdAt: now,
      updatedAt: now,
    };
    let entityCreated = false;

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';
        const respond = (status: number, body: unknown) =>
          Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
          } as Response);

        if (url.includes('/api/auth/me')) {
          return respond(200, {
            user: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'editor@example.com',
              role: 'member',
              createdAt: now,
            },
            csrfToken: 'tok',
          });
        }
        if (url.includes('/api/graph/projection/status')) {
          return respond(200, { id: 'default', state: 'synchronized', pendingEvents: 0 });
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/entities`)) {
          if (method === 'POST') {
            entityCreated = true;
            return respond(201, created);
          }
          return respond(200, entityCreated ? [created] : []);
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/claims`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/notes`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/sources`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/source-excerpts`)) return respond(200, []);
        if (url.includes('/api/knowledge-bases') && !url.includes(`${kbId}/`)) {
          return respond(200, [
            {
              id: kbId,
              name: 'Graph Sync KB',
              description: null,
              createdBy: '00000000-0000-0000-0000-000000000001',
              role: 'editor',
              createdAt: now,
              updatedAt: now,
            },
          ]);
        }
        return respond(404, {});
      }),
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId(`kb-select-${kbId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`kb-select-${kbId}`));

    // GraphViews renders; the network view initially has no node for the entity.
    await waitFor(() => {
      expect(screen.getByTestId('graph-views')).toBeInTheDocument();
    });
    expect(screen.queryByTestId(`network-node-${entityId}`)).not.toBeInTheDocument();

    // Create an entity in the Entities panel.
    fireEvent.change(screen.getByTestId('entity-name'), { target: { value: 'Grace Hopper' } });
    fireEvent.click(screen.getByTestId('entity-submit'));

    // Without a page reload or KB reselect, the graph network view shows the node.
    await waitFor(() => {
      expect(screen.getByTestId(`network-node-${entityId}`)).toBeInTheDocument();
    });
  });

  it('shows a newly created claim in capture citation dropdowns without reload (US-038)', async () => {
    const kbId = '00000000-0000-0000-0000-0000000000fc';
    const noteId = '00000000-0000-0000-0000-000000000101';
    const claimId = '00000000-0000-0000-0000-000000000102';
    const now = new Date().toISOString();
    const note = {
      id: noteId,
      knowledgeBaseId: kbId,
      title: 'A note',
      content: 'Some content',
      properties: {},
      createdBy: '00000000-0000-0000-0000-000000000001',
      createdAt: now,
      updatedAt: now,
    };
    const createdClaim = {
      id: claimId,
      knowledgeBaseId: kbId,
      predicate: 'knows',
      description: null,
      confidence: null,
      validStart: null,
      validEnd: null,
      properties: {},
      schemaVersionId: null,
      arguments: [
        {
          id: '00000000-0000-0000-0000-000000000103',
          role: 'subject',
          position: 0,
          argumentKind: 'literal',
          value: 'x',
          entityId: null,
        },
      ],
      createdBy: '00000000-0000-0000-0000-000000000001',
      createdAt: now,
      updatedAt: now,
    };
    let claimCreated = false;

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';
        const respond = (status: number, body: unknown) =>
          Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
          } as Response);

        if (url.includes('/api/auth/me')) {
          return respond(200, {
            user: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'editor@example.com',
              role: 'member',
              createdAt: now,
            },
            csrfToken: 'tok',
          });
        }
        if (url.includes('/api/graph/projection/status')) {
          return respond(200, { id: 'default', state: 'synchronized', pendingEvents: 0 });
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/entities`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/claims`)) {
          if (method === 'POST') {
            claimCreated = true;
            return respond(201, createdClaim);
          }
          return respond(200, claimCreated ? [createdClaim] : []);
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/notes`)) return respond(200, [note]);
        if (url.includes(`/api/knowledge-bases/${kbId}/sources`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/source-excerpts`)) return respond(200, []);
        if (url.includes('/api/knowledge-bases') && !url.includes(`${kbId}/`)) {
          return respond(200, [
            {
              id: kbId,
              name: 'Citation Sync KB',
              description: null,
              createdBy: '00000000-0000-0000-0000-000000000001',
              role: 'editor',
              createdAt: now,
              updatedAt: now,
            },
          ]);
        }
        return respond(404, {});
      }),
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId(`kb-select-${kbId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`kb-select-${kbId}`));

    // The Capture citation form for the note renders a claim dropdown that
    // initially has no claim to link.
    await waitFor(() => {
      expect(screen.getByTestId(`citation-claim-${noteId}`)).toBeInTheDocument();
    });
    expect(
      within(screen.getByTestId(`citation-claim-${noteId}`)).queryByText(/knows/),
    ).not.toBeInTheDocument();

    // Create a claim in the Claims panel (literal arg avoids needing an entity).
    fireEvent.change(screen.getByTestId('claim-predicate'), { target: { value: 'knows' } });
    fireEvent.change(screen.getByTestId('claim-arg-kind-0'), { target: { value: 'literal' } });
    fireEvent.change(screen.getByTestId('claim-arg-role-0'), { target: { value: 'subject' } });
    fireEvent.change(screen.getByTestId('claim-arg-value-0'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('claim-submit'));

    // Without a page reload or KB reselect, the citation dropdown shows the claim.
    await waitFor(() => {
      expect(
        within(screen.getByTestId(`citation-claim-${noteId}`)).getByText(/knows/),
      ).toBeInTheDocument();
    });
  });

  it('shows entities/claims/graph nodes from an accepted proposal without reload (US-039)', async () => {
    const kbId = '00000000-0000-0000-0000-000000000110';
    const proposalId = '00000000-0000-0000-0000-000000000111';
    const entityId = '00000000-0000-0000-0000-000000000112';
    const now = new Date().toISOString();
    const proposal = {
      id: proposalId,
      knowledgeBaseId: kbId,
      kind: 'ai_extraction',
      status: 'pending',
      changes: {
        items: [{ op: 'create_entity', ref: 'e1', type: 'Person', name: 'Alan Turing' }],
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
    const createdEntity = {
      id: entityId,
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Alan Turing',
      aliases: [],
      description: null,
      tags: [],
      properties: {},
      schemaVersionId: null,
      createdBy: '00000000-0000-0000-0000-000000000001',
      createdAt: now,
      updatedAt: now,
    };
    let accepted = false;

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        const respond = (status: number, body: unknown) =>
          Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
          } as Response);

        if (url.includes('/api/auth/me')) {
          return respond(200, {
            user: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'editor@example.com',
              role: 'member',
              createdAt: now,
            },
            csrfToken: 'tok',
          });
        }
        if (url.includes('/api/graph/projection/status')) {
          return respond(200, { id: 'default', state: 'synchronized', pendingEvents: 0 });
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/proposals/${proposalId}/accept`)) {
          accepted = true;
          return respond(200, {
            proposal: { ...proposal, status: 'accepted' },
            createdEntityIds: [entityId],
            createdClaimIds: [],
            createdNoteIds: [],
            createdSourceIds: [],
          });
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/proposals`)) {
          return respond(200, accepted ? [] : [proposal]);
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/entities`)) {
          return respond(200, accepted ? [createdEntity] : []);
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/claims`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/notes`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/sources`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/source-excerpts`)) return respond(200, []);
        if (url.includes('/api/knowledge-bases') && !url.includes(`${kbId}/`)) {
          return respond(200, [
            {
              id: kbId,
              name: 'Proposal Sync KB',
              description: null,
              createdBy: '00000000-0000-0000-0000-000000000001',
              role: 'editor',
              createdAt: now,
              updatedAt: now,
            },
          ]);
        }
        return respond(404, {});
      }),
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId(`kb-select-${kbId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`kb-select-${kbId}`));

    // The pending proposal renders; the entity it would create is not yet shown.
    await waitFor(() => {
      expect(screen.getByTestId(`proposal-accept-${proposalId}`)).toBeInTheDocument();
    });
    expect(screen.queryByTestId(`network-node-${entityId}`)).not.toBeInTheDocument();

    // Accept the proposal.
    fireEvent.click(screen.getByTestId(`proposal-accept-${proposalId}`));

    // Without a page reload or KB reselect, the created entity appears in the
    // graph network view (GraphViews refreshes via the invalidation bus).
    await waitFor(() => {
      expect(screen.getByTestId(`network-node-${entityId}`)).toBeInTheDocument();
    });
  });

  it('shows a proposal from a completed import without reload (US-040)', async () => {
    const kbId = '00000000-0000-0000-0000-000000000120';
    const jobId = '00000000-0000-0000-0000-000000000121';
    const proposalId = '00000000-0000-0000-0000-000000000122';
    const now = new Date().toISOString();
    const proposal = {
      id: proposalId,
      knowledgeBaseId: kbId,
      kind: 'import',
      status: 'pending',
      changes: {
        items: [{ op: 'create_entity', ref: 'e1', type: 'Person', name: 'Ada Lovelace' }],
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
    // Simulates the background worker finishing the import job. While false the
    // job is still running and no proposal exists; once flipped the job has
    // succeeded and produced a pending proposal.
    let importFinished = false;
    const importJob = (status: string) => ({
      id: jobId,
      knowledgeBaseId: kbId,
      type: 'import',
      status,
      attempts: 1,
      maxAttempts: 3,
      runAfter: now,
      payload: {},
      result: null,
      failureReason: null,
      ownerUserId: null,
      createdAt: now,
      updatedAt: now,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        const respond = (status: number, body: unknown) =>
          Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
          } as Response);

        if (url.includes('/api/auth/me')) {
          return respond(200, {
            user: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'owner@example.com',
              role: 'member',
              createdAt: now,
            },
            csrfToken: 'tok',
          });
        }
        if (url.includes('/api/graph/projection/status')) {
          return respond(200, { id: 'default', state: 'synchronized', pendingEvents: 0 });
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/imports`)) {
          return respond(200, { jobs: [importJob(importFinished ? 'succeeded' : 'running')] });
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/jobs`)) {
          return respond(200, { jobs: [importJob(importFinished ? 'succeeded' : 'running')] });
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/audit`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/proposals`)) {
          return respond(200, importFinished ? [proposal] : []);
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/entities`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/claims`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/notes`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/sources`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/source-excerpts`)) return respond(200, []);
        if (url.includes('/api/knowledge-bases') && !url.includes(`${kbId}/`)) {
          return respond(200, [
            {
              id: kbId,
              name: 'Import Sync KB',
              description: null,
              createdBy: '00000000-0000-0000-0000-000000000001',
              role: 'owner',
              createdAt: now,
              updatedAt: now,
            },
          ]);
        }
        return respond(404, {});
      }),
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId(`kb-select-${kbId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`kb-select-${kbId}`));

    // The running import shows in the list; no proposal is pending yet.
    await waitFor(() => {
      expect(screen.getByTestId(`imports-job-${jobId}`)).toBeInTheDocument();
    });
    expect(screen.queryByTestId(`proposal-${proposalId}`)).not.toBeInTheDocument();

    // The background worker finishes; refreshing import status (the clear refresh
    // path) detects the completion and surfaces the new proposal in the Proposals
    // panel without a page reload or KB reselect.
    importFinished = true;
    fireEvent.click(screen.getByTestId('imports-refresh'));

    await waitFor(() => {
      expect(screen.getByTestId(`proposal-${proposalId}`)).toBeInTheDocument();
    });
  });

  it('invalidates claims and graph views after accepting an inferred result (US-041)', async () => {
    const kbId = '00000000-0000-0000-0000-000000000130';
    const ruleId = '00000000-0000-0000-0000-000000000131';
    const runId = '00000000-0000-0000-0000-000000000132';
    const resultId = '00000000-0000-0000-0000-000000000133';
    const claimId = '00000000-0000-0000-0000-000000000134';
    const now = new Date().toISOString();

    const rule = {
      id: ruleId,
      knowledgeBaseId: kbId,
      name: 'knows-symmetry',
      description: null,
      ruleText:
        'knows(?a, ?b) <- claim(?c, "knows"), arg(?c, "subject", ?a), arg(?c, "object", ?b).',
      status: 'enabled',
      version: 1,
      moduleId: null,
      packId: null,
      valid: true,
      validationErrors: [],
      recursionCap: 16,
      createdBy: '00000000-0000-0000-0000-000000000001',
      createdAt: now,
      updatedAt: now,
    };
    const result = {
      id: resultId,
      knowledgeBaseId: kbId,
      ruleRunId: runId,
      ruleId,
      ruleName: 'knows-symmetry',
      predicate: 'knows',
      label: 'inferred',
      arguments: [{ name: 'a', value: 'Ada', entityName: 'Ada' }],
      trace: { claimIds: [], entityIds: [], argumentIds: [] },
      createdAt: now,
    };
    const runResult = {
      run: {
        id: runId,
        knowledgeBaseId: kbId,
        ruleId,
        ruleName: 'knows-symmetry',
        status: 'completed',
        startedAt: now,
        finishedAt: now,
        error: null,
        resultCount: 1,
        iterations: 1,
        limitExceeded: false,
        triggeredBy: '00000000-0000-0000-0000-000000000001',
        jobId: null,
        createdAt: now,
      },
      results: [result],
    };

    mockFetch((url) => {
      if (url.includes(`/api/knowledge-bases/${kbId}/rules/packs`)) return { body: [] };
      if (
        url.includes(`/api/knowledge-bases/${kbId}/rules/runs/${runId}/results/${resultId}/accept`)
      )
        return { body: { claimId, result } };
      if (url.includes(`/api/knowledge-bases/${kbId}/rules/${ruleId}/run`))
        return { body: runResult };
      if (url.includes(`/api/knowledge-bases/${kbId}/rules`)) return { body: [rule] };
      return { status: 404 };
    });

    const onClaimsInvalidated = vi.fn();
    const onGraphInvalidated = vi.fn();

    function Probe() {
      useInvalidationEffect(['claims'], onClaimsInvalidated);
      useInvalidationEffect(['graphViews'], onGraphInvalidated);
      return null;
    }

    const kb: KnowledgeBase = {
      id: kbId,
      name: 'Rules Sync KB',
      description: null,
      createdBy: '00000000-0000-0000-0000-000000000001',
      role: 'editor',
      createdAt: now,
      updatedAt: now,
    };

    render(
      <InvalidationProvider>
        <Rules kb={kb} csrfToken="tok" />
        <Probe />
      </InvalidationProvider>,
    );

    // Run the enabled rule to produce an inferred result.
    await waitFor(() => {
      expect(screen.getByTestId(`rules-run-${ruleId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`rules-run-${ruleId}`));

    await waitFor(() => {
      expect(screen.getByTestId(`rules-run-accept-${resultId}`)).toBeInTheDocument();
    });

    // Accept the inferred result; the sibling claim/graph subscribers refresh
    // and the Rules panel marks the result as accepted (AC2/AC3/AC4).
    fireEvent.click(screen.getByTestId(`rules-run-accept-${resultId}`));

    await waitFor(() => {
      expect(screen.getByTestId(`rules-run-accepted-${resultId}`)).toBeInTheDocument();
    });
    expect(onClaimsInvalidated).toHaveBeenCalled();
    expect(onGraphInvalidated).toHaveBeenCalled();
  });

  it('invalidates schemas and rules after installing a module (US-042)', async () => {
    const kbId = '00000000-0000-0000-0000-000000000140';
    const now = new Date().toISOString();

    const moduleBase = {
      id: 'personal-relationship',
      name: 'Personal Relationships',
      description: 'People, events, and places plus relationship inference.',
      entityTypes: [
        {
          name: 'Person',
          displayName: 'Person',
          description: 'A person.',
          propertySchema: {},
        },
      ],
      claimPredicates: [
        {
          name: 'knows',
          displayName: 'knows',
          description: 'One person knows another.',
          spec: { argumentRoles: [] },
        },
      ],
      rulePacks: [{ moduleId: 'personal-relationship', packId: 'event-participation' }],
    };

    let installed = false;

    mockFetch((url) => {
      if (url.includes(`/api/knowledge-bases/${kbId}/modules/install`)) {
        installed = true;
        return { body: { moduleId: moduleBase.id, items: [] } };
      }
      if (url.includes(`/api/knowledge-bases/${kbId}/modules`)) {
        return {
          body: [
            {
              ...moduleBase,
              installedEntityTypes: installed ? ['Person'] : [],
              installedClaimPredicates: installed ? ['knows'] : [],
              fullyInstalled: installed,
            },
          ],
        };
      }
      return { status: 404 };
    });

    const onSchemasInvalidated = vi.fn();
    const onRulesInvalidated = vi.fn();

    function Probe() {
      useInvalidationEffect(['schemas'], onSchemasInvalidated);
      useInvalidationEffect(['rules'], onRulesInvalidated);
      return null;
    }

    const kb: KnowledgeBase = {
      id: kbId,
      name: 'Modules Sync KB',
      description: null,
      createdBy: '00000000-0000-0000-0000-000000000001',
      role: 'editor',
      createdAt: now,
      updatedAt: now,
    };

    render(
      <InvalidationProvider>
        <Modules kb={kb} csrfToken="tok" />
        <Probe />
      </InvalidationProvider>,
    );

    // Module starts not-installed.
    await waitFor(() => {
      expect(screen.getByTestId(`modules-install-${moduleBase.id}`)).toBeInTheDocument();
    });
    expect(screen.queryByTestId(`modules-installed-${moduleBase.id}`)).not.toBeInTheDocument();

    // Install it; sibling schema/rule subscribers refresh without reload (AC1/AC2/AC3)
    // and the Modules panel itself shows installed status (AC4).
    fireEvent.click(screen.getByTestId(`modules-install-${moduleBase.id}`));

    await waitFor(() => {
      expect(screen.getByTestId(`modules-installed-${moduleBase.id}`)).toBeInTheDocument();
    });
    expect(onSchemasInvalidated).toHaveBeenCalled();
    expect(onRulesInvalidated).toHaveBeenCalled();
  });

  it('marks search results stale after an entity mutation and clears on rerun (US-043)', async () => {
    const kbId = '00000000-0000-0000-0000-000000000150';
    const entityId = '00000000-0000-0000-0000-000000000151';
    const now = new Date().toISOString();
    const created = {
      id: entityId,
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada Lovelace',
      aliases: [],
      description: null,
      tags: [],
      properties: {},
      schemaVersionId: null,
      createdBy: '00000000-0000-0000-0000-000000000001',
      createdAt: now,
      updatedAt: now,
    };
    let entityCreated = false;

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';
        const respond = (status: number, body: unknown) =>
          Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
          } as Response);

        if (url.includes('/api/auth/me')) {
          return respond(200, {
            user: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'editor@example.com',
              role: 'member',
              createdAt: now,
            },
            csrfToken: 'tok',
          });
        }
        if (url.includes('/api/graph/projection/status')) {
          return respond(200, { id: 'default', state: 'synchronized', pendingEvents: 0 });
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/search`)) {
          return respond(200, { results: [], vectorSearch: { available: false, reason: null } });
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/entities`)) {
          if (method === 'POST') {
            entityCreated = true;
            return respond(201, created);
          }
          return respond(200, entityCreated ? [created] : []);
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/claims`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/notes`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/sources`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/source-excerpts`)) return respond(200, []);
        if (url.includes('/api/knowledge-bases') && !url.includes(`${kbId}/`)) {
          return respond(200, [
            {
              id: kbId,
              name: 'Stale Sync KB',
              description: null,
              createdBy: '00000000-0000-0000-0000-000000000001',
              role: 'editor',
              createdAt: now,
              updatedAt: now,
            },
          ]);
        }
        return respond(404, {});
      }),
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId(`kb-select-${kbId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`kb-select-${kbId}`));

    // Run a search to get results; no stale banner yet.
    await waitFor(() => {
      expect(screen.getByTestId('search-submit')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('search-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('search-results')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('search-stale')).not.toBeInTheDocument();

    // Creating an entity invalidates the entities domain; search results go stale.
    fireEvent.change(screen.getByTestId('entity-name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.click(screen.getByTestId('entity-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('search-stale')).toBeInTheDocument();
    });

    // Rerunning the search clears the stale banner (AC4).
    fireEvent.click(screen.getByTestId('search-submit'));
    await waitFor(() => {
      expect(screen.queryByTestId('search-stale')).not.toBeInTheDocument();
    });
  });

  it('shows an imported Knowledge Base in the KB list without reload (US-044)', async () => {
    const kbId = '00000000-0000-0000-0000-000000000160';
    const importedKbId = '00000000-0000-0000-0000-000000000161';
    const now = new Date().toISOString();
    // Simulates the portable import creating a NEW Knowledge Base server-side:
    // while false the KB list has only the source KB; once the import POST
    // succeeds the flag flips and the next list GET also returns the new KB.
    let imported = false;

    const portableExport = {
      format: 'jotmind.kb.portable',
      formatVersion: 1,
      exportedAt: now,
      fidelity: 'portable-graph',
      labels: { json: 'j', markdown: 'm', csv: 'c' },
      secretPolicy: { excludesProviderSecrets: true, excludedSecretFields: [] },
      knowledgeBase: {
        id: '00000000-0000-0000-0000-000000000162',
        name: 'Restored Backup',
        description: null,
        createdAt: now,
        updatedAt: now,
      },
      data: {
        schemas: [],
        entities: [],
        claims: [],
        notes: [],
        sources: [],
        citations: [],
        rules: [],
      },
      audit: { note: 'export', events: [] },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';
        const respond = (status: number, body: unknown) =>
          Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
          } as Response);

        if (url.includes('/api/auth/me')) {
          return respond(200, {
            user: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'owner@example.com',
              role: 'member',
              createdAt: now,
            },
            csrfToken: 'tok',
          });
        }
        if (url.includes('/api/graph/projection/status')) {
          return respond(200, { id: 'default', state: 'synchronized', pendingEvents: 0 });
        }
        // The portable import endpoint: creates a new KB and flips the flag so
        // the next KB-list GET includes it. Must be matched BEFORE the generic
        // /api/knowledge-bases list matcher below (it has no `${kbId}/`).
        if (url.includes('/api/knowledge-bases/import-portable') && method === 'POST') {
          imported = true;
          return respond(201, {
            importedAt: now,
            knowledgeBaseId: importedKbId,
            knowledgeBaseName: 'Restored Backup',
            counts: {
              schemaDefinitions: 0,
              schemaVersions: 0,
              entities: 0,
              claims: 0,
              notes: 0,
              sources: 0,
              citations: 0,
              rules: 0,
            },
            warnings: [],
          });
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/audit`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/jobs`)) return respond(200, { jobs: [] });
        if (url.includes(`/api/knowledge-bases/${kbId}/entities`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/claims`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/notes`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/sources`)) return respond(200, []);
        if (url.includes(`/api/knowledge-bases/${kbId}/source-excerpts`)) return respond(200, []);
        if (url.includes('/api/knowledge-bases') && !url.includes(`${kbId}/`)) {
          const source = {
            id: kbId,
            name: 'Backup Source KB',
            description: null,
            createdBy: '00000000-0000-0000-0000-000000000001',
            role: 'owner',
            createdAt: now,
            updatedAt: now,
          };
          const restored = {
            id: importedKbId,
            name: 'Restored Backup',
            description: null,
            createdBy: '00000000-0000-0000-0000-000000000001',
            role: 'owner',
            createdAt: now,
            updatedAt: now,
          };
          return respond(200, imported ? [source, restored] : [source]);
        }
        return respond(404, {});
      }),
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId(`kb-select-${kbId}`)).toBeInTheDocument();
    });
    // The imported KB is not in the list yet.
    expect(screen.queryByTestId(`kb-select-${importedKbId}`)).not.toBeInTheDocument();

    // Select the owner KB so the (admin-gated) KbAdmin import controls render.
    fireEvent.click(screen.getByTestId(`kb-select-${kbId}`));
    await waitFor(() => {
      expect(screen.getByTestId('kb-import-file')).toBeInTheDocument();
    });

    // Upload a portable JSON backup; on success the parent KB list refreshes.
    // jsdom's File does not implement `.text()`, so polyfill it here.
    const fileText = JSON.stringify(portableExport);
    const file = new File([fileText], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(fileText) });
    fireEvent.change(screen.getByTestId('kb-import-file'), { target: { files: [file] } });

    // The success message identifies the imported KB by name (AC3)...
    await waitFor(() => {
      expect(screen.getByTestId('kb-import-result')).toBeInTheDocument();
    });
    // ...and the imported KB now appears in the selector/list without a reload
    // (AC1/AC2).
    await waitFor(() => {
      expect(screen.getByTestId(`kb-select-${importedKbId}`)).toBeInTheDocument();
    });
  });

  // US-045: AI policy changes must refresh every visible effective-policy and
  // AI-availability surface without a page reload.
  function stubAiPolicyApp(kbId: string) {
    const now = new Date().toISOString();
    const off = { mode: 'off', remoteEmbeddings: false };
    const localOnly = { mode: 'local_only', remoteEmbeddings: false };
    const resolved = (mode: string) => ({
      mode,
      remoteAllowed: false,
      remoteEmbeddingsAllowed: false,
      requiresPerRequestConfirmation: false,
    });
    // Flips once a policy layer is saved so the next effective GET reflects it.
    const state = { serverSaved: false, kbSaved: false };

    const commandResponse = {
      query: 'ada',
      ai: {
        attempted: false,
        available: false,
        reason: 'AI is disabled by policy',
        repaired: false,
        lowConfidence: false,
        provider: null,
        model: null,
        demo: false,
        label: null,
      },
      interpretation: null,
      interpretedResults: null,
      fallback: { results: [], vectorSearch: { available: false, reason: null } },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';
        const respond = (status: number, body: unknown) =>
          Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
          } as Response);

        if (url.includes('/api/auth/me')) {
          return respond(200, {
            user: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'admin@example.com',
              role: 'admin',
              createdAt: now,
            },
            csrfToken: 'tok',
          });
        }
        // Server/user effective (non-KB) policy overview.
        if (url.endsWith('/api/ai/policy')) {
          return respond(200, {
            server: state.serverSaved ? localOnly : off,
            user: off,
            effective: resolved(state.serverSaved ? 'local_only' : 'off'),
          });
        }
        if (url.includes('/api/ai/policy/server') && method === 'PUT') {
          state.serverSaved = true;
          return respond(200, localOnly);
        }
        if (url.includes('/api/ai/policy/me') && method === 'PUT') {
          return respond(200, off);
        }
        // KB-scoped AI policy (GET + PUT).
        if (url.includes(`/api/knowledge-bases/${kbId}/ai/policy`)) {
          if (method === 'PUT') {
            state.kbSaved = true;
            return respond(200, {
              policy: localOnly,
              server: off,
              user: off,
              effective: resolved('local_only'),
            });
          }
          const mode = state.kbSaved || state.serverSaved ? 'local_only' : 'off';
          return respond(200, {
            policy: state.kbSaved ? localOnly : off,
            server: state.serverSaved ? localOnly : off,
            user: off,
            effective: resolved(mode),
          });
        }
        if (url.includes(`/api/knowledge-bases/${kbId}/command`)) {
          return respond(200, commandResponse);
        }
        if (url.includes('/api/knowledge-bases') && !url.includes(`${kbId}/`)) {
          return respond(200, [
            {
              id: kbId,
              name: 'Policy KB',
              description: null,
              createdBy: '00000000-0000-0000-0000-000000000001',
              role: 'admin',
              createdAt: now,
              updatedAt: now,
            },
          ]);
        }
        return respond(404, {});
      }),
    );
  }

  it('marks AI-availability surfaces stale after a KB AI policy change (US-045 AC3/AC4)', async () => {
    const kbId = '00000000-0000-0000-0000-000000000170';
    stubAiPolicyApp(kbId);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId(`kb-select-${kbId}`)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId(`kb-select-${kbId}`));

    // Run a command to surface the AI-availability indicator.
    await waitFor(() => expect(screen.getByTestId('command-submit')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('command-query'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByTestId('command-submit'));
    await waitFor(() => expect(screen.getByTestId('command-ai-status')).toBeInTheDocument());
    expect(screen.queryByTestId('command-ai-policy-stale')).not.toBeInTheDocument();

    // The KB effective policy shows the initial mode.
    await waitFor(() => expect(screen.getByTestId('kb-ai-policy-effective')).toBeInTheDocument());
    expect(screen.getByTestId('kb-ai-policy-effective')).toHaveTextContent('No AI');

    // Change + save the KB AI policy layer (AC3).
    fireEvent.change(screen.getByTestId('kb-ai-policy-mode'), { target: { value: 'local_only' } });
    fireEvent.click(screen.getByTestId('kb-ai-policy-save'));

    // The AI-availability surface goes stale without reload (AC4)...
    await waitFor(() => expect(screen.getByTestId('command-ai-policy-stale')).toBeInTheDocument());
    // ...and the selected-KB effective policy refreshes to the new mode.
    await waitFor(() =>
      expect(screen.getByTestId('kb-ai-policy-effective')).toHaveTextContent('Local only'),
    );

    // Re-running the command clears the stale banner.
    fireEvent.click(screen.getByTestId('command-submit'));
    await waitFor(() =>
      expect(screen.queryByTestId('command-ai-policy-stale')).not.toBeInTheDocument(),
    );
  });

  it('refreshes selected-KB surfaces after a server AI policy change across the provider boundary (US-045 AC1/AC4)', async () => {
    const kbId = '00000000-0000-0000-0000-000000000171';
    stubAiPolicyApp(kbId);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId(`kb-select-${kbId}`)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId(`kb-select-${kbId}`));

    await waitFor(() => expect(screen.getByTestId('command-submit')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('command-query'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByTestId('command-submit'));
    await waitFor(() => expect(screen.getByTestId('command-ai-status')).toBeInTheDocument());
    expect(screen.queryByTestId('command-ai-policy-stale')).not.toBeInTheDocument();

    // Save the (app-level) server AI policy, which lives OUTSIDE the per-KB bus.
    fireEvent.change(screen.getByTestId('ai-policy-server-mode'), {
      target: { value: 'local_only' },
    });
    fireEvent.click(screen.getByTestId('ai-policy-server-save'));

    // The cross-boundary escape hatch invalidates the selected-KB aiPolicy
    // domain, so the AI-availability surface goes stale (AC1/AC4)...
    await waitFor(() => expect(screen.getByTestId('command-ai-policy-stale')).toBeInTheDocument());
    // ...and the selected-KB effective policy refreshes to fold in the new
    // server layer without a page reload.
    await waitFor(() =>
      expect(screen.getByTestId('kb-ai-policy-effective')).toHaveTextContent('Local only'),
    );
  });
});

describe('AiProviderStatusPanel (US-046)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('states provider config is environment-only when no provider is configured (AC3)', async () => {
    mockFetch((url) => {
      if (url.includes('/api/ai/provider'))
        return { body: { configured: false, editable: false, configSource: 'environment' } };
      return { status: 404 };
    });
    render(<AiProviderStatusPanel />);
    await waitFor(() =>
      expect(screen.getByTestId('ai-provider-not-configured')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('ai-provider-env-only')).toHaveTextContent(
      /managed by the server environment and cannot be edited in the browser/i,
    );
  });

  it('shows kind, models, base URL, readiness, and local classification (AC1/AC2)', async () => {
    mockFetch((url) => {
      if (url.includes('/api/ai/provider'))
        return {
          body: {
            configured: true,
            editable: false,
            configSource: 'environment',
            kind: 'ollama',
            name: 'Local Ollama',
            classification: 'local',
            remote: false,
            demo: false,
            verified: true,
            llmModel: 'llama3',
            embeddingModel: 'nomic-embed-text',
            embeddingsSupported: true,
            baseUrl: 'http://localhost:11434',
          },
        };
      return { status: 404 };
    });
    render(<AiProviderStatusPanel />);
    await waitFor(() => expect(screen.getByTestId('ai-provider-kind')).toHaveTextContent('Ollama'));
    expect(screen.getByTestId('ai-provider-name')).toHaveTextContent('Local Ollama');
    expect(screen.getByTestId('ai-provider-classification')).toHaveTextContent('Local');
    expect(screen.getByTestId('ai-provider-readiness')).toHaveTextContent('Ready');
    expect(screen.getByTestId('ai-provider-llm-model')).toHaveTextContent('llama3');
    expect(screen.getByTestId('ai-provider-embedding-model')).toHaveTextContent('nomic-embed-text');
    expect(screen.getByTestId('ai-provider-base-url')).toHaveTextContent('localhost:11434');
    expect(screen.queryByTestId('ai-provider-demo')).not.toBeInTheDocument();
  });

  it('labels a mock provider as deterministic demo output (AC5)', async () => {
    mockFetch((url) => {
      if (url.includes('/api/ai/provider'))
        return {
          body: {
            configured: true,
            editable: false,
            configSource: 'environment',
            kind: 'mock',
            name: 'Demo Mock',
            classification: 'demo',
            remote: false,
            demo: true,
            verified: true,
            llmModel: null,
            embeddingModel: null,
            embeddingsSupported: true,
          },
        };
      return { status: 404 };
    });
    render(<AiProviderStatusPanel />);
    await waitFor(() => expect(screen.getByTestId('ai-provider-demo')).toBeInTheDocument());
    expect(screen.getByTestId('ai-provider-demo')).toHaveTextContent(/deterministic demo output/i);
  });

  it('marks a remote provider unverified and never renders a secret (AC2/AC4)', async () => {
    mockFetch((url) => {
      if (url.includes('/api/ai/provider'))
        return {
          body: {
            configured: true,
            editable: false,
            configSource: 'environment',
            kind: 'openai',
            name: 'OpenAI',
            classification: 'remote',
            remote: true,
            demo: false,
            verified: false,
            llmModel: 'gpt-4o-mini',
            embeddingModel: 'text-embedding-3-small',
            embeddingsSupported: true,
            baseUrl: 'https://api.openai.com/v1',
          },
        };
      return { status: 404 };
    });
    const { container } = render(<AiProviderStatusPanel />);
    await waitFor(() =>
      expect(screen.getByTestId('ai-provider-readiness')).toHaveTextContent(/unverified/i),
    );
    expect(screen.getByTestId('ai-provider-classification')).toHaveTextContent('Remote');
    expect(container.textContent ?? '').not.toMatch(/apiKey|sk-/);
  });
});
