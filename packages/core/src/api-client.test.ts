import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApiClient, parseRetryAfter, resolveRequestBaseUrl } from './api-client';

describe('createApiClient', () => {
  const mockOptions = {
    projectId: 'proj_test',
    apiKey: 'mushi_test_key',
    apiEndpoint: 'https://api.test.local',
    timeout: 5000,
    maxRetries: 1,
  };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('creates a client with submitReport and getReportStatus', () => {
    const client = createApiClient(mockOptions);
    expect(client.submitReport).toBeTypeOf('function');
    expect(client.getReportStatus).toBeTypeOf('function');
  });

  it('sends report with correct headers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ reportId: 'rpt_123' }), { status: 200 }),
    );

    const client = createApiClient(mockOptions);
    const result = await client.submitReport({
      id: 'rpt_123',
      projectId: 'proj_test',
      category: 'bug',
      description: 'Test bug',
      environment: {
        userAgent: 'test',
        platform: 'test',
        language: 'en',
        viewport: { width: 1024, height: 768 },
        url: 'https://example.com',
        referrer: '',
        timestamp: new Date().toISOString(),
        timezone: 'UTC',
      },
      reporterToken: 'mushi_test',
      createdAt: new Date().toISOString(),
    });

    expect(result.ok).toBe(true);
    expect(result.data?.reportId).toBe('rpt_123');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.test.local/v1/reports');
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({
        'X-Mushi-Api-Key': 'mushi_test_key',
        'X-Mushi-Project': 'proj_test',
      }),
    );
  });

  it('returns error on 4xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Bad request' }), { status: 400 }),
    );

    const client = createApiClient(mockOptions);
    const result = await client.submitReport({
      id: 'rpt_bad',
      projectId: 'proj_test',
      category: 'bug',
      description: 'Test',
      environment: {
        userAgent: 'test', platform: 'test', language: 'en',
        viewport: { width: 0, height: 0 }, url: '', referrer: '',
        timestamp: '', timezone: 'UTC',
      },
      reporterToken: 'mushi_test',
      createdAt: new Date().toISOString(),
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('HTTP_400');
  });

  it('retries on 5xx errors', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reportId: 'rpt_retry' }), { status: 200 }),
      );

    const client = createApiClient(mockOptions);
    const result = await client.submitReport({
      id: 'rpt_retry',
      projectId: 'proj_test',
      category: 'bug',
      description: 'Retry test',
      environment: {
        userAgent: 'test', platform: 'test', language: 'en',
        viewport: { width: 0, height: 0 }, url: '', referrer: '',
        timestamp: '', timezone: 'UTC',
      },
      reporterToken: 'mushi_test',
      createdAt: new Date().toISOString(),
    });

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns network error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network down'));

    const client = createApiClient({ ...mockOptions, maxRetries: 0 });
    const result = await client.submitReport({
      id: 'rpt_fail',
      projectId: 'proj_test',
      category: 'bug',
      description: 'Fail test',
      environment: {
        userAgent: 'test', platform: 'test', language: 'en',
        viewport: { width: 0, height: 0 }, url: '', referrer: '',
        timestamp: '', timezone: 'UTC',
      },
      reporterToken: 'mushi_test',
      createdAt: new Date().toISOString(),
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NETWORK_ERROR');
    expect(result.error?.message).toBe('Network down');
  });

  it('getReportStatus calls GET with correct path', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'classified' }), { status: 200 }),
    );

    const client = createApiClient(mockOptions);
    const result = await client.getReportStatus('rpt_123');

    expect(result.ok).toBe(true);
    expect(result.data?.status).toBe('classified');
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.test.local/v1/reports/rpt_123/status');
  });

  // H17: 429 is a "come back later", not an app-level rejection. It used to be
  // returned as terminal, so a rate-limited report was never retried inline.
  it('retries a 429 and honours a short Retry-After delay', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reportId: 'rpt_429' }), { status: 200 }),
      );

    const client = createApiClient(mockOptions);
    const result = await client.submitReport({
      id: 'rpt_429',
      projectId: 'proj_test',
      category: 'bug',
      description: 'Rate limit test',
      environment: {
        userAgent: 'test', platform: 'test', language: 'en',
        viewport: { width: 0, height: 0 }, url: '', referrer: '',
        timestamp: '', timezone: 'UTC',
      },
      reporterToken: 'mushi_test',
      createdAt: new Date().toISOString(),
    });

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not block on a Retry-After window longer than the inline cap', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 429, headers: { 'Retry-After': '600' } }),
    );

    const client = createApiClient(mockOptions);
    const result = await client.submitReport({
      id: 'rpt_429_long',
      projectId: 'proj_test',
      category: 'bug',
      description: 'Long rate limit test',
      environment: {
        userAgent: 'test', platform: 'test', language: 'en',
        viewport: { width: 0, height: 0 }, url: '', referrer: '',
        timestamp: '', timezone: 'UTC',
      },
      reporterToken: 'mushi_test',
      createdAt: new Date().toISOString(),
    });

    // A ten-minute window is left to the offline queue rather than parking the
    // caller on a sleep, so exactly one request goes out.
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('HTTP_429');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('POSTs reports to the tunnel path', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ reportId: 'rpt_tun' }), { status: 200 }),
    );
    const client = createApiClient({
      ...mockOptions,
      tunnel: '/api/mushi-tunnel',
    });
    await client.submitReport({
      id: 'rpt_tun',
      projectId: 'proj_test',
      category: 'bug',
      description: 'Tunnel',
      environment: {
        userAgent: 'test', platform: 'test', language: 'en',
        viewport: { width: 0, height: 0 }, url: '', referrer: '',
        timestamp: '', timezone: 'UTC',
      },
      reporterToken: 'mushi_test',
      createdAt: new Date().toISOString(),
    });
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/mushi-tunnel/v1/reports');
  });
});

