import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mushi } from './mushi';
import type { MushiConfig } from '@mushi-mushi/core';

const CONFIG: MushiConfig = {
  projectId: '00000000-0000-0000-0000-000000000001',
  apiKey: 'mushi_test_key_abcdefghijklmnop',
  runtimeConfig: false,
};

type Route = (url: string, init: RequestInit) => unknown;

/** fetch stub answering by `METHOD path`; anything else gets an empty envelope. */
function stubFetch(routes: Record<string, Route>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = new URL(url).pathname;
    const hit = Object.keys(routes).find((k) => k.startsWith(`${method} `) && path.endsWith(k.slice(method.length + 1)));
    const data = hit ? routes[hit](url, init ?? {}) : {};
    return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
  });
}

function calls(spy: ReturnType<typeof stubFetch>, key: string) {
  const [method, path] = key.split(' ');
  return spy.mock.calls.filter(([input, init]) => (init?.method ?? 'GET').toUpperCase() === method && new URL(String(input)).pathname.endsWith(path));
}

describe('reporter channels on the Mushi instance', () => {
  beforeEach(() => {
    try { Mushi.destroy(); } catch { /* none */ }
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    try { Mushi.destroy(); } catch { /* none */ }
  });

  it('onReporterUpdate hands the host the unread count, and unsubscribes', async () => {
    const updates = { unread_total: 2, latest: [{ report_id: 'r1', kind: 'comment', preview: 'Developer replied', at: '2026-10-02T00:00:00Z' }], server_time: 'x' };
    stubFetch({ 'GET /v1/reporter/updates': () => updates });
    const sdk = Mushi.init(CONFIG);
    const cb = vi.fn();
    const off = sdk.onReporterUpdate(cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalledWith(updates));
    off();
    cb.mockClear();
    await sdk.getReporterUpdates();
    expect(cb).not.toHaveBeenCalled();
  });

  it('a host callback that throws does not break the SDK', async () => {
    stubFetch({ 'GET /v1/reporter/updates': () => ({ unread_total: 1, latest: [], server_time: 'x' }) });
    const sdk = Mushi.init(CONFIG);
    sdk.onReporterUpdate(() => { throw new Error('host bug'); });
    await expect(sdk.getReporterUpdates()).resolves.toMatchObject({ unread_total: 1 });
  });

  it('markReportRead resolves the new unread total', async () => {
    const spy = stubFetch({ 'POST /v1/reporter/reports/r1/read': () => ({ marked_read: 2, unread_total: 3 }) });
    const sdk = Mushi.init(CONFIG);
    await expect(sdk.markReportRead('r1')).resolves.toBe(3);
    expect(calls(spy, 'POST /v1/reporter/reports/r1/read')).toHaveLength(1);
  });

  it('setNotificationPrefs sends exactly what the host asked for (never an implied opt-in)', async () => {
    const spy = stubFetch({ 'PUT /v1/reporter/notification-prefs': () => ({ email: 're***@example.com', email_pending: true }) });
    const sdk = Mushi.init(CONFIG);
    const res = await sdk.setNotificationPrefs({ email: 'reporter@example.com' });
    expect(res).toMatchObject({ ok: true, data: { email_pending: true } });
    const [, init] = calls(spy, 'PUT /v1/reporter/notification-prefs')[0];
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'reporter@example.com' });
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-Reporter-Token-Hash']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('subscribeReporterPush refuses without a host service worker, and asks for no permission', async () => {
    const requestPermission = vi.fn();
    vi.stubGlobal('Notification', { requestPermission });
    stubFetch({});
    const sdk = Mushi.init(CONFIG);
    await expect(sdk.subscribeReporterPush()).resolves.toEqual({ ok: false, reason: 'unsupported' });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('subscribeReporterPush does not prompt when the project does not offer push', async () => {
    const requestPermission = vi.fn(async () => 'granted');
    vi.stubGlobal('Notification', { requestPermission });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register: vi.fn() } });
    stubFetch({ 'GET /v1/sdk/config': () => ({ reporter: { emailEnabled: false, pushEnabled: false, vapidPublicKey: null } }) });
    const sdk = Mushi.init({ ...CONFIG, notifications: { webPush: { serviceWorkerPath: '/sw.js' } } });
    await expect(sdk.subscribeReporterPush()).resolves.toEqual({ ok: false, reason: 'not_available' });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('subscribeReporterPush registers the host worker and stores the subscription', async () => {
    const requestPermission = vi.fn(async () => 'granted');
    vi.stubGlobal('Notification', { requestPermission });
    const subscribe = vi.fn(async () => ({
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } }),
    }));
    const register = vi.fn(async () => ({ pushManager: { subscribe } }));
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
    const spy = stubFetch({
      'GET /v1/sdk/config': () => ({ reporter: { emailEnabled: false, pushEnabled: true, vapidPublicKey: 'BAAA' } }),
      'POST /v1/reporter/push-subscriptions': () => ({ subscribed: true }),
    });
    const sdk = Mushi.init({ ...CONFIG, notifications: { webPush: { serviceWorkerPath: '/sw.js' } } });
    await expect(sdk.subscribeReporterPush()).resolves.toEqual({ ok: true });
    expect(register).toHaveBeenCalledWith('/sw.js');
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    const [, init] = calls(spy, 'POST /v1/reporter/push-subscriptions')[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' });
  });
});
