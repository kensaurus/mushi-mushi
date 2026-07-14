import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MushiApiClient } from './types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMockClient(): MushiApiClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    postSessionEvent: vi.fn(async (payload) => {
      calls.push(payload);
      return { success: true, data: { accepted: true } } as ReturnType<MushiApiClient['postSessionEvent']> extends Promise<infer T> ? T : never;
    }),
  } as unknown as MushiApiClient & { calls: unknown[] };
}

// Each test must work with fresh module state (session-tracker uses module-level
// singletons). vitest isolates by re-importing after resetModules.
async function freshTracker() {
  vi.resetModules();
  const mod = await import('./session-tracker');
  return mod;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('initSessionTracker', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends session_start immediately on init', async () => {
    const { initSessionTracker, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();

    initSessionTracker({ client, sdkVersion: '1.0.0' });

    expect(client.postSessionEvent).toHaveBeenCalledTimes(1);
    const [payload] = (client.postSessionEvent as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown];
    expect((payload as Record<string, unknown>).kind).toBe('session_start');
    expect((payload as Record<string, unknown>).sdk_version).toBe('1.0.0');

    destroySessionTracker();
  });

  it('is idempotent — second init call is ignored', async () => {
    const { initSessionTracker, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();

    initSessionTracker({ client });
    initSessionTracker({ client });

    expect(client.postSessionEvent).toHaveBeenCalledTimes(1);
    destroySessionTracker();
  });

  it('sends session_heartbeat after 60 seconds', async () => {
    const { initSessionTracker, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();

    initSessionTracker({ client });

    // Advance just past the first heartbeat tick without triggering infinite loops.
    vi.advanceTimersByTime(61_000);

    const kinds = (client.postSessionEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      ([p]: [Record<string, unknown>]) => p.kind,
    );
    expect(kinds).toContain('session_heartbeat');

    destroySessionTracker();
  });

  it('sends session_end on visibilitychange to hidden', async () => {
    const { initSessionTracker, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();

    initSessionTracker({ client });

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    const kinds = (client.postSessionEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      ([p]: [Record<string, unknown>]) => p.kind,
    );
    expect(kinds).toContain('session_end');

    destroySessionTracker();
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
  });

  it('destroySessionTracker resets state so a re-init fires session_start again', async () => {
    const { initSessionTracker, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();

    initSessionTracker({ client });
    destroySessionTracker();
    initSessionTracker({ client });

    const starts = (client.postSessionEvent as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([p]: [Record<string, unknown>]) => p.kind === 'session_start',
    );
    expect(starts).toHaveLength(2);

    destroySessionTracker();
  });
});

describe('trackPageView', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('increments page_view_count and emits page_view event', async () => {
    const { initSessionTracker, trackPageView, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();

    initSessionTracker({ client });

    trackPageView('/about');

    const calls = (client.postSessionEvent as ReturnType<typeof vi.fn>).mock.calls;
    const pageViewCall = calls.find(([p]: [Record<string, unknown>]) => p.kind === 'page_view');
    expect(pageViewCall).toBeDefined();
    const payload = pageViewCall![0] as Record<string, unknown>;
    expect(payload.route).toBe('/about');
    expect(payload.page_view_count).toBe(2);

    destroySessionTracker();
  });

  it('no-ops when tracker not initialized', async () => {
    const { trackPageView } = await freshTracker();
    const client = makeMockClient();

    // tracker not initialized, should not throw
    expect(() => trackPageView('/test')).not.toThrow();
    expect(client.postSessionEvent).not.toHaveBeenCalled();
  });
});

describe('updateSessionIdentity', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('propagates user_id_hash into subsequent heartbeats', async () => {
    const { initSessionTracker, updateSessionIdentity, trackPageView, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();

    initSessionTracker({ client });
    updateSessionIdentity('user123');
    trackPageView('/profile');

    const calls = (client.postSessionEvent as ReturnType<typeof vi.fn>).mock.calls;
    const pageViewCall = calls.find(([p]: [Record<string, unknown>]) => p.kind === 'page_view');
    expect((pageViewCall![0] as Record<string, unknown>).user_id_hash).toBe('user123');

    destroySessionTracker();
  });
});
