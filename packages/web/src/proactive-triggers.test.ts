import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUSHI_INTERNAL_INIT_MARKER } from '@mushi-mushi/core';
import { scriptUrlFromStack, setupProactiveTriggers } from './proactive-triggers';

// ── pageDwell ─────────────────────────────────────────────────────────────────

describe('setupProactiveTriggers pageDwell', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Ensure window.location exists in the test environment
    Object.defineProperty(window, 'location', {
      value: { pathname: '/dashboard' },
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires after threshold ms on the same route', () => {
    const onTrigger = vi.fn();
    const cleanup = setupProactiveTriggers(
      { onTrigger },
      {
        rageClick: false,
        longTask: false,
        apiCascade: false,
        errorBoundary: false,
        pageDwell: { thresholdMs: 1000 },
      },
    );

    vi.advanceTimersByTime(1001);
    expect(onTrigger).toHaveBeenCalledWith('page_dwell', expect.objectContaining({ thresholdMs: 1000 }));
    cleanup.destroy();
  });

  it('does NOT fire on excluded auth routes', () => {
    const onTrigger = vi.fn();
    Object.defineProperty(window, 'location', { value: { pathname: '/login' }, writable: true });

    const cleanup = setupProactiveTriggers(
      { onTrigger },
      {
        rageClick: false,
        longTask: false,
        apiCascade: false,
        errorBoundary: false,
        pageDwell: { thresholdMs: 500 },
      },
    );

    vi.advanceTimersByTime(600);
    expect(onTrigger).not.toHaveBeenCalled();
    cleanup.destroy();
  });

  it('does NOT fire on /signup (default exclude list)', () => {
    const onTrigger = vi.fn();
    Object.defineProperty(window, 'location', { value: { pathname: '/signup' }, writable: true });

    const cleanup = setupProactiveTriggers(
      { onTrigger },
      {
        rageClick: false,
        longTask: false,
        apiCascade: false,
        errorBoundary: false,
        pageDwell: { thresholdMs: 500 },
      },
    );

    vi.advanceTimersByTime(600);
    expect(onTrigger).not.toHaveBeenCalled();
    cleanup.destroy();
  });

  it('does NOT fire on /auth/* routes (wildcard default)', () => {
    const onTrigger = vi.fn();
    Object.defineProperty(window, 'location', { value: { pathname: '/auth/callback' }, writable: true });

    const cleanup = setupProactiveTriggers(
      { onTrigger },
      {
        rageClick: false,
        longTask: false,
        apiCascade: false,
        errorBoundary: false,
        pageDwell: { thresholdMs: 500 },
      },
    );

    vi.advanceTimersByTime(600);
    expect(onTrigger).not.toHaveBeenCalled();
    cleanup.destroy();
  });

  it('allows overriding excludeRoutes with an empty array', () => {
    const onTrigger = vi.fn();
    Object.defineProperty(window, 'location', { value: { pathname: '/login' }, writable: true });

    const cleanup = setupProactiveTriggers(
      { onTrigger },
      {
        rageClick: false,
        longTask: false,
        apiCascade: false,
        errorBoundary: false,
        pageDwell: { thresholdMs: 500, excludeRoutes: [] },
      },
    );

    vi.advanceTimersByTime(600);
    // With excludeRoutes=[], /login is NOT excluded → should fire
    expect(onTrigger).toHaveBeenCalledWith('page_dwell', expect.anything());
    cleanup.destroy();
  });

  it('cleanup cancels the pending timer', () => {
    const onTrigger = vi.fn();
    const cleanup = setupProactiveTriggers(
      { onTrigger },
      {
        rageClick: false,
        longTask: false,
        apiCascade: false,
        errorBoundary: false,
        pageDwell: { thresholdMs: 1000 },
      },
    );

    cleanup.destroy();
    vi.advanceTimersByTime(1500);
    expect(onTrigger).not.toHaveBeenCalled();
  });
});

// ── firstSession ──────────────────────────────────────────────────────────────

