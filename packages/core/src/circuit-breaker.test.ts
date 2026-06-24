import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApiClient } from './api-client';
import type { MushiReport } from './types';

const minimalReport: MushiReport = {
  id: 'rpt_x',
  projectId: 'proj_test',
  category: 'bug',
  description: 'x',
  environment: {
    userAgent: 't',
    platform: 't',
    language: 'en',
    viewport: { width: 1, height: 1 },
    url: 'https://example.com',
    referrer: '',
    timestamp: new Date().toISOString(),
    timezone: 'UTC',
  },
  reporterToken: 'mushi_test',
  createdAt: new Date().toISOString(),
};

describe('api-client circuit breaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('opens after threshold failures, fast-fails without fetch, then half-opens after cooldown', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('fetch failed'));
    const client = createApiClient({
      projectId: 'proj_test',
      apiKey: 'k',
      apiEndpoint: 'https://api.test.local',
      timeout: 5000,
      maxRetries: 0,
      circuitBreaker: { threshold: 2, cooldownMs: 30_000 },
    });

    const r1 = await client.submitReport(minimalReport);
    const r2 = await client.submitReport(minimalReport);
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Circuit is now open → next call fast-fails with no network request.
    const r3 = await client.submitReport(minimalReport);
    expect(r3.ok).toBe(false);
    expect(r3.ok === false && r3.error.code).toBe('CIRCUIT_OPEN');
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // After the cooldown the circuit half-opens; a success closes it.
    // Fresh Response per call — a single Response's body can only be read once.
    fetchSpy.mockImplementation(async () =>
      new Response(JSON.stringify({ reportId: 'ok' }), { status: 200 }),
    );
    vi.advanceTimersByTime(30_001);
    const r4 = await client.submitReport(minimalReport);
    expect(r4.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // Closed again → subsequent requests pass straight through.
    const r5 = await client.submitReport(minimalReport);
    expect(r5.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('does not fast-fail when the circuit breaker is disabled', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('fail'));
    const client = createApiClient({
      projectId: 'p',
      apiKey: 'k',
      apiEndpoint: 'https://api.test.local',
      timeout: 5000,
      maxRetries: 0,
      circuitBreaker: { enabled: false, threshold: 2 },
    });

    for (let i = 0; i < 5; i++) {
      await client.submitReport(minimalReport);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });
});
