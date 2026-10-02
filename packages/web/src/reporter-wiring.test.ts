/**
 * The widget's reporter surfaces on the real SDK: the v2 routes when the
 * server has them, the older routes when it doesn't, and opt-in controls only
 * for channels both the host and the project turned on (Plan 018 §2.3, §4.1).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MushiConfig } from '@mushi-mushi/core';
import { Mushi } from './mushi';

const PID = '00000000-0000-0000-0000-0000000000b7';
const BASE: MushiConfig = { projectId: PID, apiKey: 'mushi_test_key_abcdefghijklmnop', runtimeConfig: false };
const ROW = { id: 'r1', status: 'classified', title: 'Save does nothing', unread_count: 1, created_at: '2026-10-01T00:00:00Z' };

type Reply = { status?: number; data?: unknown };
function stubFetch(routes: Record<string, () => Reply>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = new URL(String(input instanceof Request ? input.url : input)).pathname;
    const key = Object.keys(routes).find((k) => k.startsWith(`${method} `) && path.endsWith(k.slice(method.length + 1)));
    const { status = 200, data = {} } = key ? routes[key]() : {};
    return new Response(JSON.stringify(status < 400 ? { ok: true, data } : { error: { code: 'NOT_FOUND' } }), { status });
  });
}
const hits = (spy: ReturnType<typeof stubFetch>, method: string, suffix: string) =>
  spy.mock.calls.filter(([input, init]) => (init?.method ?? 'GET').toUpperCase() === method
    && new URL(String(input instanceof Request ? input.url : input)).pathname.endsWith(suffix)).length;
const shadow = () => document.querySelector('#mushi-mushi-widget')!.shadowRoot!;
const q = <T extends Element = HTMLElement>(sel: string) => shadow().querySelector(sel) as T | null;

describe('reporter surfaces on the SDK', () => {
  beforeEach(() => {
    try { Mushi.destroy(); } catch { /* none */ }
    localStorage.clear();
    sessionStorage.clear();
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

  async function openThread() {
    const sdk = Mushi.init(BASE);
    sdk.openMyReports();
    await vi.waitFor(() => expect(q('[data-report-id="r1"]')).not.toBeNull());
    q<HTMLButtonElement>('[data-report-id="r1"]')!.click();
  }

  it('uses the v2 detail and read routes when the server has them', async () => {
    const spy = stubFetch({
      'GET /v1/reporter/reports': () => ({ data: { reports: [ROW] } }),
      'GET /v1/reporter/reports/r1': () => ({ data: { report: ROW, timeline: [{ kind: 'received', at: ROW.created_at, text: 'You reported this' }], can_verify: false } }),
      'POST /v1/reporter/reports/r1/read': () => ({ data: { marked_read: 1, unread_total: 0 } }),
    });
    await openThread();
    await vi.waitFor(() => expect(q('.mushi-timeline')?.textContent).toContain('You reported this'));
    await vi.waitFor(() => expect(hits(spy, 'POST', '/v1/reporter/reports/r1/read')).toBe(1));
    expect(hits(spy, 'GET', '/v1/reporter/reports/r1/comments')).toBe(0);
    expect(hits(spy, 'GET', '/v1/notifications')).toBe(0);
  });

  it('falls back to the comments and notification routes on an older server', async () => {
    const spy = stubFetch({
      'GET /v1/reporter/reports': () => ({ data: { reports: [ROW] } }),
      'GET /v1/reporter/reports/r1': () => ({ status: 404 }),
      'POST /v1/reporter/reports/r1/read': () => ({ status: 404 }),
      'GET /v1/reporter/reports/r1/comments': () => ({ data: { comments: [{ id: 1, author_kind: 'admin', body: 'Which browser?', created_at: '2026-10-01T01:00:00Z' }] } }),
      'GET /v1/notifications': () => ({ data: { notifications: [{ id: 'n1', read_at: null, payload: { reportId: 'r1' } }, { id: 'n2', read_at: null, payload: { reportId: 'other' } }] } }),
    });
    await openThread();
    await vi.waitFor(() => expect(q('.mushi-thread')?.textContent).toContain('Which browser?'));
    await vi.waitFor(() => expect(hits(spy, 'POST', '/v1/notifications/n1/read')).toBe(1));
    expect(hits(spy, 'POST', '/v1/notifications/n2/read')).toBe(0);
  });

  it('offers email and push only for channels the project offers and the host allows', async () => {
    const spy = stubFetch({
      'GET /v1/sdk/config': () => ({ data: { version: 7, reporter: { emailEnabled: true, pushEnabled: true, vapidPublicKey: 'BPub' } } }),
      'POST /v1/reports': () => ({ data: { reportId: 'abc12345-0000-0000-0000-000000000000' } }),
    });
    const fill = async (config: MushiConfig) => {
      try { Mushi.destroy(); } catch { /* none */ }
      const sdk = Mushi.init(config);
      sdk.open();
      const ta = q<HTMLTextAreaElement>('textarea.mushi-textarea')!;
      ta.value = 'The export button does nothing';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      q<HTMLButtonElement>('[data-action="submit"]')!.click();
      await vi.waitFor(() => expect(q('.mushi-success')).not.toBeNull(), { timeout: 4000 });
    };

    // Project offers both; host enables push with a service worker.
    await fill({ ...BASE, runtimeConfig: true, notifications: { webPush: { serviceWorkerPath: '/sw.js' } } });
    await vi.waitFor(() => expect(q('[data-action="email-optin"]')).not.toBeNull());
    expect(q<HTMLInputElement>('[data-action="email-optin"]')!.checked).toBe(false);
    expect(q('[data-action="notify-me"]')).not.toBeNull();

    // Host turns email off and gives no service worker: neither control.
    await fill({ ...BASE, runtimeConfig: true, notifications: { email: false } });
    // The second instance has read the project's offer before we check.
    await vi.waitFor(() => expect(hits(spy, 'GET', '/v1/sdk/config')).toBeGreaterThanOrEqual(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(q('[data-action="email-optin"]')).toBeNull();
    expect(q('[data-action="notify-me"]')).toBeNull();
  });
});
