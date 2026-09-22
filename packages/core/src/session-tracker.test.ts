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

// ─── Privacy gate (shared with the event tracker) ───────────────────────────

type Kinded = { kind: string; route?: string | null; referrer?: string | null };

function kinds(client: MushiApiClient): string[] {
  return (client.postSessionEvent as ReturnType<typeof vi.fn>).mock.calls.map(([p]: [Kinded]) => p.kind);
}

function setNavigator(prop: 'webdriver' | 'doNotTrack' | 'globalPrivacyControl', value: unknown) {
  Object.defineProperty(navigator, prop, { value, configurable: true });
}

// session-tracker and event-tracker must share one analytics-gate instance,
// exactly as they do in the SDK bundle, so import both after one reset.
async function freshTrackers() {
  vi.resetModules();
  const session = await import('./session-tracker');
  const events = await import('./event-tracker');
  return { session, events };
}

describe('session tracker privacy gate', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setNavigator('webdriver', false);
    setNavigator('doNotTrack', undefined);
    setNavigator('globalPrivacyControl', undefined);
  });

  it("sends nothing under consent 'required' until setConsent('granted'), even when it starts first", async () => {
    const { session, events } = await freshTrackers();
    const client = makeMockClient();
    const analytics = { consent: 'required' as const };

    // Same order as Mushi.init(): the session tracker initialises before the event tracker.
    session.initSessionTracker({ client, projectId: 'p1', analytics });
    events.initEventTracker({ client, projectId: 'p1', anonId: 'anon-1', config: analytics });
    history.pushState({}, '', '/pricing');
    vi.advanceTimersByTime(61_000);
    expect(client.postSessionEvent).not.toHaveBeenCalled();

    events.setEventConsent('granted');
    expect(kinds(client)).toEqual(['session_start']);
    vi.advanceTimersByTime(61_000);
    expect(kinds(client)).toContain('session_heartbeat');

    session.destroySessionTracker();
    events.destroyEventTracker();
  });

  it('stops mid-page when consent is denied', async () => {
    const { session, events } = await freshTrackers();
    const client = makeMockClient();
    session.initSessionTracker({ client, projectId: 'p1' });
    events.initEventTracker({ client, projectId: 'p1', anonId: 'anon-1' });
    expect(kinds(client)).toEqual(['session_start']);

    events.setEventConsent('denied');
    history.pushState({}, '', '/after-denial');
    session.trackPageView('/manual');
    vi.advanceTimersByTime(180_000);
    window.dispatchEvent(new Event('pagehide'));
    expect(kinds(client)).toEqual(['session_start']);

    session.destroySessionTracker();
    events.destroyEventTracker();
  });

  it('honours a stored denial from an earlier visit', async () => {
    localStorage.setItem('mushi_events_consent_p1', 'denied');
    const { session } = await freshTrackers();
    const client = makeMockClient();
    session.initSessionTracker({ client, projectId: 'p1' });
    vi.advanceTimersByTime(61_000);
    expect(client.postSessionEvent).not.toHaveBeenCalled();
    session.destroySessionTracker();
  });

  it('is inert under Do Not Track, Global Privacy Control, analytics.enabled:false and automation', async () => {
    const setups: Array<{ apply: () => void; analytics?: { enabled?: boolean } }> = [
      { apply: () => setNavigator('doNotTrack', '1') },
      { apply: () => setNavigator('globalPrivacyControl', true) },
      { apply: () => undefined, analytics: { enabled: false } },
      { apply: () => setNavigator('webdriver', true) },
    ];
    for (const { apply, analytics } of setups) {
      apply();
      const { session } = await freshTrackers();
      const client = makeMockClient();
      session.initSessionTracker({ client, projectId: 'p1', analytics });
      session.trackPageView('/x');
      vi.advanceTimersByTime(61_000);
      expect(client.postSessionEvent).not.toHaveBeenCalled();
      session.destroySessionTracker();
      setNavigator('doNotTrack', undefined);
      setNavigator('globalPrivacyControl', undefined);
      setNavigator('webdriver', false);
    }
  });

  it('sends the pathname without the query string and only the referrer origin', async () => {
    history.replaceState({}, '', '/reset?token=secret&email=a@b.c');
    Object.defineProperty(document, 'referrer', {
      value: 'https://mail.example.com/inbox?msg=123',
      configurable: true,
    });
    const { session } = await freshTrackers();
    const client = makeMockClient();
    session.initSessionTracker({ client, projectId: 'p1' });
    const [start] = (client.postSessionEvent as ReturnType<typeof vi.fn>).mock.calls[0] as [Kinded];
    expect(start.route).toBe('/reset');
    expect(start.referrer).toBe('https://mail.example.com');
    session.destroySessionTracker();
    Object.defineProperty(document, 'referrer', { value: '', configurable: true });
    history.replaceState({}, '', '/');
  });

  it('records a page_view for pushState navigation but not for replaceState', async () => {
    const { session } = await freshTrackers();
    const client = makeMockClient();
    session.initSessionTracker({ client, projectId: 'p1' });
    history.pushState({}, '', '/docs?q=1');
    history.replaceState({}, '', '/docs#top');
    const calls = (client.postSessionEvent as ReturnType<typeof vi.fn>).mock.calls.map(([p]: [Kinded]) => p);
    const views = calls.filter((p) => p.kind === 'page_view');
    expect(views).toHaveLength(1);
    expect(views[0].route).toBe('/docs');
    session.destroySessionTracker();
    history.replaceState({}, '', '/');
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