describe('setupProactiveTriggers firstSession', () => {
  const STORAGE_KEY = 'mushi:proj-test:firstSessionShown';

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('fires once after delayMs', () => {
    const onTrigger = vi.fn();
    const cleanup = setupProactiveTriggers(
      { onTrigger },
      {
        rageClick: false,
        longTask: false,
        apiCascade: false,
        errorBoundary: false,
        firstSession: { delayMs: 500, storageKey: STORAGE_KEY },
      },
    );

    vi.advanceTimersByTime(501);
    expect(onTrigger).toHaveBeenCalledWith('first_session', { delayMs: 500 });
    cleanup.destroy();
  });

  it('persists to localStorage after firing', () => {
    const onTrigger = vi.fn();
    const cleanup = setupProactiveTriggers(
      { onTrigger },
      {
        rageClick: false,
        longTask: false,
        apiCascade: false,
        errorBoundary: false,
        firstSession: { delayMs: 100, storageKey: STORAGE_KEY },
      },
    );

    vi.advanceTimersByTime(101);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
    cleanup.destroy();
  });

  it('does NOT fire if already shown (localStorage flag present)', () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    const onTrigger = vi.fn();
    const cleanup = setupProactiveTriggers(
      { onTrigger },
      {
        rageClick: false,
        longTask: false,
        apiCascade: false,
        errorBoundary: false,
        firstSession: { delayMs: 100, storageKey: STORAGE_KEY },
      },
    );

    vi.advanceTimersByTime(200);
    expect(onTrigger).not.toHaveBeenCalled();
    cleanup.destroy();
  });

  it('uses project-scoped default storage key when projectId is provided', () => {
    const projectId = 'my-project-123';
    const onTrigger = vi.fn();
    const cleanup = setupProactiveTriggers(
      { onTrigger },
      {
        rageClick: false,
        longTask: false,
        apiCascade: false,
        errorBoundary: false,
        firstSession: { delayMs: 100 },
        projectId,
      },
    );

    vi.advanceTimersByTime(101);
    const expectedKey = `mushi:${projectId}:firstSessionShown`;
    expect(window.localStorage.getItem(expectedKey)).toBe('1');
    cleanup.destroy();
  });

  it('cleanup cancels the pending timer', () => {
    const onTrigger = vi.fn();
    const cleanup = setupProactiveTriggers(
      { onTrigger },
      {
        rageClick: false,
        longTask: false,
        apiCascade: false,
        errorBoundary: false,
        firstSession: { delayMs: 500, storageKey: STORAGE_KEY },
      },
    );

    cleanup.destroy();
    vi.advanceTimersByTime(600);
    expect(onTrigger).not.toHaveBeenCalled();
  });
});

// ── apiCascade ────────────────────────────────────────────────────────────────

describe('setupProactiveTriggers apiCascade', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('ignores Mushi internal and configured URLs when counting cascades', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('bad', { status: 500 }));
    const onTrigger = vi.fn();
    const cleanup = setupProactiveTriggers(
      { onTrigger },
      {
        rageClick: false,
        longTask: false,
        apiEndpoint: 'https://mushi.example.com/functions/v1/api',
        apiCascade: { ignoreUrls: ['analytics.example.com'] },
      },
    );

    await fetch('https://mushi.example.com/functions/v1/api/v1/sdk/config');
    await fetch('https://analytics.example.com/noisy');
    await fetch('https://host.example.com/marked', {
      [MUSHI_INTERNAL_INIT_MARKER]: 'sdk-config',
    } as RequestInit & { [MUSHI_INTERNAL_INIT_MARKER]?: string });

    expect(onTrigger).not.toHaveBeenCalled();
    cleanup.destroy();
  });

  it('still triggers for repeated host-app failures', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('bad', { status: 500 }));
    const onTrigger = vi.fn();
    const cleanup = setupProactiveTriggers(
      { onTrigger },
      { rageClick: false, longTask: false, apiCascade: true },
    );

    await fetch('https://api.example.com/a');
    await fetch('https://api.example.com/b');
    await fetch('https://api.example.com/c');

    expect(onTrigger).toHaveBeenCalledWith('api_cascade', {
      failureCount: 3,
      windowMs: 10000,
    });
    cleanup.destroy();
  });
});

