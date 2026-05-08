import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { captureSentryContext, tagSentryScope } from './sentry';

const SENTRY_GLOBALS = ['Sentry', '__SENTRY__', '__SENTRY_REPLAY__'] as const;

function clearSentryGlobals() {
  for (const k of SENTRY_GLOBALS) {
    try {
      delete (globalThis as Record<string, unknown>)[k];
    } catch {
      (globalThis as Record<string, unknown>)[k] = undefined;
    }
  }
}

describe('captureSentryContext', () => {
  beforeEach(() => clearSentryGlobals());
  afterEach(() => clearSentryGlobals());

  it('returns an empty object when Sentry is not present', () => {
    const ctx = captureSentryContext({});
    expect(ctx).toEqual({});
  });

  it('captures v7 context (getCurrentHub + scope)', () => {
    const breadcrumbs = [
      { timestamp: 1_700_000_000, category: 'navigation', level: 'info', message: 'route /a' },
      { timestamp: 1_700_000_010, category: 'ui.click', level: 'info', message: 'click submit' },
    ];
    const scope = {
      getLastEventId: () => 'event-123',
      getUser: () => ({ id: 'u1', email: 'u1@example.com' }),
      getTags: () => ({ feature: 'checkout', flag: 'v2' }),
      getTransaction: () => ({ name: 'POST /checkout' }),
      getSession: () => ({ sid: 'sess-1' }),
      getBreadcrumbs: () => breadcrumbs,
      getSpan: () => ({ traceId: 'trace-abc', spanId: 'span-def' }),
    };
    const client = { getOptions: () => ({ release: '1.0.0', environment: 'production' }) };
    (globalThis as Record<string, unknown>).Sentry = {
      getCurrentHub: () => ({ getScope: () => scope, getClient: () => client }),
    };
    (globalThis as Record<string, unknown>).__SENTRY__ = { hub: {} };

    const ctx = captureSentryContext({});
    expect(ctx.sdk).toBe('v7');
    expect(ctx.eventId).toBe('event-123');
    expect(ctx.user).toEqual({
      id: 'u1',
      email: 'u1@example.com',
      username: undefined,
      ip_address: undefined,
    });
    expect(ctx.tags).toEqual({ feature: 'checkout', flag: 'v2' });
    expect(ctx.transactionName).toBe('POST /checkout');
    expect(ctx.sessionId).toBe('sess-1');
    expect(ctx.release).toBe('1.0.0');
    expect(ctx.environment).toBe('production');
    expect(ctx.traceId).toBe('trace-abc');
    expect(ctx.spanId).toBe('span-def');
    expect(ctx.breadcrumbs).toHaveLength(2);
    // Sentry stores breadcrumb timestamps in seconds; the helper
    // converts them to ms so the field is comparable to Mushi's own.
    expect(ctx.breadcrumbs?.[0]?.timestamp).toBe(1_700_000_000_000);
  });

  it('captures v8 context (getCurrentScope + lastEventId + getActiveSpan)', () => {
    const breadcrumbs = [{ timestamp: 1_700_000_000, category: 'fetch', message: '/api/x' }];
    const scope = {
      getUser: () => ({ id: 'u2' }),
      getTags: () => ({ env: 'prod' }),
      getTransactionName: () => 'GET /home',
      getBreadcrumbs: () => breadcrumbs,
    };
    const span = { spanContext: () => ({ traceId: 't-v8', spanId: 's-v8' }) };
    const client = {
      getOptions: () => ({ release: '2.0.0', environment: 'staging' }),
      getDsn: () => ({ host: 'o123.ingest.sentry.io', projectId: '4567', publicKey: 'pk' }),
    };
    (globalThis as Record<string, unknown>).Sentry = {
      lastEventId: () => 'evt-v8',
      getCurrentScope: () => scope,
      getActiveSpan: () => span,
      getClient: () => client,
    };
    (globalThis as Record<string, unknown>).__SENTRY__ = { version: '8' };

    const ctx = captureSentryContext({});
    expect(ctx.sdk).toBe('v8');
    expect(ctx.eventId).toBe('evt-v8');
    expect(ctx.transactionName).toBe('GET /home');
    expect(ctx.tags).toEqual({ env: 'prod' });
    expect(ctx.traceId).toBe('t-v8');
    expect(ctx.spanId).toBe('s-v8');
    expect(ctx.release).toBe('2.0.0');
    // Issue URL is synthesized from DSN host minus the o-prefix +
    // the eventId — gives the admin a one-click pivot into Sentry.
    expect(ctx.issueUrl).toContain('ingest.sentry.io/issues');
    expect(ctx.issueUrl).toContain('evt-v8');
  });

  it('truncates Sentry breadcrumbs to the configured limit', () => {
    const breadcrumbs = Array.from({ length: 100 }, (_, i) => ({
      timestamp: 1_700_000_000 + i,
      category: 'custom',
      message: `b${i}`,
    }));
    const scope = { getBreadcrumbs: () => breadcrumbs };
    (globalThis as Record<string, unknown>).Sentry = {
      lastEventId: () => 'evt',
      getCurrentScope: () => scope,
    };
    (globalThis as Record<string, unknown>).__SENTRY__ = { version: '8' };

    const ctx = captureSentryContext({}, { breadcrumbsLimit: 5 });
    expect(ctx.breadcrumbs).toHaveLength(5);
    // Tail-truncated — most recent breadcrumbs win.
    expect(ctx.breadcrumbs?.[0]?.message).toBe('b95');
    expect(ctx.breadcrumbs?.[4]?.message).toBe('b99');
  });

  it('survives APIs that throw (different point releases of same major)', () => {
    (globalThis as Record<string, unknown>).Sentry = {
      lastEventId: () => {
        throw new Error('not implemented');
      },
      getCurrentScope: () => ({
        getUser: () => {
          throw new Error('boom');
        },
        getTags: () => {
          throw new Error('boom');
        },
        getBreadcrumbs: () => [],
      }),
      getActiveSpan: () => {
        throw new Error('no tracing');
      },
      getClient: () => undefined,
    };
    (globalThis as Record<string, unknown>).__SENTRY__ = { version: '8' };

    const ctx = captureSentryContext({});
    // Detection still works even when every probe inside throws — and
    // we never propagate the error.
    expect(ctx.sdk).toBe('v8');
    expect(ctx.eventId).toBeUndefined();
    expect(ctx.user).toBeUndefined();
  });

  it('falls back to __SENTRY_REPLAY__ when Sentry.getReplay() is missing', () => {
    (globalThis as Record<string, unknown>).Sentry = {
      lastEventId: () => 'evt',
      getCurrentScope: () => ({}),
    };
    (globalThis as Record<string, unknown>).__SENTRY__ = { version: '8' };
    (globalThis as Record<string, unknown>).__SENTRY_REPLAY__ = {
      getReplayId: () => 'replay-xyz',
    };

    const ctx = captureSentryContext({});
    expect(ctx.replayId).toBe('replay-xyz');
  });

  it('reads replay id from Sentry.getReplay() when present', () => {
    (globalThis as Record<string, unknown>).Sentry = {
      lastEventId: () => 'evt',
      getCurrentScope: () => ({}),
      getReplay: () => ({ getReplayId: () => 'replay-from-sdk' }),
    };
    (globalThis as Record<string, unknown>).__SENTRY__ = { version: '8' };

    const ctx = captureSentryContext({});
    expect(ctx.replayId).toBe('replay-from-sdk');
  });

  it('falls back to scope._breadcrumbs when getBreadcrumbs() is not exposed', () => {
    (globalThis as Record<string, unknown>).Sentry = {
      lastEventId: () => 'evt',
      getCurrentScope: () => ({
        _breadcrumbs: [
          { timestamp: 1_700_000_001, category: 'navigation', message: 'fallback works' },
        ],
      }),
    };
    (globalThis as Record<string, unknown>).__SENTRY__ = { version: '8' };

    const ctx = captureSentryContext({});
    expect(ctx.breadcrumbs).toHaveLength(1);
    expect(ctx.breadcrumbs?.[0]?.message).toBe('fallback works');
  });
});

