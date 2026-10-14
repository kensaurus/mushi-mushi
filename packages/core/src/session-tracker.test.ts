import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MushiApiClient } from './types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMockClient(): MushiApiClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    postSessionEvent: vi.fn(async (payload) => {
      calls.push(payload);
      return { ok: true, data: { accepted: true } };
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

  it('a destroy → re-init on the same page sends one session_end per hide, not two', async () => {
    const { initSessionTracker, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();

    initSessionTracker({ client });
    destroySessionTracker();
    initSessionTracker({ client });
    window.dispatchEvent(new Event('pagehide'));

    const ends = (client.postSessionEvent as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([p]: [Record<string, unknown>]) => p.kind === 'session_end',
    );
    expect(ends).toHaveLength(1);

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

// No test covered the history patch before, which is how a comparison that
// was always false (`original === history.pushState` evaluated *inside* the
// wrapper) shipped and silently dropped every SPA page view.
describe('history patch (SPA page views)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function pageViews(client: MushiApiClient): Array<Record<string, unknown>> {
    return (client.postSessionEvent as ReturnType<typeof vi.fn>).mock.calls
      .map(([p]: [Record<string, unknown>]) => p)
      .filter((p) => p.kind === 'page_view');
  }

  it('emits page_view on history.pushState', async () => {
    const { initSessionTracker, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();

    initSessionTracker({ client });
    history.pushState({}, '', '/pushed');

    const views = pageViews(client);
    expect(views).toHaveLength(1);
    expect(views[0].route).toBe('/pushed');
    expect(views[0].page_view_count).toBe(2);

    destroySessionTracker();
  });

  it('does not emit page_view on history.replaceState', async () => {
    const { initSessionTracker, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();

    initSessionTracker({ client });
    history.replaceState({}, '', '/replaced');

    expect(pageViews(client)).toHaveLength(0);

    destroySessionTracker();
  });

  it('patchHistory:false leaves pushState untracked so a host can wire page views itself', async () => {
    const { initSessionTracker, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();

    initSessionTracker({ client, patchHistory: false });
    history.pushState({}, '', '/host-owned');

    expect(pageViews(client)).toHaveLength(0);

    destroySessionTracker();
  });
});

// ─── Cadence: how many POSTs a reading session costs ─────────────────────────
//
// The Wanting Mind audit (2026-10-15) saw about 10 POST /v1/sdk/session in one
// minute of reading. The web SDK reports every pushState / popstate as a page
// view (mushi.ts wires subscribeHistory → trackPageView()), and TWM's sheets
// push a history entry on open and go back on close, on the same pathname.
// The server strips query and hash, so those were duplicate page views of the
// route already being read. Tab switches added a session_end each, and
// heartbeats kept firing while the tab was hidden.

describe('session cadence while reading', () => {
  type Sent = { kind: string; ts: string; route?: string | null; page_view_count?: number };
  const sent = (client: MushiApiClient): Sent[] =>
    (client.postSessionEvent as ReturnType<typeof vi.fn>).mock.calls.map(([p]: [Sent]) => p);
  const byKind = (events: Sent[]) =>
    events.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {});

  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { value: state, writable: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'));
    history.replaceState({}, '', '/en/ch-1');
  });

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true });
    history.replaceState({}, '', '/');
    vi.useRealTimers();
  });

  /** One minute on a chapter: three sheets opened and closed, a footnote jump, one tab switch. */
  function readOneMinute(trackPageView: (route?: string) => void) {
    for (const sheet of ['toc', 'search', 'settings']) {
      vi.advanceTimersByTime(5_000);
      history.pushState({ sheet }, ''); // sheet opens: same pathname
      trackPageView();
      vi.advanceTimersByTime(5_000);
      trackPageView(); // closes via history.back(): popstate, same pathname
    }
    vi.advanceTimersByTime(5_000);
    history.pushState({}, '', '/en/ch-1#fn-3'); // footnote jump
    trackPageView();
    vi.advanceTimersByTime(5_000);
    setVisibility('hidden');
    vi.advanceTimersByTime(5_000);
    setVisibility('visible');
    vi.advanceTimersByTime(15_000); // t = 60s
  }

  it('one minute of reading costs at most 3 requests, not 10', async () => {
    const { initSessionTracker, trackPageView, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();
    initSessionTracker({ client, patchHistory: false });

    readOneMinute(trackPageView);

    // Before the fix this was { session_start: 1, page_view: 7, session_end: 1, session_heartbeat: 1 } = 10.
    expect(byKind(sent(client))).toEqual({ session_start: 1, session_end: 1 });
    destroySessionTracker();
  });

  it('ten idle minutes send one heartbeat a minute, so last_seen_at never lags by more than 60s', async () => {
    const { initSessionTracker, trackPageView, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();
    initSessionTracker({ client, patchHistory: false });

    readOneMinute(trackPageView);
    vi.advanceTimersByTime(9 * 60_000); // t = 10 min, tab visible throughout

    const events = sent(client);
    const visibleGaps = events
      .slice(1)
      .map((e, i) => ({ gap: Date.parse(e.ts) - Date.parse(events[i].ts), after: events[i].kind }))
      .filter((g) => g.after !== 'session_end'); // a hidden tab legitimately goes quiet
    expect(Math.max(...visibleGaps.map((g) => g.gap))).toBeLessThanOrEqual(60_000);
    expect(byKind(events).session_heartbeat).toBeLessThanOrEqual(10);
    destroySessionTracker();
  });

  it('a hidden tab sends no heartbeats, and one session_end however it is left', async () => {
    const { initSessionTracker, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();
    initSessionTracker({ client, patchHistory: false });

    setVisibility('hidden');
    vi.advanceTimersByTime(10 * 60_000);
    window.dispatchEvent(new Event('pagehide')); // closing a hidden tab

    expect(byKind(sent(client))).toEqual({ session_start: 1, session_end: 1 });
    destroySessionTracker();
  });

  it('a heartbeat follows 60s after the tab comes back, and the next hide ends the session again', async () => {
    const { initSessionTracker, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();
    initSessionTracker({ client, patchHistory: false });

    setVisibility('hidden');
    vi.advanceTimersByTime(120_000);
    setVisibility('visible');
    vi.advanceTimersByTime(60_000);
    setVisibility('hidden');

    // The server stores the latest session_end as ended_at, so the session's
    // duration runs to the last hide (09:03:00), not the first.
    const events = sent(client);
    expect(events.map((e) => e.kind)).toEqual(['session_start', 'session_end', 'session_heartbeat', 'session_end']);
    expect(events[3].ts).toBe('2026-10-15T09:03:00.000Z');
    destroySessionTracker();
  });

  it('still records every real route change, including a return to an earlier route', async () => {
    const { initSessionTracker, trackPageView, destroySessionTracker } = await freshTracker();
    const client = makeMockClient();
    initSessionTracker({ client, patchHistory: false });

    for (const route of ['/en/ch-2', '/en/ch-2', '/en/ch-1']) {
      history.pushState({}, '', route);
      trackPageView();
    }

    const views = sent(client).filter((e) => e.kind === 'page_view');
    expect(views.map((v) => [v.route, v.page_view_count])).toEqual([['/en/ch-2', 2], ['/en/ch-1', 3]]);
    destroySessionTracker();
  });
});
