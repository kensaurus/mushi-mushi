import { describe, expect, it } from 'vitest';
import { collectDiagnostics, DIAGNOSTICS_MAX_CHARS } from './diagnostics';

describe('collectDiagnostics (setDiagnosticsProvider, 2026-11-16)', () => {
  it('returns what the provider gives, read at submit time', async () => {
    let n = 0;
    const provider = () => ({ screenLoading: [`plan call budgets: ${3114 + n++} ms`] });
    expect(await collectDiagnostics(provider)).toEqual({ screenLoading: ['plan call budgets: 3114 ms'] });
    expect(await collectDiagnostics(provider)).toEqual({ screenLoading: ['plan call budgets: 3115 ms'] });
  });

  it('awaits an async provider', async () => {
    expect(await collectDiagnostics(async () => ({ connection: 'wifi' }))).toEqual({ connection: 'wifi' });
  });

  it('never blocks or drops a report: null on throw, timeout, or nothing usable', async () => {
    expect(await collectDiagnostics(() => { throw new Error('boom'); })).toBeNull();
    expect(await collectDiagnostics(() => Promise.reject(new Error('boom')))).toBeNull();
    expect(await collectDiagnostics(() => new Promise(() => {}), { timeoutMs: 20 })).toBeNull();
    expect(await collectDiagnostics(() => null)).toBeNull();
    expect(await collectDiagnostics(() => ['not', 'an', 'object'] as unknown as Record<string, unknown>)).toBeNull();
    expect(await collectDiagnostics(null)).toBeNull();
  });

  it('scrubs strings and drops what is not JSON', async () => {
    const out = await collectDiagnostics(() => ({ note: 'mail me at someone@example.com', fn: () => 1, nested: { list: ['a@b.co'] } }));
    expect(JSON.stringify(out)).not.toContain('someone@example.com');
    expect(JSON.stringify(out)).not.toContain('a@b.co');
    expect(out).not.toHaveProperty('fn');
  });

  it('caps the size by dropping whole keys, and says so', async () => {
    const out = (await collectDiagnostics(() => ({ small: 'ok', huge: 'x'.repeat(DIAGNOSTICS_MAX_CHARS * 2) })))!;
    expect(out).toMatchObject({ diagnosticsTruncated: true, small: 'ok' });
    expect(out).not.toHaveProperty('huge');
  });
});
