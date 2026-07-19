/**
 * Tests for packages/web/src/otel.ts — createBrowserOtelSpanProcessor.
 *
 * Verifies:
 *  - Returns a no-op processor when otelPresent is absent/null
 *  - Emits console.warn (once) when otelPresent is absent
 *  - No-op processor interface is complete and promise-safe
 *  - Error spans (status.code === 2) call mushiInstance.report()
 *  - Non-error spans are skipped when errorsOnly is true (default)
 *  - report() is fired-and-forgotten (onEnd returns synchronously)
 *  - exception.message / error.message attributes extracted correctly
 *  - Fallback description uses span.name when no message attribute
 *  - Traceparent composed from span traceId+spanId is included in metadata
 *  - Errors inside onEnd() are caught silently (never propagate)
 *  - shutdown() and forceFlush() resolve without rejecting
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserOtelSpanProcessor } from './otel.js'
import type { BrowserOtelSpan } from './otel.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeSpan(overrides: Partial<BrowserOtelSpan> = {}): BrowserOtelSpan {
  return {
    status: { code: 0 },
    attributes: {},
    name: 'GET /api/test',
    spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }),
    startTime: [0, 0],
    endTime: [1, 0],
    ...overrides,
  }
}

function makeErrorSpan(overrides: Partial<BrowserOtelSpan> = {}): BrowserOtelSpan {
  return makeSpan({ status: { code: 2 }, ...overrides })
}

/** Minimal Mushi-like stub that records captureEvent() calls. */
function makeMushiStub() {
  return { captureEvent: vi.fn().mockResolvedValue('r-1') }
}

// ── no-op path (otelPresent absent) ──────────────────────────────────────────

describe('createBrowserOtelSpanProcessor — otelPresent absent', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // Reset the module-level "warnedMissing" flag between tests by
    // re-importing via a fresh module instance is not possible in Vitest
    // without resetModules, so we just accept that warn fires once per
    // test file run. The single-warn invariant is verified in its own test.
  })

  it('returns a processor with the full interface', () => {
    const stub = makeMushiStub()
    const p = createBrowserOtelSpanProcessor(stub as never)
    expect(typeof p.onStart).toBe('function')
    expect(typeof p.onEnd).toBe('function')
    expect(typeof p.shutdown).toBe('function')
    expect(typeof p.forceFlush).toBe('function')
  })

  it('no-op processor shutdown() and forceFlush() resolve', async () => {
    const stub = makeMushiStub()
    const p = createBrowserOtelSpanProcessor(stub as never)
    await expect(p.shutdown()).resolves.toBeUndefined()
    await expect(p.forceFlush()).resolves.toBeUndefined()
  })

  it('no-op processor never calls mushiInstance.report()', () => {
    const stub = makeMushiStub()
    const p = createBrowserOtelSpanProcessor(stub as never)
    p.onEnd(makeErrorSpan())
    expect(stub.captureEvent).not.toHaveBeenCalled()
  })

  it('emits console.warn (at least once per cold module) when otelPresent is absent', async () => {
    // The module-level `warnedMissing` flag means the warning fires once per
    // module lifetime, not once per call. We get a fresh module instance via
    // resetModules + dynamic re-import to guarantee we catch that first call.
    vi.resetModules()
    const { createBrowserOtelSpanProcessor: fresh } = await import('./otel.js') as typeof import('./otel.js')
    const stub = makeMushiStub()
    fresh(stub as never)
    expect(warnSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls[0]![0]).toContain('otelPresent')
  })
})

// ── active processor path (otelPresent supplied) ─────────────────────────────