describe('setupProactiveTriggers errorBoundary filters', () => {
  it('does not fire when ignoreErrors matches', () => {
    const onTrigger = vi.fn();
    const cleanup = setupProactiveTriggers(
      { onTrigger },
      {
        rageClick: false,
        longTask: false,
        apiCascade: false,
        errorBoundary: true,
        ignoreErrors: ['ResizeObserver'],
      },
    );
    window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop limit exceeded' }));
    expect(onTrigger).not.toHaveBeenCalled();
    cleanup.destroy();
  });

  it('fires for an unmatched error', () => {
    const onTrigger = vi.fn();
    const cleanup = setupProactiveTriggers(
      { onTrigger },
      {
        rageClick: false,
        longTask: false,
        apiCascade: false,
        errorBoundary: true,
        ignoreErrors: ['ResizeObserver'],
      },
    );
    window.dispatchEvent(new ErrorEvent('error', { message: 'Checkout crashed' }));
    expect(onTrigger).toHaveBeenCalledWith(
      'error_boundary',
      expect.objectContaining({ message: 'Checkout crashed' }),
    );
    cleanup.destroy();
  });

  // An unhandled rejection has no `filename`, so the URL filters have to read
  // the script URL out of the reason's stack. Before they did, allowUrls
  // dropped every rejection and denyUrls never matched one.
  function rejectionFrom(stack: string): Event {
    const reason = new Error('Checkout promise failed');
    reason.stack = stack;
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: reason });
    return event;
  }

  function setupWithUrlFilters(onTrigger: ReturnType<typeof vi.fn>, filters: {
    allowUrls?: string[];
    denyUrls?: string[];
  }) {
    return setupProactiveTriggers(
      { onTrigger },
      { rageClick: false, longTask: false, apiCascade: false, errorBoundary: true, ...filters },
    );
  }

  it('fires for a rejection whose stack points at an allowed script', () => {
    const onTrigger = vi.fn();
    const cleanup = setupWithUrlFilters(onTrigger, { allowUrls: ['https://app.example.com/'] });
    window.dispatchEvent(
      rejectionFrom(
        'Error: Checkout promise failed\n    at pay (https://app.example.com/assets/app.js:10:5)',
      ),
    );
    expect(onTrigger).toHaveBeenCalledWith(
      'error_boundary',
      expect.objectContaining({ type: 'unhandled_rejection' }),
    );
    cleanup.destroy();
  });

  it('drops a rejection whose stack points at a denied script', () => {
    const onTrigger = vi.fn();
    const cleanup = setupWithUrlFilters(onTrigger, { denyUrls: ['chrome-extension://'] });
    window.dispatchEvent(rejectionFrom('pay@chrome-extension://abc/inject.js:3:9'));
    expect(onTrigger).not.toHaveBeenCalled();
    cleanup.destroy();
  });
});

describe('scriptUrlFromStack', () => {
  it('reads the innermost frame in V8 and Firefox/Safari shapes', () => {
    expect(
      scriptUrlFromStack(
        'TypeError: boom\n    at pay (https://cdn.example.com:8443/app.js:10:5)\n    at https://other.example.com/vendor.js:1:1',
      ),
    ).toBe('https://cdn.example.com:8443/app.js');
    expect(scriptUrlFromStack('    at https://cdn.example.com/app.js:10:5')).toBe(
      'https://cdn.example.com/app.js',
    );
    expect(scriptUrlFromStack('pay@https://cdn.example.com/app.js:10:5\n@https://x.example.com/y.js:1:1')).toBe(
      'https://cdn.example.com/app.js',
    );
  });

  it('returns undefined when no frame carries a URL', () => {
    expect(scriptUrlFromStack('Error: boom\n    at <anonymous>\n    at Array.map (native)')).toBeUndefined();
    expect(scriptUrlFromStack(undefined)).toBeUndefined();
    expect(scriptUrlFromStack('')).toBeUndefined();
  });
});
