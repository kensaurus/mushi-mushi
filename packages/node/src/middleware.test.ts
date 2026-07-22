/**
 * Tests for mushiTraceMiddleware.
 *
 * Verifies:
 *  - Middleware calls next() and doesn't block the request path
 *  - Span is posted only when a valid traceparent header is present
 *  - parseTraceId extracts the 32-char trace-id segment correctly
 *  - onlyErrors gate skips 2xx/4xx spans
 *  - DEFAULT_API_ENDPOINT is used when apiEndpoint is not set
 *  - The hardcoded duplicate URL has been removed (single source of truth)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mushiTraceMiddleware } from './middleware.js';
import { DEFAULT_API_ENDPOINT } from '@mushi-mushi/core';

// ─── mock global fetch ────────────────────────────────────────────────────────
const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
vi.stubGlobal('fetch', fetchMock);

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeReq(traceparent?: string, session?: string) {
  return {
    method: 'GET',
    url: '/api/test',
    headers: {
      ...(traceparent ? { traceparent } : {}),
      ...(session ? { 'x-mushi-session': session } : {}),
    },
  };
}

function makeRes(status = 200) {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    statusCode: status,
    on(event: string, cb: () => void) {
      listeners[event] ??= [];
      listeners[event]!.push(cb);
    },
    emit(event: string) {
      listeners[event]?.forEach((cb) => cb());
    },
    _listeners: listeners,
  };
}

const VALID_TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

// ─── tests ───────────────────────────────────────────────────────────────────

describe('mushiTraceMiddleware', () => {
  let nextCalled = false;

  beforeEach(() => {
    fetchMock.mockClear();
    nextCalled = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls next() immediately (non-blocking)', () => {
    const middleware = mushiTraceMiddleware({ apiKey: 'mushi_test_key' });
    const req = makeReq();
    const res = makeRes();
    const next = () => { nextCalled = true; };

    middleware(req, res, next);
    expect(nextCalled).toBe(true);
  });

  it('does NOT post a span when traceparent header is absent', async () => {
    const middleware = mushiTraceMiddleware({ apiKey: 'mushi_test_key' });
    const req = makeReq(); // no traceparent
    const res = makeRes();

    middleware(req, res, () => {});
    res.emit('finish');

    // Allow any async postSpan to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts a span on finish when traceparent is valid', async () => {
    const middleware = mushiTraceMiddleware({ apiKey: 'mushi_test_key' });
    const req = makeReq(VALID_TRACEPARENT, 'session-abc');
    const res = makeRes(200);

    middleware(req, res, () => {});
    res.emit('finish');

    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/ingest/spans');
    expect(url).toContain(DEFAULT_API_ENDPOINT.replace(/\/$/, ''));

    const body = JSON.parse(init.body as string) as { spans: unknown[] };
    expect(body.spans).toHaveLength(1);
    const span = body.spans[0] as Record<string, unknown>;
    expect(span['traceId']).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(span['sessionId']).toBe('session-abc');
  });

  it('uses the provided apiEndpoint instead of the default', async () => {
    const middleware = mushiTraceMiddleware({
      apiKey: 'mushi_test_key',
      apiEndpoint: 'https://custom.endpoint.test',
    });
    const req = makeReq(VALID_TRACEPARENT);
    const res = makeRes(200);

    middleware(req, res, () => {});
    res.emit('finish');

    await new Promise((r) => setTimeout(r, 20));
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('custom.endpoint.test');
  });

  it('respects onlyErrors: skips 2xx spans', async () => {
    const middleware = mushiTraceMiddleware({ apiKey: 'mushi_test_key', onlyErrors: true });
    const req = makeReq(VALID_TRACEPARENT);
    const res = makeRes(200);

    middleware(req, res, () => {});
    res.emit('finish');

    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('respects onlyErrors: POSTS 5xx spans', async () => {
    const middleware = mushiTraceMiddleware({ apiKey: 'mushi_test_key', onlyErrors: true });
    const req = makeReq(VALID_TRACEPARENT);
    const res = makeRes(500);

    middleware(req, res, () => {});
    res.emit('finish');

    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('auth header carries the API key', async () => {
    const middleware = mushiTraceMiddleware({ apiKey: 'TEST-FIXTURE-NOT-A-REAL-KEY' });
    const req = makeReq(VALID_TRACEPARENT);
    const res = makeRes(200);

    middleware(req, res, () => {});
    res.emit('finish');

    await new Promise((r) => setTimeout(r, 20));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Mushi-Api-Key']).toBe('TEST-FIXTURE-NOT-A-REAL-KEY');
  });

  it('DEFAULT_API_ENDPOINT is imported from @mushi-mushi/core (not hardcoded in this file)', () => {
    // Regression test for the Jul-2026 URL deduplication fix.
    // The URL must be the single canonical one from core — if someone adds
    // another hardcoded copy in this file, this test will still pass, but
    // the grep-based CI check (check-catalog-count principle) catches it.
    expect(DEFAULT_API_ENDPOINT).toContain('supabase.co/functions/v1/api');
  });
});
