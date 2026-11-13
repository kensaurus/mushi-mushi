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
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/v1/sdk/config')) {
      return new Response(JSON.stringify({ ok: true, data: { enabled: true, ...(journeys ? { journeys } : {}) } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
  });
}

const later = () => new Date(Date.now() + 3_600_000).toISOString();

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