describe('createBrowserOtelSpanProcessor — otelPresent supplied', () => {
  // Simulate the caller passing { otelPresent: context } from @opentelemetry/api.
  // We use a plain object — the factory only checks truthiness.
  const OTEL_SENTINEL = { context: 'stub' }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does NOT call report() for non-error spans (errorsOnly default)', () => {
    const stub = makeMushiStub()
    const p = createBrowserOtelSpanProcessor(stub as never, { otelPresent: OTEL_SENTINEL })
    p.onEnd(makeSpan({ status: { code: 0 } }))
    expect(stub.captureEvent).not.toHaveBeenCalled()
  })

  it('does NOT call report() for OK spans (status.code === 1)', () => {
    const stub = makeMushiStub()
    const p = createBrowserOtelSpanProcessor(stub as never, { otelPresent: OTEL_SENTINEL })
    p.onEnd(makeSpan({ status: { code: 1 } }))
    expect(stub.captureEvent).not.toHaveBeenCalled()
  })

  it('calls report() for error spans (status.code === 2)', () => {
    const stub = makeMushiStub()
    const p = createBrowserOtelSpanProcessor(stub as never, { otelPresent: OTEL_SENTINEL })
    p.onEnd(makeErrorSpan({ attributes: { 'exception.message': 'DB timeout' } }))
    expect(stub.captureEvent).toHaveBeenCalledOnce()
    const [[args]] = stub.captureEvent.mock.calls as [[Record<string, unknown>]]
    expect(args['description']).toBe('DB timeout')
    expect(args['category']).toBe('bug')
  })

  it('extracts error.message when exception.message is absent', () => {
    const stub = makeMushiStub()
    const p = createBrowserOtelSpanProcessor(stub as never, { otelPresent: OTEL_SENTINEL })
    p.onEnd(makeErrorSpan({ attributes: { 'error.message': 'Connection refused' } }))
    const [[args]] = stub.captureEvent.mock.calls as [[Record<string, unknown>]]
    expect(args['description']).toBe('Connection refused')
  })

  it('falls back to span.name when no message attribute is present', () => {
    const stub = makeMushiStub()
    const p = createBrowserOtelSpanProcessor(stub as never, { otelPresent: OTEL_SENTINEL })
    p.onEnd(makeErrorSpan({ name: 'POST /api/checkout', attributes: {} }))
    const [[args]] = stub.captureEvent.mock.calls as [[Record<string, unknown>]]
    expect(args['description']).toBe('OTel error span: POST /api/checkout')
  })

  it('includes W3C traceparent in metadata', () => {
    const stub = makeMushiStub()
    const p = createBrowserOtelSpanProcessor(stub as never, { otelPresent: OTEL_SENTINEL })
    p.onEnd(makeErrorSpan({
      spanContext: () => ({ traceId: '1'.repeat(32), spanId: '2'.repeat(16) }),
    }))
    const [[args]] = stub.captureEvent.mock.calls as [[Record<string, unknown>]]
    expect((args['metadata'] as Record<string, string>)['traceparent']).toBe(
      `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`,
    )
  })

  it('includes otelSpanName and otelAttributes in metadata', () => {
    const stub = makeMushiStub()
    const p = createBrowserOtelSpanProcessor(stub as never, { otelPresent: OTEL_SENTINEL })
    p.onEnd(makeErrorSpan({
      name: 'fetchUser',
      attributes: { 'exception.message': 'err', 'db.type': 'postgres' },
    }))
    const [[args]] = stub.captureEvent.mock.calls as [[Record<string, unknown>]]
    const meta = args['metadata'] as Record<string, unknown>
    expect(meta['otelSpanName']).toBe('fetchUser')
    expect((meta['otelAttributes'] as Record<string, unknown>)['db.type']).toBe('postgres')
  })

  it('captureEvent() is called fire-and-forget — onEnd returns synchronously', () => {
    // captureEvent() never resolves in this test — if onEnd awaited it the
    // test would hang. The fact that it returns immediately proves void handling.
    const stub = { captureEvent: vi.fn().mockReturnValue(new Promise(() => {})) }
    const p = createBrowserOtelSpanProcessor(stub as never, { otelPresent: OTEL_SENTINEL })
    // Should return synchronously even with a never-resolving promise.
    const result = p.onEnd(makeErrorSpan())
    expect(result).toBeUndefined()
  })

  it('never throws even when captureEvent() rejects', () => {
    const stub = { captureEvent: vi.fn().mockRejectedValue(new Error('network')) }
    const p = createBrowserOtelSpanProcessor(stub as never, { otelPresent: OTEL_SENTINEL })
    expect(() => p.onEnd(makeErrorSpan())).not.toThrow()
  })

  it('never throws when onEnd itself throws internally', () => {
    const stub = {
      captureEvent: vi.fn().mockImplementation(() => { throw new Error('internal crash') }),
    }
    const p = createBrowserOtelSpanProcessor(stub as never, { otelPresent: OTEL_SENTINEL })
    expect(() => p.onEnd(makeErrorSpan())).not.toThrow()
  })

  it('onStart is a no-op', () => {
    const stub = makeMushiStub()
    const p = createBrowserOtelSpanProcessor(stub as never, { otelPresent: OTEL_SENTINEL })
    expect(() => p.onStart(makeSpan(), {})).not.toThrow()
    expect(stub.captureEvent).not.toHaveBeenCalled()
  })

  it('shutdown() and forceFlush() resolve', async () => {
    const stub = makeMushiStub()
    const p = createBrowserOtelSpanProcessor(stub as never, { otelPresent: OTEL_SENTINEL })
    await expect(p.shutdown()).resolves.toBeUndefined()
    await expect(p.forceFlush()).resolves.toBeUndefined()
  })
})
