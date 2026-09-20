import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MushiApiClient, MushiProductEventPayload } from './types';
import {
  EVENT_PROPERTY_LIMITS,
  MUSHI_EVENTS,
  MUSHI_EVENT_NAMES,
  ACTIVATION_EVENT,
  isValidEventName,
  sanitizeEventProperties,
} from './analytics-taxonomy';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Mock = ReturnType<typeof vi.fn>;

function makeMockClient(ok = true): MushiApiClient & { payloads: MushiProductEventPayload[] } {
  const payloads: MushiProductEventPayload[] = [];
  return {
    payloads,
    postProductEvents: vi.fn(async (payload: MushiProductEventPayload) => {
      payloads.push(payload);
      return ok
        ? { ok: true, data: { accepted: payload.events.length, dropped: 0 } }
        : { ok: false, error: { code: 'DOWN', message: 'nope' } };
    }),
  } as unknown as MushiApiClient & { payloads: MushiProductEventPayload[] };
}

// event-tracker keeps module-level singletons; re-import per test.
async function freshTracker() {
  vi.resetModules();
  return import('./event-tracker');
}

function setDnt(value: string | undefined) {
  Object.defineProperty(navigator, 'doNotTrack', { value, configurable: true });
}

// ─── Taxonomy ────────────────────────────────────────────────────────────────

describe('analytics-taxonomy', () => {
  it('every event name in MUSHI_EVENTS passes the name regex', () => {
    for (const name of MUSHI_EVENT_NAMES) expect(isValidEventName(name)).toBe(true);
    expect(MUSHI_EVENT_NAMES.length).toBeGreaterThan(15);
    expect(ACTIVATION_EVENT in MUSHI_EVENTS).toBe(true);
  });

  it('rejects bad names', () => {
    expect(isValidEventName('Bad Name')).toBe(false);
    expect(isValidEventName('1starts_with_digit')).toBe(false);
    expect(isValidEventName('a')).toBe(false);
    expect(isValidEventName('$pageview')).toBe(false);
    expect(isValidEventName('checkout_started')).toBe(true);
  });

  it('sanitizes properties: PII keys, reserved keys, nesting, length', () => {
    const { properties, dropped } = sanitizeEventProperties({
      plan: 'pro',
      email: 'a@b.c',
      $surface: 'web',
      nested: { a: 1 },
      long: 'x'.repeat(1000),
      n: 3,
      nan: Number.NaN,
      when: new Date('2026-09-20T00:00:00Z'),
    });
    expect(properties.plan).toBe('pro');
    expect(properties.email).toBeUndefined();
    expect(properties.$surface).toBeUndefined();
    expect(properties.nested).toBeUndefined();
    expect((properties.long as string).length).toBe(EVENT_PROPERTY_LIMITS.maxValueLength);
    expect(properties.n).toBe(3);
    expect(properties.nan).toBeNull();
    expect(properties.when).toBe('2026-09-20T00:00:00.000Z');
    expect(dropped).toEqual(expect.arrayContaining(['email', '$surface', 'nested']));
  });

  it('lets allowlisted PII-looking keys and reserved keys through when asked', () => {
    const { properties } = sanitizeEventProperties(
      { email_domain: 'example.com', $utm_source: 'hn' },
      { allowlist: ['email_domain'], allowReserved: true },
    );
    expect(properties.email_domain).toBe('example.com');
    expect(properties.$utm_source).toBe('hn');
  });
});

// ─── Tracker ─────────────────────────────────────────────────────────────────

