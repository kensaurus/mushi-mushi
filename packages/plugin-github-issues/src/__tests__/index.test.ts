import { describe, it, expect, vi } from 'vitest'
import { createGithubIssuesPlugin, type GithubIssueCache } from '../index.js'
import { signPayload } from '@mushi-mushi/plugin-sdk'

const SECRET = 'test-secret'

function deliver(plugin: ReturnType<typeof createGithubIssuesPlugin>, body: unknown) {
  const raw = JSON.stringify(body)
  return plugin({ rawBody: raw, headers: { 'x-mushi-signature': signPayload(SECRET, raw) } })
}

describe('createGithubIssuesPlugin', () => {
  function makePlugin(overrides: Partial<Parameters<typeof createGithubIssuesPlugin>[0]> = {}) {
    const fetchMock = vi
      .fn()
      // ensureMushiLabel GET — label exists
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      // createIssue POST
      .mockResolvedValueOnce(new Response(JSON.stringify({ number: 42 }), { status: 201 }))

    const plugin = createGithubIssuesPlugin({
      token: 'ghp_test-token',
      owner: 'acme',
      repo: 'my-app',
      adminBaseUrl: 'https://admin.example.com',
      mushiSecret: SECRET,
      fetchImpl: fetchMock as unknown as typeof fetch,
      ...overrides,
    })
    return { plugin, fetchMock }
  }

  it('creates a GitHub issue on report.classified', async () => {
    const { plugin, fetchMock } = makePlugin()
    const res = await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-1',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'github-issues',
      data: {
        report: { id: 'r-1', status: 'classified', title: 'Login page crashes on submit' },
        classification: { severity: 'high', category: 'crash', confidence: 0.92 },
      },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [issueUrl, issueInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(issueUrl).toBe('https://api.github.com/repos/acme/my-app/issues')
    expect(issueInit.method).toBe('POST')
    expect((issueInit.headers as Record<string, string>)['Authorization']).toBe('Bearer ghp_test-token')
    const issueBody = JSON.parse(issueInit.body as string) as {
      title: string
      labels: string[]
      body: string
    }
    expect(issueBody.title).toBe('Login page crashes on submit')
    expect(issueBody.labels).toContain('mushi-bug')
    expect(issueBody.body).toContain('r-1')
    expect(issueBody.body).toContain('high')
  })

  it('creates the mushi-bug label when it does not exist', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'mushi-bug' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ number: 7 }), { status: 201 }))

    const plugin = createGithubIssuesPlugin({
      token: 'ghp_test-token',
      owner: 'acme',
      repo: 'my-app',
      adminBaseUrl: 'https://admin.example.com',
      mushiSecret: SECRET,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-2',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'github-issues',
      data: {
        report: { id: 'r-2', status: 'classified' },
        classification: { severity: 'medium', category: 'ui', confidence: 0.7 },
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const [labelUrl, labelInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(labelUrl).toContain('/labels')
    expect(labelInit.method).toBe('POST')
    const labelBody = JSON.parse(labelInit.body as string) as { name: string; color: string }
    expect(labelBody.name).toBe('mushi-bug')
    expect(labelBody.color).toBe('e11d48')
  })

  it('closes the GitHub issue on fix.applied when issue number is cached', async () => {
    const mockCache: GithubIssueCache = {
      get: vi.fn().mockResolvedValue(99),
      set: vi.fn(),
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const plugin = createGithubIssuesPlugin(
      {
        token: 'ghp_test-token',
        owner: 'acme',
        repo: 'my-app',
        adminBaseUrl: 'https://admin.example.com',
        mushiSecret: SECRET,
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
      mockCache,
    )

    await deliver(plugin, {
      event: 'fix.applied',
      deliveryId: 'd-3',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'github-issues',
      data: {
        report: { id: 'r-1', status: 'fixed' },
        fix: { id: 'f-1', status: 'merged' },
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/issues/99')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['state']).toBe('closed')
  })

  it('skips fix.applied when no issue number is cached', async () => {
    const mockCache: GithubIssueCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
    }
    const fetchMock = vi.fn()
    const plugin = createGithubIssuesPlugin(
      {
        token: 'ghp_test-token',
        owner: 'acme',
        repo: 'my-app',
        adminBaseUrl: 'https://admin.example.com',
        mushiSecret: SECRET,
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
      mockCache,
    )

    await deliver(plugin, {
      event: 'fix.applied',
      deliveryId: 'd-4',
      occurredAt: '2026-04-17T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'github-issues',
      data: {
        report: { id: 'r-missing', status: 'fixed' },
        fix: { id: 'f-2', status: 'merged' },
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
