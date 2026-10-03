import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApiClient } from './api-client';
import { reporterChannels } from './reporter-channels';

const opts = {
  projectId: 'proj_test',
  apiKey: 'mushi_test_key',
  apiEndpoint: 'https://api.test.local',
  timeout: 5000,
  maxRetries: 0,
};

function okFetch(data: unknown = {}) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ ok: true, data }), { status: 200 }),
  );
}

function call(spy: ReturnType<typeof okFetch>, i = 0) {
  const [url, init] = spy.mock.calls[i] as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  return { url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined, headers };
}

describe('reporterChannels', () => {
  afterEach(() => vi.restoreAllMocks());

  it('every call is a signed reporter request to the v2 route', async () => {
    const spy = okFetch();
    const rc = reporterChannels(createApiClient(opts));
    await rc.getUpdates('tok');
    await rc.getUpdates('tok', '2026-10-02T00:00:00Z');
    await rc.getReport('r/1', 'tok');
    await rc.markReportRead('r1', 'tok');
    await rc.markAllRead('tok');
    await rc.getPrefs('tok');
    await rc.setPrefs('tok', { email: 'a@b.co', channels: { email: true } });
    await rc.subscribePush('tok', { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } });
    await rc.unsubscribePush('tok', 'https://fcm.googleapis.com/x');

    const seen = spy.mock.calls.map((_, i) => {
      const c = call(spy, i);
      return `${c.method} ${c.url.replace('https://api.test.local', '')}`;
    });
    expect(seen).toEqual([
      'GET /v1/reporter/updates',
      'GET /v1/reporter/updates?since=2026-10-02T00%3A00%3A00Z',
      'GET /v1/reporter/reports/r%2F1',
      'POST /v1/reporter/reports/r1/read',
      'POST /v1/reporter/notifications/read-all',
      'GET /v1/reporter/notification-prefs',
      'PUT /v1/reporter/notification-prefs',
      'POST /v1/reporter/push-subscriptions',
      'DELETE /v1/reporter/push-subscriptions',
    ]);
    for (let i = 0; i < spy.mock.calls.length; i++) {
      const { headers } = call(spy, i);
      expect(headers['X-Reporter-Token-Hash']).toMatch(/^[0-9a-f]{64}$/);
      expect(headers['X-Reporter-Hmac']).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(call(spy, 6).body).toEqual({ email: 'a@b.co', channels: { email: true } });
    expect(call(spy, 8).body).toEqual({ endpoint: 'https://fcm.googleapis.com/x' });
  });

  it('a refused opt-in surfaces the server code instead of throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, error: { code: 'EMAIL_NOT_AVAILABLE', message: 'not set up', reason: 'not_configured' } }),
        { status: 409 },
      ),
    );
    const res = await reporterChannels(createApiClient(opts)).setPrefs('tok', { email: 'a@b.co' });
    expect(res).toMatchObject({ ok: false, error: { code: 'EMAIL_NOT_AVAILABLE', status: 409 } });
  });

  it('a network failure resolves ok:false', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(reporterChannels(createApiClient(opts)).getUpdates('tok')).resolves.toMatchObject({ ok: false });
  });
});
