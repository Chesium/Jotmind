import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});
