/**
 * Tests for packages/web/src/headless.ts — createHeadlessCapture.
 *
 * Verifies:
 *  - captureEvent() POSTs to /v1/reports with correct shape
 *  - API key and project ID sent on correct headers
 *  - captureException() normalises Error / string into captureEvent
 *  - Returns { ok: false } on HTTP error, never throws
 *  - Returns { ok: false } on network error, never throws
 *  - reportId extracted from response body
 *  - Custom apiEndpoint overrides DEFAULT_API_ENDPOINT
 *  - Category defaults to 'bug' when not set
 *  - Severity passed through when set
 *  - metadata and error merged into body.metadata
 *  - Public re-exports present: createConsoleCapture, createBrowserOtelSpanProcessor, etc.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createHeadlessCapture,
  createConsoleCapture,
  createNetworkCapture,
  createBrowserOtelSpanProcessor,
  DEFAULT_API_ENDPOINT,
} from './headless.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeFetch(status = 200, body: unknown = { data: { reportId: 'r-headless-1' } }) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

const BASE = { projectId: 'proj-headless', apiKey: 'mushi_pk_test_headless' }

// ── tests ─────────────────────────────────────────────────────────────────────

describe('createHeadlessCapture', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = makeFetch()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs to /v1/reports at the default endpoint', async () => {
    const capture = createHeadlessCapture(BASE)
    await capture.captureEvent({ description: 'Widget crashed' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${DEFAULT_API_ENDPOINT}/v1/reports`)
  })

  it('uses a custom apiEndpoint when provided', async () => {
    const capture = createHeadlessCapture({
      ...BASE,
      apiEndpoint: 'https://my-instance.example.com/functions/v1/api',
    })
    await capture.captureEvent({ description: 'test' })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('my-instance.example.com')
  })

  it('strips trailing slash from apiEndpoint', async () => {
    const capture = createHeadlessCapture({
      ...BASE,
      apiEndpoint: 'https://example.com/functions/v1/api/',
    })
    await capture.captureEvent({ description: 'test' })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).not.toMatch(/\/\/v1/)
    expect(url).toMatch(/\/v1\/reports$/)
  })

  it('sends X-Mushi-Api-Key and X-Mushi-Project headers', async () => {
    const capture = createHeadlessCapture(BASE)
    await capture.captureEvent({ description: 'test' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['X-Mushi-Api-Key']).toBe(BASE.apiKey)
    expect(headers['X-Mushi-Project']).toBe(BASE.projectId)
  })

  it('defaults category to bug', async () => {
    const capture = createHeadlessCapture(BASE)
    await capture.captureEvent({ description: 'some issue' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['category']).toBe('bug')
  })

  it('passes severity when set', async () => {
    const capture = createHeadlessCapture(BASE)
    await capture.captureEvent({ description: 'critical issue', severity: 'critical' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['severity']).toBe('critical')
  })

  it('merges error into body.metadata', async () => {
    const capture = createHeadlessCapture(BASE)
    await capture.captureEvent({
      description: 'oops',
      error: { name: 'TypeError', message: 'Cannot read properties', stack: 'TypeError: …' },
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    const meta = body['metadata'] as Record<string, unknown>
    expect((meta['error'] as Record<string, unknown>)['name']).toBe('TypeError')
  })

  it('returns { ok: true, reportId } on success', async () => {
    const capture = createHeadlessCapture(BASE)
    const result = await capture.captureEvent({ description: 'ok' })
    expect(result.ok).toBe(true)
    expect(result.reportId).toBe('r-headless-1')
  })

  it('returns { ok: false } on HTTP 4xx without throwing', async () => {
    vi.stubGlobal('fetch', makeFetch(403, {}))
    const capture = createHeadlessCapture(BASE)
    const result = await capture.captureEvent({ description: 'auth error' })
    expect(result.ok).toBe(false)
    expect(result.reportId).toBeUndefined()
  })

  it('returns { ok: false } on network error without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network fail')))
    const capture = createHeadlessCapture(BASE)
    const result = await capture.captureEvent({ description: 'net error' })
    expect(result.ok).toBe(false)
  })

  // captureException

  it('captureException() accepts an Error and maps to description+error', async () => {
    const capture = createHeadlessCapture(BASE)
    const err = new Error('File not found')
    err.stack = 'Error: File not found\n  at foo:1:1'
    const result = await capture.captureException(err)
    expect(result.ok).toBe(true)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['description']).toBe('File not found')
    expect(body['severity']).toBe('critical')
    const meta = body['metadata'] as Record<string, unknown>
    expect((meta['error'] as Record<string, unknown>)['name']).toBe('Error')
  })

  it('captureException() coerces a plain string', async () => {
    const capture = createHeadlessCapture(BASE)
    await capture.captureException('something broke')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['description']).toBe('something broke')
  })

  it('captureException() accepts overrides (category, severity)', async () => {
    const capture = createHeadlessCapture(BASE)
    await capture.captureException(new Error('slow'), { severity: 'medium', category: 'slow' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['severity']).toBe('medium')
    expect(body['category']).toBe('slow')
  })
})

// ── re-export surface ─────────────────────────────────────────────────────────

describe('headless re-exports', () => {
  it('exports createConsoleCapture', () => {
    expect(typeof createConsoleCapture).toBe('function')
  })

  it('exports createNetworkCapture', () => {
    expect(typeof createNetworkCapture).toBe('function')
  })

  it('exports createBrowserOtelSpanProcessor', () => {
    expect(typeof createBrowserOtelSpanProcessor).toBe('function')
  })

  it('exports DEFAULT_API_ENDPOINT as a string', () => {
    expect(typeof DEFAULT_API_ENDPOINT).toBe('string')
    expect(DEFAULT_API_ENDPOINT).toContain('supabase.co')
  })
})
