import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOfflineQueue } from './queue';
import type { MushiApiClient, MushiApiResponse, MushiReport } from './types';

const LS_KEY = 'mushi_offline_queue';

function makeReport(id: string): MushiReport {
  return {
    id,
    projectId: 'proj-1',
    category: 'bug',
    description: 'A queued report used to exercise the offline queue give-up gates.',
    reporterToken: 'tok-1',
    environment: {
      url: 'http://localhost/app',
      userAgent: 'test',
      viewport: { width: 1, height: 1 },
      timestamp: new Date().toISOString(),
    },
  } as unknown as MushiReport;
}

/** Mock client whose submitReport returns a fixed, configurable result. */
function makeClient(result: MushiApiResponse<{ reportId: string }>): {
  client: MushiApiClient;
  calls: () => number;
} {
  let calls = 0;
  const client = {
    submitReport: async () => {
      calls += 1;
      return result;
    },
  } as unknown as MushiApiClient;
  return { client, calls: () => calls };
}

describe('offline queue give-up gates', () => {
  beforeEach(() => {
    // jsdom does not implement IndexedDB; force the localStorage backend so the
    // queue path under test is deterministic regardless of jsdom version.
    vi.stubGlobal('indexedDB', undefined);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('removes a report after a successful submit', async () => {
    const queue = createOfflineQueue({ encryptAtRest: false, syncOnReconnect: false });
    await queue.enqueue(makeReport('ok-1'));
    expect(await queue.size()).toBe(1);

    const { client, calls } = makeClient({ ok: true, data: { reportId: 'r1' } });
    const res = await queue.flush(client);

    expect(calls()).toBe(1);
    expect(res.sent).toBe(1);
    expect(await queue.size()).toBe(0);
  });

  it('drops a report immediately on a permanent (HTTP_400) failure', async () => {
    const queue = createOfflineQueue({ encryptAtRest: false, syncOnReconnect: false });
    await queue.enqueue(makeReport('perm-1'));

    const { client, calls } = makeClient({
      ok: false,
      error: { code: 'HTTP_400', message: 'bad request' },
    });
    await queue.flush(client);

    expect(calls()).toBe(1);
    expect(await queue.size()).toBe(0);
  });

  it('keeps a report on a transient failure but gives up after MAX_DELIVERY_ATTEMPTS', async () => {
    const queue = createOfflineQueue({ encryptAtRest: false, syncOnReconnect: false });
    await queue.enqueue(makeReport('net-1'));

    const { client, calls } = makeClient({
      ok: false,
      error: { code: 'NETWORK_ERROR', message: 'failed to fetch' },
    });

    // Flush repeatedly — far more than the give-up ceiling — and assert the
    // row is eventually dropped instead of looping forever.
    let sizeAfter = 1;
    for (let i = 0; i < 20 && sizeAfter > 0; i++) {
      await queue.flush(client);
      sizeAfter = await queue.size();
    }

    expect(sizeAfter).toBe(0);
    // The give-up ceiling bounds the number of network attempts (MAX = 8).
    expect(calls()).toBe(8);
  });

  it('persists the attempt counter across flushes (does not reset each tick)', async () => {
    const queue = createOfflineQueue({ encryptAtRest: false, syncOnReconnect: false });
    await queue.enqueue(makeReport('net-2'));

    const { client } = makeClient({
      ok: false,
      error: { code: 'NETWORK_ERROR', message: 'failed to fetch' },
    });

    await queue.flush(client);
    let raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as Array<{ attempts?: number }>;
    expect(raw[0]?.attempts).toBe(1);

    await queue.flush(client);
    raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as Array<{ attempts?: number }>;
    expect(raw[0]?.attempts).toBe(2);
  });

  it('evicts a stale row (older than max age) without attempting a network submit', async () => {
    const queue = createOfflineQueue({ encryptAtRest: false, syncOnReconnect: false });
    await queue.enqueue(makeReport('stale-1'));

    // Backdate the queued timestamp well beyond the 24h max age.
    const rows = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as Array<{ queuedAt: string }>;
    rows[0].queuedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(LS_KEY, JSON.stringify(rows));

    const { client, calls } = makeClient({ ok: true, data: { reportId: 'r2' } });
    await queue.flush(client);

    // Stale rows are swept before any network attempt is spent on them.
    expect(calls()).toBe(0);
    expect(await queue.size()).toBe(0);
  });
});
