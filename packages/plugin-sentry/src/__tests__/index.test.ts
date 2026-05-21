import { describe, it, expect, vi } from 'vitest'
import { createSentryPlugin, __testing } from '../index.js'
import { signPayload } from '@mushi-mushi/plugin-sdk'

const SECRET = 'test-secret'
const DSN = 'https://abc123@o12345.ingest.sentry.io/67890'

function deliver(plugin: ReturnType<typeof createSentryPlugin>, body: unknown) {
  const raw = JSON.stringify(body)
  return plugin({ rawBody: raw, headers: { 'x-mushi-signature': signPayload(SECRET, raw) } })
}

describe('parseDsn', () => {
  it('extracts store URL, project id, and auth header from a valid DSN', () => {
    const parts = __testing.parseDsn(DSN)
    expect(parts.projectId).toBe('67890')
    expect(parts.storeUrl).toBe('https://o12345.ingest.sentry.io/api/67890/store/')
    expect(parts.authHeader).toContain('sentry_key=abc123')
    expect(parts.authHeader).toContain('sentry_version=7')
  })

  it('throws on a DSN missing the public key', () => {
    expect(() => __testing.parseDsn('https://o12345.ingest.sentry.io/67890')).toThrow(/missing public key/)
  })
})

describe('createSentryPlugin', () => {
  function makePlugin(overrides: Partial<Parameters<typeof createSentryPlugin>[0]> = {}) {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const plugin = createSentryPlugin({
      sentryDsn: DSN,
      mushiSecret: SECRET,
      fetchImpl: fetchMock as unknown as typeof fetch,
      ...overrides,
    })
    return { plugin, fetchMock }
  }

  it('captures high-severity classified events into Sentry', async () => {
    const { plugin, fetchMock } = makePlugin()
    const res = await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-1',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'sentry',
      data: { report: { id: 'r-1', status: 'classified' }, classification: { severity: 'critical', category: 'bug', confidence: 0.9 } },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/store\/$/)
    const body = JSON.parse(init.body as string)
    expect(body.fingerprint).toEqual(['mushi', 'p-1', 'r-1'])
    expect(body.level).toBe('fatal')
    expect(body.tags['mushi.report_id']).toBe('r-1')
  })

  it('skips classified events below the severity threshold', async () => {
    const { plugin, fetchMock } = makePlugin({ severityThreshold: 'critical' })
    await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-2',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'sentry',
      data: { report: { id: 'r-2', status: 'classified' }, classification: { severity: 'high', category: 'bug', confidence: 0.5 } },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('captures fix.applied as info and skips resolve when no token', async () => {
    const { plugin, fetchMock } = makePlugin()
    await deliver(plugin, {
      event: 'fix.applied',
      deliveryId: 'd-3',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'sentry',
      data: { report: { id: 'r-3', status: 'fixed' }, fix: { id: 'f-1', status: 'merged', pullRequestUrl: 'https://github.com/x/y/pull/1' } },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.level).toBe('info')
    expect(body.tags['mushi.fixed']).toBe('true')
    expect(body.tags['mushi.pr_url']).toBe('https://github.com/x/y/pull/1')
  })

  it('also calls the issues API to resolve when an auth token is configured', async () => {
    const { plugin, fetchMock } = makePlugin({
      sentryAuthToken: 'tok-123',
      sentryOrgSlug: 'acme',
      sentryProjectSlug: 'web',
    })
    await deliver(plugin, {
      event: 'fix.applied',
      deliveryId: 'd-4',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'sentry',
      data: { report: { id: 'r-4', status: 'fixed' }, fix: { id: 'f-2', status: 'merged' } },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [resolveUrl, resolveInit] = fetchMock.mock.calls[1]
    expect(resolveUrl).toContain('/api/0/projects/acme/web/issues/')
    expect(resolveUrl).toContain('mushi.report_id%3Ar-4')
    expect(resolveInit.method).toBe('PUT')
    expect(resolveInit.headers.Authorization).toBe('Bearer tok-123')
    const resolveBody = JSON.parse(resolveInit.body as string)
    expect(resolveBody.status).toBe('resolved')
  })

  it('ignores fix.proposed unless markInProgress is set', async () => {
    const { plugin, fetchMock } = makePlugin()
    await deliver(plugin, {
      event: 'fix.proposed',
      deliveryId: 'd-5',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'sentry',
      data: { report: { id: 'r-5', status: 'fix_proposed' }, fix: { id: 'f-3', status: 'open' } },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('annotates fix.proposed when markInProgress is true', async () => {
    const { plugin, fetchMock } = makePlugin({ markInProgress: true })
    await deliver(plugin, {
      event: 'fix.proposed',
      deliveryId: 'd-6',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'sentry',
      data: { report: { id: 'r-6', status: 'fix_proposed' }, fix: { id: 'f-4', status: 'open' } },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.level).toBe('info')
  })
})

// ---------------------------------------------------------------------------
// User Feedback API (Round 8 backlog item B14)
//
// This is the *preferred* path when an org auth token is available and the
// Mushi report carries a `sentry_event_id` from the originating browser
// capture. The legacy Store fallback is exercised by the existing tests
// above; these tests lock in the User Feedback path so we don't regress.
// ---------------------------------------------------------------------------

describe('createSentryPlugin — Sentry User Feedback API', () => {
  function makePluginWithAuth(overrides: Partial<Parameters<typeof createSentryPlugin>[0]> = {}) {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const plugin = createSentryPlugin({
      sentryDsn: DSN,
      mushiSecret: SECRET,
      sentryAuthToken: 'tok-feedback',
      sentryOrgSlug: 'acme',
      sentryProjectSlug: 'web',
      fetchImpl: fetchMock as unknown as typeof fetch,
      ...overrides,
    })
    return { plugin, fetchMock }
  }

  it('POSTs to /user-feedback/ when auth token + sentry_event_id are both available', async () => {
    const { plugin, fetchMock } = makePluginWithAuth()
    await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-uf-1',
      occurredAt: '2026-05-21T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'sentry',
      data: {
        report: { id: 'r-uf-1', status: 'classified', sentry_event_id: 'abcdef0123456789abcdef0123456789' },
        classification: { severity: 'critical', category: 'bug', confidence: 0.93, tags: ['auth', 'api'] },
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://sentry.io/api/0/projects/acme/web/user-feedback/')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok-feedback')
    const body = JSON.parse(init.body as string)
    expect(body.event_id).toBe('abcdef0123456789abcdef0123456789')
    expect(body.name).toBe('Mushi Mushi')
    expect(body.email).toBe('noreply@mushi-mushi.io')
    expect(body.comments).toContain('CRITICAL')
    expect(body.comments).toContain('Category: bug')
    expect(body.comments).toContain('Confidence: 93%')
  })

  it('treats a 409 conflict as success (idempotent re-delivery)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"detail":"already exists"}', { status: 409 }))
    const plugin = createSentryPlugin({
      sentryDsn: DSN,
      mushiSecret: SECRET,
      sentryAuthToken: 'tok-feedback',
      sentryOrgSlug: 'acme',
      sentryProjectSlug: 'web',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    const res = await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-uf-conflict',
      occurredAt: '2026-05-21T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'sentry',
      data: {
        report: { id: 'r-uf-conflict', status: 'classified', sentry_event_id: 'aaaabbbbccccddddeeeeffff00001111' },
        classification: { severity: 'critical', category: 'bug', confidence: 0.5 },
      },
    })
    expect(res.status).toBe(200)
  })

  it('throws on a 401 from the User Feedback API (so plugin handler returns 500 + dispatcher retries)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"detail":"bad token"}', { status: 401 }))
    const plugin = createSentryPlugin({
      sentryDsn: DSN,
      mushiSecret: SECRET,
      sentryAuthToken: 'tok-bad',
      sentryOrgSlug: 'acme',
      sentryProjectSlug: 'web',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    const res = await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-uf-401',
      occurredAt: '2026-05-21T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'sentry',
      data: {
        report: { id: 'r-uf-401', status: 'classified', sentry_event_id: '0011223344556677889900112233aabb' },
        classification: { severity: 'critical', category: 'bug', confidence: 0.9 },
      },
    })
    expect(res.status).toBe(500)
  })

  it('falls back to the Store endpoint when sentry_event_id is missing (no User Feedback link target)', async () => {
    const { plugin, fetchMock } = makePluginWithAuth()
    await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-no-event-id',
      occurredAt: '2026-05-21T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'sentry',
      data: {
        report: { id: 'r-no-event-id', status: 'classified' /* no sentry_event_id */ },
        classification: { severity: 'critical', category: 'bug', confidence: 0.9 },
      },
    })
    const [url] = fetchMock.mock.calls[0]
    expect(url).toMatch(/store\/$/)
  })

  it('falls back to Store endpoint when auth token is absent even if sentry_event_id is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const plugin = createSentryPlugin({
      sentryDsn: DSN,
      mushiSecret: SECRET,
      // No sentryAuthToken / org / project
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-no-token',
      occurredAt: '2026-05-21T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'sentry',
      data: {
        report: { id: 'r-no-token', status: 'classified', sentry_event_id: 'cafebabecafebabecafebabecafebabe' },
        classification: { severity: 'critical', category: 'bug', confidence: 0.9 },
      },
    })
    const [url] = fetchMock.mock.calls[0]
    expect(url).toMatch(/store\/$/)
  })
})