describe('tagSentryScope', () => {
  beforeEach(() => clearSentryGlobals());
  afterEach(() => clearSentryGlobals());

  it('writes tag + context + breadcrumb on v8 Sentry', () => {
    const calls: { setTag: string[][]; setContext: unknown[]; addBreadcrumb: unknown[] } = {
      setTag: [],
      setContext: [],
      addBreadcrumb: [],
    };
    (globalThis as Record<string, unknown>).Sentry = {
      setTag: (k: string, v: string | number | boolean) => calls.setTag.push([k, String(v)]),
      setContext: (n: string, c: Record<string, unknown> | null) =>
        calls.setContext.push({ n, c }),
      addBreadcrumb: (b: Record<string, unknown>) => calls.addBreadcrumb.push(b),
    };
    (globalThis as Record<string, unknown>).__SENTRY__ = { version: '8' };

    tagSentryScope('rep-1', { reportUrl: 'https://admin.mushi/reports/rep-1' });
    expect(calls.setTag).toContainEqual(['mushi.report_id', 'rep-1']);
    expect(calls.setTag).toContainEqual([
      'mushi.report_url',
      'https://admin.mushi/reports/rep-1',
    ]);
    expect(calls.setContext).toHaveLength(1);
    expect((calls.setContext[0] as { n: string }).n).toBe('mushi_report');
    expect(calls.addBreadcrumb).toHaveLength(1);
    expect((calls.addBreadcrumb[0] as { category: string }).category).toBe('mushi');
  });

  it('falls back to v7 hub.scope.setTag when v8 surface is missing', () => {
    const setTagCalls: string[][] = [];
    (globalThis as Record<string, unknown>).Sentry = {
      getCurrentHub: () => ({
        getScope: () => ({
          setTag: (k: string, v: string | number | boolean) =>
            setTagCalls.push([k, String(v)]),
          setContext: () => {},
        }),
      }),
    };

    tagSentryScope('rep-2');
    expect(setTagCalls).toContainEqual(['mushi.report_id', 'rep-2']);
  });

  it('is a no-op when Sentry is missing', () => {
    expect(() => tagSentryScope('rep-3')).not.toThrow();
  });
});
