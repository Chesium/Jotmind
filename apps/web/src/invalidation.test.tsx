import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  INVALIDATION_DOMAINS,
  InvalidationProvider,
  createInvalidationBus,
  useInvalidate,
  useInvalidationEffect,
  type InvalidationDomain,
} from './invalidation.js';

describe('createInvalidationBus', () => {
  it('notifies a listener subscribed to a published domain', () => {
    const bus = createInvalidationBus();
    const listener = vi.fn();
    bus.subscribe(['entities'], listener);

    bus.invalidate('entities');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify listeners for unrelated domains', () => {
    const bus = createInvalidationBus();
    const listener = vi.fn();
    bus.subscribe(['claims'], listener);

    bus.invalidate('entities');

    expect(listener).not.toHaveBeenCalled();
  });

  it('fires a multi-domain listener only once per invalidate call', () => {
    const bus = createInvalidationBus();
    const listener = vi.fn();
    bus.subscribe(['entities', 'claims'], listener);

    bus.invalidate(['entities', 'claims']);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const bus = createInvalidationBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(['rules'], listener);

    unsubscribe();
    bus.invalidate('rules');

    expect(listener).not.toHaveBeenCalled();
  });

  it('covers every declared invalidation domain', () => {
    // AC2: domains must include each of these.
    const expected: InvalidationDomain[] = [
      'entities',
      'claims',
      'notes',
      'sources',
      'sourceExcerpts',
      'graphViews',
      'proposals',
      'jobs',
      'audit',
      'schemas',
      'rules',
      'modules',
      'aiPolicy',
      'searchResults',
      'commandResults',
      'answers',
    ];
    expect([...INVALIDATION_DOMAINS].sort()).toEqual([...expected].sort());
  });
});

describe('invalidation hooks', () => {
  function Publisher({ domains }: { domains: InvalidationDomain[] }) {
    const invalidate = useInvalidate();
    return (
      <button data-testid="publish" onClick={() => invalidate(domains)}>
        publish
      </button>
    );
  }

  function Subscriber({
    domains,
    onInvalidate,
  }: {
    domains: InvalidationDomain[];
    onInvalidate: () => void;
  }) {
    useInvalidationEffect(domains, onInvalidate);
    return <div data-testid="subscriber" />;
  }

  it('routes publish -> subscribe within a provider', () => {
    const reload = vi.fn();
    render(
      <InvalidationProvider>
        <Publisher domains={['entities']} />
        <Subscriber domains={['entities']} onInvalidate={reload} />
      </InvalidationProvider>,
    );

    screen.getByTestId('publish').click();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not cross-notify subscribers of other domains', () => {
    const reload = vi.fn();
    render(
      <InvalidationProvider>
        <Publisher domains={['claims']} />
        <Subscriber domains={['entities']} onInvalidate={reload} />
      </InvalidationProvider>,
    );

    screen.getByTestId('publish').click();

    expect(reload).not.toHaveBeenCalled();
  });

  it('is a safe no-op when used in isolation without a provider', () => {
    // AC4: panel-local behavior still works; hooks must not throw or fire.
    const reload = vi.fn();
    render(
      <>
        <Publisher domains={['entities']} />
        <Subscriber domains={['entities']} onInvalidate={reload} />
      </>,
    );

    expect(() => screen.getByTestId('publish').click()).not.toThrow();
    expect(reload).not.toHaveBeenCalled();
  });
});