describe('event-tracker', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setDnt(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setDnt(undefined);
  });

  it('queues an event and flushes on the interval with surface, route and anon id', async () => {
    const { initEventTracker, trackEvent, destroyEventTracker, isEventTrackingActive } = await freshTracker();
    const client = makeMockClient();
    initEventTracker({ client, projectId: 'p1', anonId: 'anon-1', sdkVersion: '1.28.0' });
    expect(isEventTrackingActive()).toBe(true);

    expect(trackEvent('checkout_started', { plan: 'pro' })).toBe(true);
    expect(client.postProductEvents).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.postProductEvents).toHaveBeenCalledTimes(1);
    const payload = client.payloads[0];
    expect(payload.anon_id).toBe('anon-1');
    expect(payload.sdk_version).toBe('1.28.0');
    expect(payload.surface).toBe('web');
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0].name).toBe('checkout_started');
    expect(payload.events[0].properties?.plan).toBe('pro');
    expect(payload.events[0].properties?.$surface).toBe('web');
    expect(typeof payload.events[0].properties?.$route).toBe('string');
    destroyEventTracker();
  });

  it('flushes immediately once the client batch cap is reached', async () => {
    const { initEventTracker, trackEvent, destroyEventTracker } = await freshTracker();
    const client = makeMockClient();
    initEventTracker({ client, projectId: 'p1', anonId: 'anon-1' });
    for (let i = 0; i < EVENT_PROPERTY_LIMITS.maxClientBatch; i += 1) trackEvent('step_done', { i });
    expect(client.postProductEvents).toHaveBeenCalledTimes(1);
    expect(client.payloads[0].events).toHaveLength(EVENT_PROPERTY_LIMITS.maxClientBatch);
    destroyEventTracker();
  });

  it('drops invalid names and PII-looking property keys', async () => {
    const { initEventTracker, trackEvent, destroyEventTracker } = await freshTracker();
    const client = makeMockClient();
    initEventTracker({ client, projectId: 'p1', anonId: 'anon-1' });
    expect(trackEvent('Bad Name')).toBe(false);
    expect(trackEvent('signup_completed', { email: 'a@b.c', signup_source: 'hn' })).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    const props = client.payloads[0].events[0].properties ?? {};
    expect(props.signup_source).toBe('hn');
    expect(props.email).toBeUndefined();
    destroyEventTracker();
  });

  it('attaches reserved properties via opts.reserved', async () => {
    const { initEventTracker, trackEvent, destroyEventTracker } = await freshTracker();
    const client = makeMockClient();
    initEventTracker({ client, projectId: 'p1', anonId: 'anon-1', config: { surface: 'docs' } });
    trackEvent('landing_view', undefined, { reserved: { $utm_source: 'hn', $referrer: 'https://news.ycombinator.com/' } });
    await vi.advanceTimersByTimeAsync(5_000);
    const props = client.payloads[0].events[0].properties ?? {};
    expect(props.$utm_source).toBe('hn');
    expect(props.$surface).toBe('docs');
    expect(client.payloads[0].surface).toBe('docs');
    destroyEventTracker();
  });

  it('is inert under Do Not Track', async () => {
    setDnt('1');
    const { initEventTracker, trackEvent, isEventTrackingActive, getEventAnonymousId } = await freshTracker();
    const client = makeMockClient();
    initEventTracker({ client, projectId: 'p1', anonId: 'anon-1' });
    expect(isEventTrackingActive()).toBe(false);
    expect(getEventAnonymousId()).toBeNull();
    expect(trackEvent('landing_view')).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.postProductEvents).not.toHaveBeenCalled();
  });

  it('honours enabled:false and sampleRate:0', async () => {
    const mod = await freshTracker();
    const client = makeMockClient();
    mod.initEventTracker({ client, projectId: 'p1', anonId: 'anon-1', config: { enabled: false } });
    expect(mod.trackEvent('landing_view')).toBe(false);
    mod.destroyEventTracker();

    const mod2 = await freshTracker();
    mod2.initEventTracker({ client, projectId: 'p1', anonId: 'anon-1', config: { sampleRate: 0 } });
    expect(mod2.trackEvent('landing_view')).toBe(false);
    expect(mod2.isEventTrackingActive()).toBe(false);
    mod2.destroyEventTracker();
  });

  it('buffers under consent:required and releases on grant', async () => {
    const { initEventTracker, trackEvent, setEventConsent, destroyEventTracker, isEventTrackingActive } = await freshTracker();
    const client = makeMockClient();
    initEventTracker({ client, projectId: 'p1', anonId: 'anon-1', config: { consent: 'required' } });
    expect(isEventTrackingActive()).toBe(false);
    expect(trackEvent('landing_view')).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.postProductEvents).not.toHaveBeenCalled();

    setEventConsent('granted');
    await vi.advanceTimersByTimeAsync(0);
    expect(client.postProductEvents).toHaveBeenCalledTimes(1);
    expect(client.payloads[0].events[0].name).toBe('landing_view');
    expect(localStorage.getItem('mushi_events_consent_p1')).toBe('granted');
    destroyEventTracker();
  });

  it('drops everything after consent is denied and remembers it', async () => {
    const mod = await freshTracker();
    const client = makeMockClient();
    mod.initEventTracker({ client, projectId: 'p1', anonId: 'anon-1' });
    mod.setEventConsent('denied');
    expect(mod.trackEvent('landing_view')).toBe(true); // accepted by validation, dropped by consent
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.postProductEvents).not.toHaveBeenCalled();
    mod.destroyEventTracker();

    const mod2 = await freshTracker();
    mod2.initEventTracker({ client, projectId: 'p1', anonId: 'anon-1' });
    expect(mod2.isEventTrackingActive()).toBe(false);
    mod2.destroyEventTracker();
  });

  it('identify() sends an identify pseudo-event carrying user_id and traits', async () => {
    const { initEventTracker, updateEventIdentity, destroyEventTracker } = await freshTracker();
    const client = makeMockClient();
    initEventTracker({ client, projectId: 'p1', anonId: 'anon-1' });
    updateEventIdentity('user-1', { plan: 'pro' });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.postProductEvents).toHaveBeenCalledTimes(1);
    expect(client.payloads[0].user_id).toBe('user-1');
    expect(client.payloads[0].user_traits).toEqual({ plan: 'pro' });
    expect(client.payloads[0].events[0].name).toBe('identify');
    destroyEventTracker();
  });

  it('spills an unsent batch to localStorage and replays it on the next init', async () => {
    const mod = await freshTracker();
    const failing = makeMockClient(false);
    mod.initEventTracker({ client: failing, projectId: 'p1', anonId: 'anon-1' });
    mod.trackEvent('cta_click', { cta_id: 'landing-hero', location: 'hero' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(failing.postProductEvents).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('mushi_events_spill_p1')).toContain('cta_click');
    mod.destroyEventTracker();

    const mod2 = await freshTracker();
    const healthy = makeMockClient(true);
    mod2.initEventTracker({ client: healthy, projectId: 'p1', anonId: 'anon-1' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(healthy.postProductEvents).toHaveBeenCalledTimes(1);
    expect(healthy.payloads[0].events.map((e) => e.name)).toContain('cta_click');
    expect(localStorage.getItem('mushi_events_spill_p1')).toBeNull();
    mod2.destroyEventTracker();
  });

  it('does not throw when the client rejects', async () => {
    const { initEventTracker, trackEvent, destroyEventTracker } = await freshTracker();
    const client = {
      postProductEvents: vi.fn(async () => { throw new Error('network'); }) as Mock,
    } as unknown as MushiApiClient;
    initEventTracker({ client, projectId: 'p1', anonId: 'anon-1' });
    trackEvent('landing_view');
    await expect(vi.advanceTimersByTimeAsync(5_000)).resolves.not.toThrow();
    expect(localStorage.getItem('mushi_events_spill_p1')).toContain('landing_view');
    destroyEventTracker();
  });
});
