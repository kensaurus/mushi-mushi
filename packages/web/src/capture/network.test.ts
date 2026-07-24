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

  it('scrubs sensitive query values from captured URLs (RealWorld attunement)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    globalThis.fetch = mockFetch;
    capture = createNetworkCapture();

    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqYWtlIn0.abc-123_XYZ';
    await fetch('https://api.example.com/articles?tag=dragons&limit=10&token=supersecret');
    await fetch(`https://api.example.com/next?redirect=${jwt}`);

    const entries = capture.getEntries();
    // Known-sensitive key: value redacted, benign Conduit filters preserved.
    expect(entries[0].url).toBe(
      'https://api.example.com/articles?tag=dragons&limit=10&token=[Scrubbed]',
    );
    // JWT under an innocent key name is still pattern-scrubbed.
    expect(entries[1].url).not.toContain('eyJ');
    expect(entries[1].url).toContain('REDACTED_JWT');
  });

  it('never captures request headers on network entries (Token auth regression)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    globalThis.fetch = mockFetch;
    capture = createNetworkCapture();

    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqYWtlIn0.abc-123_XYZ';
    await fetch('https://api.example.com/user', {
      headers: { Authorization: `Token ${jwt}` },
    });

    const [entry] = capture.getEntries();
    // Entry shape is method/url/status/timing only — assert the JWT cannot
    // leak through ANY captured field.
    expect(JSON.stringify(entry)).not.toContain(jwt);
    expect(entry).not.toHaveProperty('headers');
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

  it('ignores XHR to ignoreUrls / SDK endpoints (shouldRecord gate)', async () => {
    capture = createNetworkCapture({
      apiEndpoint: 'https://mushi.example.com/functions/v1/api',
      ignoreUrls: ['analytics.example.com'],
    });

    const sendXhr = (url: string) =>
      new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.addEventListener('loadend', () => resolve());
        xhr.addEventListener('error', () => resolve());
        xhr.send();
      });

    // Mock XHR transport via fake server responses isn't available in all
    // environments — drive readyState via the real XHR against data: URLs
    // for the host request, and against ignored hosts that will fail/abort.
    await sendXhr('https://analytics.example.com/noisy');
    await sendXhr('https://mushi.example.com/functions/v1/api/v1/sdk/config');
    await sendXhr('https://mushi.example.com/functions/v1/api/v1/reports');

    // Host request that should be recorded (data: completes with status 200
    // in happy-dom/jsdom-like environments; fall back to checking ignore only).
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'data:text/plain,ok');
      xhr.addEventListener('loadend', () => resolve());
      xhr.addEventListener('error', () => resolve());
      xhr.send();
    });

    const entries = capture.getEntries();
    expect(entries.every((e) => !e.url.includes('analytics.example.com'))).toBe(true);
    expect(entries.every((e) => !e.url.includes('/v1/sdk/'))).toBe(true);
    expect(entries.every((e) => !e.url.includes('/v1/reports'))).toBe(true);
    expect(entries.some((e) => e.captureMethod === 'xhr')).toBe(true);
  });

  it('destroy does not clobber a later XHR wrapper (Sentry-style)', () => {
    const openBefore = XMLHttpRequest.prototype.open;
    const sendBefore = XMLHttpRequest.prototype.send;
    capture = createNetworkCapture();
    const mushiOpen = XMLHttpRequest.prototype.open;
    const mushiSend = XMLHttpRequest.prototype.send;
    expect(mushiOpen).not.toBe(openBefore);

    // Simulate Sentry wrapping on top of Mushi.
    const sentryOpen = function sentryOpen(this: XMLHttpRequest, ...args: Parameters<typeof XMLHttpRequest.prototype.open>) {
      return mushiOpen.apply(this, args);
    } as typeof XMLHttpRequest.prototype.open;
    const sentrySend = function sentrySend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      return mushiSend.call(this, body);
    } as typeof XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = sentryOpen;
    XMLHttpRequest.prototype.send = sentrySend;

    capture.destroy();

    expect(XMLHttpRequest.prototype.open).toBe(sentryOpen);
    expect(XMLHttpRequest.prototype.send).toBe(sentrySend);

    // Clean up so later tests see a sane prototype.
    XMLHttpRequest.prototype.open = openBefore;
    XMLHttpRequest.prototype.send = sendBefore;
  });
});
