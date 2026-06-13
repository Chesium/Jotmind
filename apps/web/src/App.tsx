import { useEffect, useState } from 'react';
import { healthStatusSchema, type HealthStatus } from '@jotmind/schemas';

export function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        const parsed = healthStatusSchema.parse(data);
        if (!cancelled) setHealth(parsed);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>JotMind</h1>
      <p>Privacy-first, self-hostable graph knowledge app.</p>
      <section aria-label="api-health">
        {health ? (
          <p data-testid="health-status">API status: {health.status}</p>
        ) : error ? (
          <p data-testid="health-error">API unavailable: {error}</p>
        ) : (
          <p data-testid="health-loading">Checking API…</p>
        )}
      </section>
    </main>
  );
}
