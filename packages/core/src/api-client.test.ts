import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApiClient } from './api-client';

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
});
