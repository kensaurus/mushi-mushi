/**
 * FILE: packages/web/src/mushi-analytics-consent.test.ts
 * PURPOSE: End-to-end (Mushi.init → trackers → wire) check that identify()
 *          and session tracking honour the same privacy gate as track():
 *          consent 'required', a stored denial, Do Not Track and bots.
 *          Before this, both went out regardless, with the host's email and
 *          name attached to the identify call.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mushi } from './mushi';
import { flushEvents, type MushiConfig } from '@mushi-mushi/core';

const CONFIG: MushiConfig = {
  projectId: '00000000-0000-0000-0000-000000000077',
  apiKey: 'mushi_test_key_abcdefghijklmnop',
  runtimeConfig: false,
};

function destroyQuietly(): void {
  try {
    Mushi.destroy();
  } catch {
    /* no instance */
  }
}

function setNavigator(prop: 'doNotTrack' | 'webdriver', value: unknown): void {
  Object.defineProperty(navigator, prop, { value, configurable: true });
}

function callsTo(spy: ReturnType<typeof vi.fn>, path: string): Array<Record<string, unknown>> {
  return spy.mock.calls
    .filter(([input]) => (typeof input === 'string' ? input : (input as Request).url).includes(path))
    .map(([, init]) => {
      const raw = (init as RequestInit | undefined)?.body;
      return typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : {};
    });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe('analytics consent reaches identify() and sessions', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    destroyQuietly();
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    });
    fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { accepted: 1, dropped: 0 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    destroyQuietly();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setNavigator('doNotTrack', undefined);
    setNavigator('webdriver', false);
  });

  it("sends no session and no identify under consent 'required' until setConsent('granted')", async () => {
    const sdk = Mushi.init({ ...CONFIG, analytics: { consent: 'required' } });
    sdk.identify('user-1', { email: 'person@example.com', name: 'Person' });
    sdk.track('checkout_started');
    await settle();
    await flushEvents();
    expect(callsTo(fetchSpy, '/v1/sdk/session')).toHaveLength(0);
    expect(callsTo(fetchSpy, '/v1/sdk/events')).toHaveLength(0);

    sdk.setConsent('granted');
    await settle();
    await flushEvents();
    const sessions = callsTo(fetchSpy, '/v1/sdk/session');
    expect(sessions.map((s) => s.kind)).toEqual(['session_start']);
    const events = callsTo(fetchSpy, '/v1/sdk/events');
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.user_id).toBe('user-1');
    const names = events.flatMap((e) => (e.events as Array<{ name: string }>).map((ev) => ev.name));
    expect(names).toEqual(expect.arrayContaining(['identify', 'checkout_started']));
  });

  it('sends nothing at all after a stored denial, including identify', async () => {
    localStorage.setItem(`mushi_events_consent_${CONFIG.projectId}`, 'denied');
    const sdk = Mushi.init(CONFIG);
    sdk.identify('user-1', { email: 'person@example.com' });
    await settle();
    await flushEvents();
    expect(callsTo(fetchSpy, '/v1/sdk/session')).toHaveLength(0);
    expect(callsTo(fetchSpy, '/v1/sdk/events')).toHaveLength(0);
  });

  it('sends nothing under Do Not Track, and nothing from a WebDriver-controlled browser', async () => {
    for (const prop of ['doNotTrack', 'webdriver'] as const) {
      setNavigator(prop, prop === 'doNotTrack' ? '1' : true);
      const sdk = Mushi.init(CONFIG);
      sdk.identify('user-1', { email: 'person@example.com' });
      sdk.track('checkout_started');
      await settle();
      await flushEvents();
      expect(callsTo(fetchSpy, '/v1/sdk/session')).toHaveLength(0);
      expect(callsTo(fetchSpy, '/v1/sdk/events')).toHaveLength(0);
      destroyQuietly();
      setNavigator('doNotTrack', undefined);
      setNavigator('webdriver', false);
    }
  });

  it('trackSessions:false is a typed, known option: no session calls and no unknown-key error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    Mushi.init({ ...CONFIG, trackSessions: false });
    await settle();
    expect(callsTo(fetchSpy, '/v1/sdk/session')).toHaveLength(0);
    expect(consoleError.mock.calls.some((args) => String(args[0]).includes('trackSessions'))).toBe(false);
  });

  it('starts a session immediately under implied consent', async () => {
    Mushi.init(CONFIG);
    await settle();
    expect(callsTo(fetchSpy, '/v1/sdk/session').map((s) => s.kind)).toEqual(['session_start']);
  });
});
