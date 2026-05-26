import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUSHI_INTERNAL_INIT_MARKER } from '@mushi-mushi/core';
import { setupProactiveTriggers } from './proactive-triggers';

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
