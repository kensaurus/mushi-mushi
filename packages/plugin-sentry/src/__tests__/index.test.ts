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
