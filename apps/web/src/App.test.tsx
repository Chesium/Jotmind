import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
      return { status: 404 };
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('current-user')).toHaveTextContent('admin@example.com');
    });
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument();
  });
});
