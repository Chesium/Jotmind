import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from './App.js';

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          status: 'ok',
          service: 'jotmind-api',
          version: '0.0.0',
          timestamp: new Date().toISOString(),
        }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the app title', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'JotMind' })).toBeInTheDocument();
  });

  it('shows API status after a successful health fetch', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('health-status')).toHaveTextContent('API status: ok');
    });
  });
});