describe('resolveRequestBaseUrl', () => {
  it('uses tunnel when set and strips a trailing slash', () => {
    expect(resolveRequestBaseUrl('https://ingest.example/api', '/api/mushi-tunnel/')).toBe(
      '/api/mushi-tunnel',
    );
  });

  it('falls back to the API endpoint', () => {
    expect(resolveRequestBaseUrl('https://ingest.example/api/')).toBe('https://ingest.example/api');
  });
});

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter(' 5 ')).toBe(5000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('reads an HTTP-date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:07 GMT', now)).toBe(7000);
    // A date already in the past means "retry now", not a negative delay.
    expect(parseRetryAfter('Wed, 31 Dec 2025 23:59:00 GMT', now)).toBe(0);
  });

  it('rejects missing, malformed, and negative values', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('   ')).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter('-5')).toBeNull();
  });
});

describe('reporter inbox requests', () => {
  const opts = {
    projectId: 'proj_test',
    apiKey: 'mushi_test_key',
    apiEndpoint: 'https://api.test.local',
    timeout: 5000,
    maxRetries: 0,
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('times out a hung thread read and resolves ok:false instead of hanging', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        (init as RequestInit).signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')));
      }));
    const pending = createApiClient(opts).listReporterComments('r1', 'tok');
    // The digest is hashed (real SubtleCrypto) before the abort timer exists.
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(5000);
    const res = await pending;
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('NETWORK_ERROR');
  });

  it('resolves ok:false when fetch throws (never rejects)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(createApiClient(opts).listReporterReports('tok')).resolves.toMatchObject({ ok: false });
  });

  it('still sends the signed digest headers and unwraps data', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { comments: [{ id: 'c1' }] } }), { status: 200 }),
    );
    const res = await createApiClient(opts).listReporterComments('r1', 'tok');
    expect(res).toEqual({ ok: true, data: { comments: [{ id: 'c1' }] } });
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Reporter-Token-Hash']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers['X-Reporter-Hmac']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers['X-Reporter-Ts']).toMatch(/^\d+$/);
    expect(headers['X-Mushi-Internal']).toBe('reporter-poll');
  });

  it('reporter 5xx never opens the circuit breaker for report submission', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('/v1/reporter/')
        ? new Response(JSON.stringify({ error: { message: 'inbox down' } }), { status: 503 })
        : new Response(JSON.stringify({ reportId: 'rpt_ok' }), { status: 200 }));
    const client = createApiClient({ ...opts, circuitBreaker: { threshold: 2, cooldownMs: 60_000 } });

    for (let i = 0; i < 6; i++) {
      const res = await client.listReporterComments('r1', 'tok');
      expect(res.ok).toBe(false);
    }
    const submit = await client.submitReport({ id: 'r', projectId: 'proj_test', category: 'bug', description: 'Save button does nothing at all' } as never);
    // Reached the network and succeeded — not fast-failed with CIRCUIT_OPEN,
    // which is what routes a report into the offline queue.
    expect(submit).toMatchObject({ ok: true, data: { reportId: 'rpt_ok' } });
    expect(fetchSpy.mock.calls.some(([u]) => String(u).endsWith('/v1/reports'))).toBe(true);
  });

  it('control: the same number of submission 5xx DOES open it, and reporter reads still go out', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).endsWith('/v1/reports')
        ? new Response('{}', { status: 503 })
        : new Response(JSON.stringify({ ok: true, data: { comments: [] } }), { status: 200 }));
    const client = createApiClient({ ...opts, circuitBreaker: { threshold: 2, cooldownMs: 60_000 } });
    const report = { id: 'r', projectId: 'proj_test', category: 'bug', description: 'Save button does nothing at all' } as never;

    await client.submitReport(report);
    await client.submitReport(report);
    expect((await client.submitReport(report)).error?.code).toBe('CIRCUIT_OPEN');
    // An open breaker doesn't block the reporter inbox either.
    const before = fetchSpy.mock.calls.length;
    expect(await client.listReporterComments('r1', 'tok')).toMatchObject({ ok: true });
    expect(fetchSpy.mock.calls.length).toBe(before + 1);
  });

  it('never queues a reporter reply for pagehide replay', async () => {
    vi.resetModules();
    const fresh = await import('./api-client');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { comment: { id: 'c1' } } }), { status: 200 }),
    );
    await fresh.createApiClient(opts).replyToReporterReport('r1', 'tok', 'still broken');
    expect(fresh.flushLastOutboundOnUnload()).toBe(false);
  });

  it('does not replay a report that was already delivered', async () => {
    vi.resetModules();
    const fresh = await import('./api-client');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { reportId: 'rpt_ok' } }), { status: 200 }),
    );
    const report = { id: 'r', projectId: 'proj_test', category: 'bug', description: 'Save button does nothing at all' } as never;
    expect(await fresh.createApiClient(opts).submitReport(report)).toMatchObject({ ok: true });
    expect(fresh.flushLastOutboundOnUnload()).toBe(false);
  });

  it('replays an in-flight report once on pagehide', async () => {
    vi.resetModules();
    const fresh = await import('./api-client');
    let respond: (r: Response) => void = () => {};
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { respond = resolve; }))
      .mockResolvedValue(new Response(null, { status: 200 }));
    const report = { id: 'r', projectId: 'proj_test', category: 'bug', description: 'Save button does nothing at all' } as never;
    const pending = fresh.createApiClient(opts).submitReport(report);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    expect(fresh.flushLastOutboundOnUnload()).toBe(true);
    expect(fresh.flushLastOutboundOnUnload()).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((fetchSpy.mock.calls[1][1] as RequestInit).keepalive).toBe(true);

    respond(new Response(JSON.stringify({ ok: true, data: { reportId: 'rpt_ok' } }), { status: 200 }));
    await pending;
  });
});
