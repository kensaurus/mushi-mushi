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

/**
 * A fake IndexedDB whose `open` always fails. Exercises the path where the
 * queue detects the IndexedDB backend but every call to it rejects, so reads
 * fall back to localStorage — the case where read and write used to disagree
 * about which store the row lives in.
 */
function stubFailingIndexedDb(): void {
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request: {
        result?: unknown;
        error: Error;
        onerror?: () => void;
        onsuccess?: () => void;
        onupgradeneeded?: () => void;
      } = { error: new Error('IndexedDB unavailable') };
      setTimeout(() => request.onerror?.(), 0);
      return request;
    },
  });
}

/** Seed a plaintext queue row straight into localStorage, bypassing enqueue. */
function seedLocalStorageRow(id: string): void {
  const row = { ...makeReport(id), queuedAt: new Date().toISOString() };
  localStorage.setItem(LS_KEY, JSON.stringify([row]));
}

describe('offline queue flush re-entrancy', () => {
  beforeEach(() => {
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

  it('coalesces concurrent flushes so each queued report is submitted once', async () => {
    const queue = createOfflineQueue({ encryptAtRest: false, syncOnReconnect: false });
    await queue.enqueue(makeReport('race-1'));
    await queue.enqueue(makeReport('race-2'));

    // Record every submitted id. The timer and visibility triggers can fire a
    // second flush while one is mid-pass; without a latch both passes read the
    // same rows and the report is delivered twice.
    const submitted: string[] = [];
    const client = {
      submitReport: async (report: MushiReport) => {
        submitted.push(report.id);
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { ok: true, data: { reportId: report.id } };
      },
    } as unknown as MushiApiClient;

    const [first, second] = await Promise.all([queue.flush(client), queue.flush(client)]);

    expect(submitted.filter((id) => id === 'race-1')).toHaveLength(1);
    expect(submitted.filter((id) => id === 'race-2')).toHaveLength(1);
    expect(submitted).toHaveLength(2);
    expect(first.sent + second.sent).toBe(2);
    expect(await queue.size()).toBe(0);
  });

  it('runs exactly one follow-up pass for callers that arrive mid-flush', async () => {
    const queue = createOfflineQueue({ encryptAtRest: false, syncOnReconnect: false });
    await queue.enqueue(makeReport('follow-1'));

    let submits = 0;
    let releaseFirst: (() => void) | null = null;
    const firstInFlight = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const client = {
      submitReport: async (report: MushiReport) => {
        submits += 1;
        if (submits === 1) await firstInFlight;
        return { ok: true, data: { reportId: report.id } };
      },
    } as unknown as MushiApiClient;

    const first = queue.flush(client);
    // Three callers pile up while the first pass is parked mid-submit; they
    // must share a single follow-up pass rather than each starting their own.
    const queued = [queue.flush(client), queue.flush(client), queue.flush(client)];
    releaseFirst?.();

    const results = await Promise.all([first, ...queued]);

    expect(submits).toBe(1);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(await queue.size()).toBe(0);
  });
});

describe('offline queue attempt-counter coverage', () => {
  beforeEach(() => {
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

  it('enforces MAX_DELIVERY_ATTEMPTS for an unclassified error code', async () => {
    const queue = createOfflineQueue({ encryptAtRest: false, syncOnReconnect: false });
    await queue.enqueue(makeReport('weird-1'));

    // Neither permanent nor a known-transient code — this used to skip the
    // attempt bump entirely and retry forever.
    const { client, calls } = makeClient({
      ok: false,
      error: { code: 'HTTP_418', message: 'teapot' },
    });

    let sizeAfter = 1;
    for (let i = 0; i < 20 && sizeAfter > 0; i++) {
      await queue.flush(client);
      sizeAfter = await queue.size();
    }

    expect(sizeAfter).toBe(0);
    expect(calls()).toBe(8);
  });

  it('bumps the attempt counter for an unclassified error code', async () => {
    const queue = createOfflineQueue({ encryptAtRest: false, syncOnReconnect: false });
    await queue.enqueue(makeReport('weird-2'));

    const { client } = makeClient({
      ok: false,
      error: { code: 'SOMETHING_UNRECOGNISED', message: 'no idea' },
    });

    await queue.flush(client);
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as Array<{ attempts?: number }>;
    expect(raw[0]?.attempts).toBe(1);
  });

  it('does not spend a delivery attempt when the circuit breaker fast-fails', async () => {
    const queue = createOfflineQueue({ encryptAtRest: false, syncOnReconnect: false });
    await queue.enqueue(makeReport('cb-1'));

    // A fast-failed request never reached the network, so charging it against
    // the give-up ceiling would discard reports with zero delivery attempts.
    const { client, calls } = makeClient({
      ok: false,
      error: { code: 'CIRCUIT_OPEN', message: 'Endpoint temporarily unavailable; retrying later.' },
    });

    for (let i = 0; i < 12; i++) {
      await queue.flush(client);
    }

    expect(await queue.size()).toBe(1);
    expect(calls()).toBe(12);
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as Array<{ attempts?: number }>;
    expect(raw[0]?.attempts ?? 0).toBe(0);
  });

  it('stops the batch at the first circuit-breaker fast-fail', async () => {
    const queue = createOfflineQueue({ encryptAtRest: false, syncOnReconnect: false });
    await queue.enqueue(makeReport('cb-batch-1'));
    await queue.enqueue(makeReport('cb-batch-2'));
    await queue.enqueue(makeReport('cb-batch-3'));

    const { client, calls } = makeClient({
      ok: false,
      error: { code: 'CIRCUIT_OPEN', message: 'Endpoint temporarily unavailable; retrying later.' },
    });
    await queue.flush(client);

    // The circuit is open for every row in the batch — walking the rest just
    // burns backoff sleeps against a known-down endpoint.
    expect(calls()).toBe(1);
    expect(await queue.size()).toBe(3);
  });
});

describe('offline queue backend consistency', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('drops the report silently when there is no storage backend', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Nothing can be stored here. Routing the row through the localStorage
    // path anyway means at-rest encryption fails (it needs IndexedDB for the
    // key) and warns on every single enqueue — console noise in exactly the
    // environments that can least afford it. encryptAtRest defaults on, so
    // this asserts the default config.
    const queue = createOfflineQueue({ syncOnReconnect: false });
    await queue.enqueue(makeReport('nowhere-1'));
    await queue.enqueue(makeReport('nowhere-2'));

    expect(warnSpy).not.toHaveBeenCalled();
    expect(await queue.size()).toBe(0);

    const { client, calls } = makeClient({ ok: true, data: { reportId: 'r-none' } });
    expect(await queue.flush(client)).toEqual({ sent: 0, failed: 0 });
    expect(calls()).toBe(0);
  });

  it('deletes from the store the rows were actually read from', async () => {
    // The row lives in localStorage while IndexedDB is the detected backend
    // and every IndexedDB call fails. The read falls back to localStorage, so
    // the delete has to follow it there or the row is orphaned.
    seedLocalStorageRow('orphan-1');
    stubFailingIndexedDb();

    const queue = createOfflineQueue({ encryptAtRest: false, syncOnReconnect: false });
    const { client, calls } = makeClient({ ok: true, data: { reportId: 'r-orphan' } });
    const res = await queue.flush(client);

    expect(calls()).toBe(1);
    expect(res.sent).toBe(1);
    expect(JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')).toHaveLength(0);
    expect(await queue.size()).toBe(0);
  });

  it('upserts by report id so a re-enqueued report cannot duplicate', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const queue = createOfflineQueue({ encryptAtRest: false, syncOnReconnect: false });
    await queue.enqueue(makeReport('dupe-1'));
    await queue.enqueue(makeReport('dupe-1'));

    // IndexedDB `put` is keyed on `id` (upsert); the localStorage fallback has
    // to match, or the duplicate row attempt counter never advances and the
    // row re-flushes forever.
    expect(await queue.size()).toBe(1);

    const { client, calls } = makeClient({ ok: true, data: { reportId: 'r-dupe' } });
    await queue.flush(client);
    expect(calls()).toBe(1);
    expect(await queue.size()).toBe(0);
  });
});

/**
 * Broken-WebView IndexedDB shapes (Facebook/Instagram iOS in-app browsers,
 * TSUMAGOI-28/-29): `open()` fires upgradeneeded with a null result, or the
 * versionchange transaction is already dead so createObjectStore throws.
 * The queue must fall back to localStorage without any uncaught throw from
 * the upgradeneeded callback.
 */
describe('offline queue broken IndexedDB fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  type UpgradeRequest = {
    result: unknown;
    error: Error | null;
    onupgradeneeded: null | (() => void);
    onsuccess: null | (() => void);
    onerror: null | (() => void);
  };

  function stubBrokenIndexedDb(makeResult: () => unknown) {
    vi.stubGlobal('indexedDB', {
      open: () => {
        const req: UpgradeRequest = {
          result: undefined,
          error: null,
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
        };
        queueMicrotask(() => {
          req.result = makeResult();
          // upgradeneeded runs from IDB machinery — a throw here would be an
          // uncaught global error, which is exactly the regression under test.
          req.onupgradeneeded?.();
          req.onsuccess?.();
        });
        return req;
      },
    });
  }

  it('null upgradeneeded result: enqueue lands in localStorage, no throw', async () => {
    stubBrokenIndexedDb(() => undefined);
    const queue = createOfflineQueue({ encryptAtRest: false, syncOnReconnect: false });
    await queue.enqueue(makeReport('webview-1'));
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as Array<{ id: string }>;
    expect(raw.map((r) => r.id)).toContain('webview-1');
  });

  it('dead versionchange transaction (createObjectStore throws): falls back, no throw', async () => {
    stubBrokenIndexedDb(() => ({
      objectStoreNames: { contains: () => false },
      createObjectStore: () => {
        throw new DOMException(
          "Failed to execute 'createObjectStore' on 'IDBDatabase': The database is not running a version change transaction.",
          'InvalidStateError',
        );
      },
      close: () => {},
    }));
    const queue = createOfflineQueue({ encryptAtRest: false, syncOnReconnect: false });
    await queue.enqueue(makeReport('webview-2'));
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as Array<{ id: string }>;
    expect(raw.map((r) => r.id)).toContain('webview-2');
  });
});
