import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { MUSHI_INTERNAL_HEADER, MUSHI_INTERNAL_INIT_MARKER } from '@mushi-mushi/core';
import { createNetworkCapture } from './network';

describe('createNetworkCapture', () => {
  let capture: ReturnType<typeof createNetworkCapture>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    capture?.destroy();
    globalThis.fetch = originalFetch;
  });

  it('captures successful fetch requests', async () => {
    capture = createNetworkCapture();

    capture.destroy();
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    globalThis.fetch = mockFetch;
    capture = createNetworkCapture();

    await fetch('https://api.example.com/test');

    const entries = capture.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].method).toBe('GET');
    expect(entries[0].url).toContain('api.example.com');
    expect(entries[0].status).toBe(200);
    expect(entries[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('captures failed fetch requests', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('Network failed'));
    globalThis.fetch = mockFetch;
    capture = createNetworkCapture();

    await expect(fetch('https://api.example.com/fail')).rejects.toThrow('Network failed');

    const entries = capture.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].status).toBe(0);
    expect(entries[0].error).toBe('Network failed');
  });

  it('ignores SDK-internal fetches by marker, header, and URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    globalThis.fetch = mockFetch;
    capture = createNetworkCapture({
      apiEndpoint: 'https://mushi.example.com/functions/v1/api',
      ignoreUrls: ['analytics.example.com'],
    });

    await fetch('https://mushi.example.com/functions/v1/api/v1/sdk/config');
    await fetch('https://mushi.example.com/functions/v1/api/v1/reports', {
      method: 'POST',
      [MUSHI_INTERNAL_INIT_MARKER]: 'report-submit',
    } as RequestInit & { [MUSHI_INTERNAL_INIT_MARKER]?: string });
    await fetch('https://api.example.com/marked', {
      headers: { [MUSHI_INTERNAL_HEADER]: 'sdk-config' },
    });
    await fetch('https://analytics.example.com/noisy');
    await fetch('https://api.example.com/host');

    const entries = capture.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].url).toContain('api.example.com/host');
  });

  it('respects ring buffer limit (max 30)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    globalThis.fetch = mockFetch;
    capture = createNetworkCapture();

    for (let i = 0; i < 40; i++) {
      await fetch(`https://api.example.com/req-${i}`);
    }

    expect(capture.getEntries().length).toBe(30);
  });

  it('clear removes all entries', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    globalThis.fetch = mockFetch;
    capture = createNetworkCapture();

    await fetch('https://api.example.com/test');
    capture.clear();
    expect(capture.getEntries().length).toBe(0);
  });

  it('destroy restores original fetch', () => {
    const orig = globalThis.fetch;
    capture = createNetworkCapture();
    expect(globalThis.fetch).not.toBe(orig);
    capture.destroy();
    expect(globalThis.fetch).toBe(orig);
  });
});
