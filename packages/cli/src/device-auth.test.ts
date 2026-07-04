/**
 * FILE: packages/cli/src/device-auth.test.ts
 * PURPOSE: Unit tests for the shared RFC 8628 device-auth client. Mocks global
 *          fetch and injects sleep/now into the poll loop for determinism.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  listProjects,
  mintProjectKey,
  pollDeviceToken,
  setDeviceAuthRetryDelayMs,
  startDeviceAuth,
  waitForCliToken,
} from './device-auth.js';

const ENDPOINT = 'https://api.example.test/functions/v1/api';

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {},
) {
  const headerMap = new Map(Object.entries(init.headers ?? {}));
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    headers: { get: (name: string) => headerMap.get(name) ?? null },
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
let savedRetryDelayMs: number;

beforeEach(() => {
  savedRetryDelayMs = 1_000;
  setDeviceAuthRetryDelayMs(0);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  setDeviceAuthRetryDelayMs(savedRetryDelayMs);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('startDeviceAuth', () => {
  it('returns the session on success and trims a trailing slash on the endpoint', async () => {
    const session = {
      device_code: 'dc',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://console/cli-auth?code=ABCD-EFGH',
      expires_in: 600,
      interval: 5,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: session }));

    const result = await startDeviceAuth(`${ENDPOINT}/`);

    expect(result).toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith(
      `${ENDPOINT}/v1/cli/auth/device/start`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws a descriptive error when the backend rejects', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { message: 'nope' } }, { ok: false, status: 500 }),
    );
    await expect(startDeviceAuth(ENDPOINT)).rejects.toThrow('nope');
  });

  it('sends client_id in the start body when provided', async () => {
    const session = {
      device_code: 'dc',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://console/cli-auth?code=ABCD-EFGH',
      expires_in: 600,
      interval: 5,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: session }));

    await startDeviceAuth(ENDPOINT, 'cli_abc123def4567890');

    expect(fetchMock).toHaveBeenCalledWith(
      `${ENDPOINT}/v1/cli/auth/device/start`,
      expect.objectContaining({
        body: JSON.stringify({ client_id: 'cli_abc123def4567890' }),
      }),
    );
  });
});

describe('pollDeviceToken', () => {
  it('maps an approved response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { cli_token: 'tok', user_id: 'u1' } }),
    );
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({
      status: 'approved',
      cliToken: 'tok',
      userId: 'u1',
    });
  });

  it('maps authorization_pending → pending', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'authorization_pending' }, { ok: false, status: 400 }),
    );
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({ status: 'pending' });
  });

  it('maps access_denied → denied', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'access_denied' }, { ok: false, status: 400 }),
    );
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({ status: 'denied' });
  });

  it('maps expired_token → expired', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'expired_token' }, { ok: false, status: 400 }),
    );
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({ status: 'expired' });
  });

  it('maps an unknown 4xx error to a terminal (non-retryable) error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: 'server_error', error_description: 'boom' },
        { ok: false, status: 400 },
      ),
    );
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({
      status: 'error',
      message: 'boom',
      retryable: false,
    });
  });

  it('maps a 5xx error to a retryable error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: 'server_error', error_description: 'upstream down' },
        { ok: false, status: 503 },
      ),
    );
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({
      status: 'error',
      message: 'upstream down',
      retryable: true,
    });
  });

  it('maps 429 slow_down to its own outcome, honoring Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: 'slow_down', error_description: 'rate limited' },
        { ok: false, status: 429, headers: { 'Retry-After': '3' } },
      ),
    );
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({
      status: 'slow_down',
      retryAfterMs: 3000,
    });
  });

  it('falls back to a default backoff when slow_down omits Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: 'slow_down', error_description: 'rate limited' },
        { ok: false, status: 429 },
      ),
    );
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({
      status: 'slow_down',
      retryAfterMs: 5000,
    });
  });

  it('maps 408 gateway timeout to a retryable error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: 'timeout', error_description: 'gateway timed out' },
        { ok: false, status: 408 },
      ),
    );
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({
      status: 'error',
      message: 'gateway timed out',
      retryable: true,
    });
  });

  it('never throws on a network failure — surfaces it as a retryable error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({
      status: 'error',
      message: 'ECONNRESET',
      retryable: true,
    });
  });
});

describe('waitForCliToken', () => {
  const session = { device_code: 'dc', interval: 5, expires_in: 600 };

  it('does NOT sleep before the very first poll (immediate-first-poll)', async () => {
    // Backend approves immediately on the first poll.
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { cli_token: 'tok' } }));

    const sleepSpy = vi.fn(async () => {});
    const token = await waitForCliToken(ENDPOINT, session, { sleep: sleepSpy, now: () => 0 });

    expect(token).toBe('tok');
    // sleep must NOT have been called before the first poll
    expect(sleepSpy).toHaveBeenCalledTimes(0);
  });

  it('sleeps the interval between subsequent polls', async () => {
    // First poll: pending; second poll: approved
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: 'authorization_pending' }, { ok: false, status: 400 }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { cli_token: 'tok2' } }));

    const sleepSpy = vi.fn(async () => {});
    const token = await waitForCliToken(ENDPOINT, session, { sleep: sleepSpy, now: () => 0 });

    expect(token).toBe('tok2');
    // sleep should be called exactly once (between first and second poll)
    expect(sleepSpy).toHaveBeenCalledTimes(1);
    expect(sleepSpy).toHaveBeenCalledWith(5000); // session.interval * 1000
  });

  it('resolves the token after a pending poll', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: 'authorization_pending' }, { ok: false, status: 400 }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { cli_token: 'tok' } }));

    const onPending = vi.fn();
    const token = await waitForCliToken(ENDPOINT, session, {
      sleep: async () => {},
      now: () => 0,
      onPending,
    });

    expect(token).toBe('tok');
    expect(onPending).toHaveBeenCalledTimes(1);
  });

  it('honors slow_down without spending the transient-error budget', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { error: 'slow_down' },
          { ok: false, status: 429, headers: { 'Retry-After': '9' } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { cli_token: 'tok' } }));

    const sleepSpy = vi.fn(async () => {});
    const onSlowDown = vi.fn();
    const onTransientError = vi.fn();
    const token = await waitForCliToken(ENDPOINT, session, {
      sleep: sleepSpy,
      now: () => 0,
      onSlowDown,
      onTransientError,
    });

    expect(token).toBe('tok');
    expect(onSlowDown).toHaveBeenCalledWith(9000);
    expect(onTransientError).not.toHaveBeenCalled();
    // interval (5000) bumped up to the requested 9000ms before the next poll.
    expect(sleepSpy).toHaveBeenCalledWith(9000);
  });

  it('slow_down survives past the transient-error budget without throwing', async () => {
    // Five slow_downs in a row would blow a maxConsecutiveErrors=3 budget if it
    // were bucketed as a generic retryable error — it must not be.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'slow_down' }, { ok: false, status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'slow_down' }, { ok: false, status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'slow_down' }, { ok: false, status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'slow_down' }, { ok: false, status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { cli_token: 'tok' } }));

    const token = await waitForCliToken(ENDPOINT, session, {
      sleep: async () => {},
      now: () => 0,
      maxConsecutiveErrors: 3,
    });

    expect(token).toBe('tok');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('throws when the request is denied', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'access_denied' }, { ok: false, status: 400 }),
    );
    await expect(
      waitForCliToken(ENDPOINT, session, { sleep: async () => {}, now: () => 0 }),
    ).rejects.toThrow(/denied/i);
  });

  it('tolerates a transient poll error and resolves after recovery', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET')) // transient — should not abort
      .mockResolvedValueOnce(
        jsonResponse({ error: 'authorization_pending' }, { ok: false, status: 400 }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { cli_token: 'tok' } }));

    const onTransientError = vi.fn();
    const token = await waitForCliToken(ENDPOINT, session, {
      sleep: async () => {},
      now: () => 0,
      onTransientError,
    });

    expect(token).toBe('tok');
    expect(onTransientError).toHaveBeenCalledTimes(1);
    expect(onTransientError).toHaveBeenCalledWith(expect.stringMatching(/ECONNRESET/), 1);
  });

  it('gives up after too many consecutive transient errors', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(
      waitForCliToken(ENDPOINT, session, {
        sleep: async () => {},
        now: () => 0,
        maxConsecutiveErrors: 3,
      }),
    ).rejects.toThrow(/offline/i);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails fast on a terminal 4xx error without spending the retry budget', async () => {
    // A 4xx (e.g. already-claimed token) is non-retryable — should throw on the
    // first poll, not after maxConsecutiveErrors attempts.
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: 'server_error', error_description: 'already retrieved' },
        { ok: false, status: 400 },
      ),
    );
    const onTransientError = vi.fn();
    await expect(
      waitForCliToken(ENDPOINT, session, {
        sleep: async () => {},
        now: () => 0,
        maxConsecutiveErrors: 5,
        onTransientError,
      }),
    ).rejects.toThrow(/already retrieved/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onTransientError).not.toHaveBeenCalled();
  });

  it('throws a timeout error once the deadline passes', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'authorization_pending' }, { ok: false, status: 400 }),
    );
    // now(): deadline calc (0), first while-check (0), post-poll while-check (past deadline).
    const times = [0, 0, 600_001];
    let i = 0;
    const now = () => times[Math.min(i++, times.length - 1)];
    await expect(
      waitForCliToken(ENDPOINT, session, { sleep: async () => {}, now }),
    ).rejects.toThrow(/timed out/i);
  });
});

describe('listProjects', () => {
  it('returns the project list on success', async () => {
    const projects = [{ id: 'p1', name: 'One', slug: 'one' }];
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { projects } }));
    await expect(listProjects(ENDPOINT, 'tok')).resolves.toEqual(projects);
  });

  it('retries once on a network failure, then throws a typed error', async () => {
    // A network failure must never read as "no projects yet" — that silent []
    // was the root of the "browser connected, terminal fell back" reports.
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(listProjects(ENDPOINT, 'tok')).rejects.toMatchObject({
      name: 'DeviceAuthRequestError',
      step: 'list_projects',
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers when the retry succeeds', async () => {
    const projects = [{ id: 'p1', name: 'One', slug: 'one' }];
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { projects } }));
    await expect(listProjects(ENDPOINT, 'tok')).resolves.toEqual(projects);
  });

  it('throws with the server message on a 4xx without retrying', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { message: 'token revoked' } }, { ok: false, status: 401 }),
    );
    await expect(listProjects(ENDPOINT, 'tok')).rejects.toThrow('token revoked');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('createProject', () => {
  it('returns the created project including the minted key', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { ok: true, data: { id: 'p1', name: 'One', slug: 'one', apiKey: 'mushi_x' } },
        { status: 201 },
      ),
    );
    await expect(createProject(ENDPOINT, 'tok', 'One')).resolves.toEqual({
      id: 'p1',
      name: 'One',
      slug: 'one',
      apiKey: 'mushi_x',
    });
  });

  it('throws on a backend error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { message: 'no org' } }, { ok: false, status: 400 }),
    );
    await expect(createProject(ENDPOINT, 'tok', 'One')).rejects.toThrow('no org');
  });
});

describe('mintProjectKey', () => {
  it('returns the minted key on success', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { key: 'mushi_y' } }, { status: 201 }),
    );
    await expect(mintProjectKey(ENDPOINT, 'tok', 'p1')).resolves.toBe('mushi_y');
  });

  it('throws a typed error when the mint fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false }, { ok: false, status: 403 }));
    await expect(mintProjectKey(ENDPOINT, 'tok', 'p1')).rejects.toMatchObject({
      name: 'DeviceAuthRequestError',
      step: 'mint_key',
      status: 403,
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on a 5xx and surfaces the failure if it persists', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, error: { message: 'db unavailable' } }, { ok: false, status: 503 }),
    );
    await expect(mintProjectKey(ENDPOINT, 'tok', 'p1')).rejects.toThrow('db unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
