import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from './App.js';

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
});
