import { describe, it, expect, vi } from 'vitest'
import { createCrashlyticsPlugin } from '../index.js'
import { signPayload } from '@mushi-mushi/plugin-sdk'

const SECRET = 'test-secret'

function deliver(plugin: ReturnType<typeof createCrashlyticsPlugin>, body: unknown) {
  const raw = JSON.stringify(body)
  return plugin({ rawBody: raw, headers: { 'x-mushi-signature': signPayload(SECRET, raw) } })
}

describe('createCrashlyticsPlugin', () => {
  it('returns a valid plugin handler (factory contract)', () => {
    const plugin = createCrashlyticsPlugin({
      projectId: 'proj-123',
      appId: '1:123:android:abc',
      serviceAccountEmail: 'sa@proj.iam.gserviceaccount.com',
      adminBaseUrl: 'https://admin.example.com',
      mushiSecret: SECRET,
      accessToken: 'test-token',
    })
    expect(typeof plugin).toBe('function')
  })

  it('calls Remote Config GET and PUT on fix.applied', async () => {
    const getResponse = new Response(
      JSON.stringify({ parameters: {}, conditions: [] }),
      { status: 200, headers: { etag: '"etag-1"' } },
    )
    const putResponse = new Response('{}', { status: 200 })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(getResponse)
      .mockResolvedValueOnce(putResponse)

    const plugin = createCrashlyticsPlugin({
      projectId: 'my-firebase-project',
      appId: '1:999:android:deadbeef',
      serviceAccountEmail: 'sa@my-firebase-project.iam.gserviceaccount.com',
      adminBaseUrl: 'https://admin.example.com',
      mushiSecret: SECRET,
      accessToken: 'ya29.test-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    const res = await deliver(plugin, {
      event: 'fix.applied',
      deliveryId: 'd-1',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'crashlytics',
      data: {
        report: { id: 'r-abc123', status: 'fixed' },
        fix: { id: 'f-1', status: 'merged' },
      },
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [getUrl, getInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(getUrl).toContain('firebaseremoteconfig.googleapis.com')
    expect(getUrl).toContain('my-firebase-project')
    expect((getInit.headers as Record<string, string>)['Authorization']).toBe('Bearer ya29.test-token')

    const [putUrl, putInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(putUrl).toContain('remoteConfig')
    expect(putInit.method).toBe('PUT')
    const putBody = JSON.parse(putInit.body as string) as {
      parameters: Record<string, { defaultValue: { value: string } }>
    }
    const paramKey = Object.keys(putBody.parameters).find((k) => k.startsWith('mushi_resolved_'))
    expect(paramKey).toBeDefined()
    expect(putBody.parameters[paramKey!]?.defaultValue.value).toBe('true')
  })

  it('also closes the Crashlytics issue when crashlyticsIssueId is present', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ parameters: {} }), { status: 200, headers: { etag: '"e"' } }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    const plugin = createCrashlyticsPlugin({
      projectId: 'my-firebase-project',
      appId: '1:999:android:deadbeef',
      serviceAccountEmail: 'sa@proj.iam.gserviceaccount.com',
      adminBaseUrl: 'https://admin.example.com',
      mushiSecret: SECRET,
      accessToken: 'ya29.test-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    await deliver(plugin, {
      event: 'fix.applied',
      deliveryId: 'd-2',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'crashlytics',
      data: {
        report: { id: 'r-abc123', status: 'fixed' },
        fix: { id: 'f-1', status: 'merged' },
        crashlyticsIssueId: 'crash-issue-xyz',
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [closeUrl, closeInit] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(closeUrl).toContain('crash-issue-xyz')
    expect(closeInit.method).toBe('PATCH')
    const closeBody = JSON.parse(closeInit.body as string) as Record<string, unknown>
    expect(closeBody['state']).toBe('CLOSED')
  })
})
