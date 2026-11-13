/**
 * `trackSessions: 'on-demand'` (Journey optimizer, ADR 0058): the session
 * tracker starts only when this tab opted in with ?mushi_journeys=1 or the
 * runtime config carries an open recording window that samples this device.
 * Otherwise a real visitor sends no session request at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as Core from '@mushi-mushi/core';
import type { MushiConfig } from '@mushi-mushi/core';

const initSessionTracker = vi.hoisted(() => vi.fn());
vi.mock('@mushi-mushi/core', async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  initSessionTracker,
}));

import { Mushi } from './mushi';

const PID = '00000000-0000-0000-0000-0000000000d1';
const BASE: MushiConfig = { projectId: PID, apiKey: 'mushi_test_key_abcdefghijklmnop', trackSessions: 'on-demand' };

function serveConfig(journeys?: { recordUntil: string; sampleRate: number }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/v1/sdk/config')) {
      return new Response(JSON.stringify({ ok: true, data: { enabled: true, ...(journeys ? { journeys } : {}) } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
  });
}

const later = () => new Date(Date.now() + 3_600_000).toISOString();

/**
 * The RequestInit of the last /v1/sdk/config fetch. Reads the spy, not
 * globalThis.fetch: the SDK's network capture wraps fetch after init.
 */
function fetchedConfig(spy: ReturnType<typeof serveConfig>): RequestInit | undefined {
  const calls = spy.mock.calls as Array<[RequestInfo | URL, RequestInit?]>;
  const hit = [...calls].reverse().find(([input]) => String(input instanceof Request ? input.url : input).includes('/v1/sdk/config'));
  return hit ? hit[1] ?? {} : undefined;
}

describe("trackSessions: 'on-demand'", () => {
  beforeEach(() => {
    try { Mushi.destroy(); } catch { /* none */ }
    initSessionTracker.mockClear();
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  });
  afterEach(() => {
    try { Mushi.destroy(); } catch { /* none */ }
    vi.restoreAllMocks();
  });

  it('starts nothing without a window or an opt-in', async () => {
    serveConfig();
    Mushi.init(BASE);
    await new Promise((r) => setTimeout(r, 20));
    expect(initSessionTracker).not.toHaveBeenCalled();
  });

  it('starts for a sampled device while the console window is open', async () => {
    localStorage.setItem(`mushi:journeys:draw:${PID}`, '0.05');
    serveConfig({ recordUntil: later(), sampleRate: 0.1 });
    Mushi.init(BASE);
    await vi.waitFor(() => expect(initSessionTracker).toHaveBeenCalledTimes(1));
  });

  it('ignores a window that only the cached config still has (the owner stopped it)', async () => {
    // Live test 2026-11-13: the cached config applied on load still held the
    // window, and recording started before the fresh config (no window) arrived.
    localStorage.setItem(`mushi:journeys:draw:${PID}`, '0.05');
    localStorage.setItem(`mushi:sdk-config:${PID}`, JSON.stringify({ cachedAt: Date.now(), config: { enabled: true, journeys: { recordUntil: later(), sampleRate: 1 } } }));
    serveConfig();
    Mushi.init(BASE);
    await new Promise((r) => setTimeout(r, 50));
    expect(initSessionTracker).not.toHaveBeenCalled();
  });

  it('reads the config past the HTTP cache on demand, and normally otherwise', async () => {
    // A cached response kept a stopped window alive for minutes (live test, 2026-11-13).
    const onDemand = serveConfig();
    Mushi.init(BASE);
    await vi.waitFor(() => expect(fetchedConfig(onDemand)).toBeDefined());
    expect(fetchedConfig(onDemand)?.cache).toBe('no-store');
    try { Mushi.destroy(); } catch { /* none */ }
    vi.restoreAllMocks();
    localStorage.clear();
    const standard = serveConfig();
    Mushi.init({ projectId: PID, apiKey: BASE.apiKey });
    await vi.waitFor(() => expect(fetchedConfig(standard)).toBeDefined());
    expect(fetchedConfig(standard)?.cache).toBeUndefined();
  });

  it('skips a device outside the sample', async () => {
    localStorage.setItem(`mushi:journeys:draw:${PID}`, '0.5');
    serveConfig({ recordUntil: later(), sampleRate: 0.1 });
    Mushi.init(BASE);
    await new Promise((r) => setTimeout(r, 20));
    expect(initSessionTracker).not.toHaveBeenCalled();
  });

  it('starts for a tab opened with ?mushi_journeys=1, even with runtime config off', async () => {
    window.history.replaceState(null, '', '/pricing?mushi_journeys=1');
    serveConfig();
    Mushi.init({ ...BASE, runtimeConfig: false });
    await vi.waitFor(() => expect(initSessionTracker).toHaveBeenCalledTimes(1));
  });

  it('never starts with trackSessions: false, opt-in or not', async () => {
    window.history.replaceState(null, '', '/pricing?mushi_journeys=1');
    serveConfig({ recordUntil: later(), sampleRate: 1 });
    Mushi.init({ ...BASE, trackSessions: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(initSessionTracker).not.toHaveBeenCalled();
  });

  it('still starts at once by default', () => {
    serveConfig();
    Mushi.init({ projectId: PID, apiKey: BASE.apiKey, runtimeConfig: false });
    expect(initSessionTracker).toHaveBeenCalledTimes(1);
  });
});
