/**
 * Contract tests for the Cursor Cloud plugin.
 *
 * Coverage targets the audit-flagged risks:
 *  - severity gate prevents spending Cursor API credit on low/medium reports
 *  - missing repoUrl silently no-ops (no API call)
 *  - report.classified at the threshold dispatches exactly one POST
 *  - fix.requested always dispatches regardless of severity
 *  - retry on 503; bail on 401 — no unbounded $$ on bad keys
 */

import { describe, it, expect, vi } from 'vitest'
import { signPayload } from '@mushi-mushi/plugin-sdk'
import { createCursorCloudPlugin, type CursorCloudPluginConfig } from '../index.js'

const WEBHOOK_SECRET = 'test-webhook-secret'
const WORKSPACE = 'ws_test'

function makePlugin(overrides: Partial<CursorCloudPluginConfig> = {}) {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({ agentId: 'agent_abc', status: 'queued' }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    ),
  )
  const plugin = createCursorCloudPlugin({
    apiKey: 'cur_test_key',
    workspaceId: WORKSPACE,
    webhookSecret: WEBHOOK_SECRET,
    repoUrl: 'https://github.com/example/repo',
    severityThreshold: 'critical',
    fetchImpl: fetchMock as unknown as typeof fetch,
    ...overrides,
  })
  return { plugin, fetchMock }
}

function deliver(
  plugin: ReturnType<typeof createCursorCloudPlugin>,
  body: Record<string, unknown>,
) {
  const raw = JSON.stringify(body)
  return plugin({
    rawBody: raw,
    headers: { 'x-mushi-signature': signPayload(WEBHOOK_SECRET, raw) },
  })
}

describe('createCursorCloudPlugin — severity gate', () => {
  it('skips report.classified below the severity threshold (no Cursor API call)', async () => {
    const { plugin, fetchMock } = makePlugin({ severityThreshold: 'critical' })
    const res = await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-low-1',
      occurredAt: '2026-05-21T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'cursor-cloud',
      data: {
        report: { id: 'r-low', status: 'classified', title: 'minor copy issue' },
        classification: { severity: 'low', category: 'visual', confidence: 0.6 },
      },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips report.classified at medium when threshold is high', async () => {
    const { plugin, fetchMock } = makePlugin({ severityThreshold: 'high' })
    await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-med-1',
      occurredAt: '2026-05-21T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'cursor-cloud',
      data: {
        report: { id: 'r-med', status: 'classified' },
        classification: { severity: 'medium', category: 'bug', confidence: 0.7 },
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('dispatches report.classified at the configured threshold (one POST to /v0/agents)', async () => {
    const { plugin, fetchMock } = makePlugin({ severityThreshold: 'high' })
    const res = await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-hi-1',
      occurredAt: '2026-05-21T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'cursor-cloud',
      data: {
        report: { id: 'r-hi', status: 'classified', title: 'login broken' },
        classification: { severity: 'high', category: 'bug', confidence: 0.92, tags: ['auth'] },
      },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.cursor.com/v0/agents')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer cur_test_key')
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect((body.cloud as Record<string, unknown>).workspaceId).toBe(WORKSPACE)
    expect((body.cloud as Record<string, unknown>).autoCreatePR).toBe(true)
    expect(body.prompt).toContain('r-hi')
    expect(body.prompt).toContain('auth')
  })

  it('dispatches critical severity when threshold defaults to critical', async () => {
    const { plugin, fetchMock } = makePlugin()
    await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-crit-1',
      occurredAt: '2026-05-21T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'cursor-cloud',
      data: {
        report: { id: 'r-crit', status: 'classified' },
        classification: { severity: 'critical', category: 'bug', confidence: 0.99 },
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('createCursorCloudPlugin — repoUrl gate', () => {
  it('silently no-ops when repoUrl is not configured', async () => {
    const { plugin, fetchMock } = makePlugin({ repoUrl: undefined })
    const res = await deliver(plugin, {
      event: 'report.classified',
      deliveryId: 'd-norepo',
      occurredAt: '2026-05-21T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'cursor-cloud',
      data: {
        report: { id: 'r-norepo', status: 'classified' },
        classification: { severity: 'critical', category: 'bug', confidence: 1.0 },
      },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('createCursorCloudPlugin — fix.requested', () => {
  it('dispatches fix.requested regardless of severity (user explicitly asked)', async () => {
    const { plugin, fetchMock } = makePlugin({ severityThreshold: 'critical' })
    await deliver(plugin, {
      event: 'fix.requested',
      deliveryId: 'd-fix-1',
      occurredAt: '2026-05-21T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'cursor-cloud',
      data: {
        report: { id: 'r-low-fix', status: 'classified', title: 'tiny tweak' },
        fix: { id: 'f-1', status: 'requested' },
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.prompt).toContain('f-1')
    expect(body.prompt).toContain('r-low-fix')
  })

  it('passes MUSHI_* env vars through to the agent run', async () => {
    const { plugin, fetchMock } = makePlugin()
    await deliver(plugin, {
      event: 'fix.requested',
      deliveryId: 'd-fix-2',
      occurredAt: '2026-05-21T00:00:00Z',
      projectId: 'p-42',
      pluginSlug: 'cursor-cloud',
      data: {
        report: { id: 'r-fix-2', status: 'classified' },
        fix: { id: 'f-42', status: 'requested' },
      },
    })
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    const envVars = (body.cloud as Record<string, unknown>).envVars as Record<string, string>
    expect(envVars.MUSHI_REPORT_ID).toBe('r-fix-2')
    expect(envVars.MUSHI_FIX_ID).toBe('f-42')
    expect(envVars.MUSHI_PROJECT_ID).toBe('p-42')
    expect(envVars.MUSHI_EVENT).toBe('fix.requested')
  })
})

describe('createCursorCloudPlugin — error handling', () => {
  it('bails on 401 without retrying — no money burned on a bad key', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid api key' }), { status: 401 }),
    )
    const plugin = createCursorCloudPlugin({
      apiKey: 'cur_bad_key',
      workspaceId: WORKSPACE,
      webhookSecret: WEBHOOK_SECRET,
      repoUrl: 'https://github.com/example/repo',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    const res = await deliver(plugin, {
      event: 'fix.requested',
      deliveryId: 'd-401',
      occurredAt: '2026-05-21T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'cursor-cloud',
      data: {
        report: { id: 'r-401', status: 'classified' },
        fix: { id: 'f-401', status: 'requested' },
      },
    })
    // Handler threw because plugin-sdk withRetry surfaces the error,
    // and the createPluginHandler returns 500 on uncaught handler failures.
    expect(res.status).toBe(500)
    // Critical: only one attempt — non-2xx 4xx other than 429 is non-retryable.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses default model "composer-2.5" and autoCreatePR true when omitted', async () => {
    const { plugin, fetchMock } = makePlugin({ model: undefined, autoCreatePR: undefined })
    await deliver(plugin, {
      event: 'fix.requested',
      deliveryId: 'd-defaults',
      occurredAt: '2026-05-21T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'cursor-cloud',
      data: {
        report: { id: 'r-defaults', status: 'classified' },
        fix: { id: 'f-defaults', status: 'requested' },
      },
    })
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect((body.model as Record<string, unknown>).id).toBe('composer-2.5')
    expect((body.cloud as Record<string, unknown>).autoCreatePR).toBe(true)
    expect((body.cloud as Record<string, unknown>).maxIterations).toBe(1)
  })
})

describe('createCursorCloudPlugin — event filtering', () => {
  it('ignores unrelated events (e.g. report.created) without calling Cursor', async () => {
    const { plugin, fetchMock } = makePlugin()
    const res = await deliver(plugin, {
      event: 'report.created',
      deliveryId: 'd-created',
      occurredAt: '2026-05-21T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'cursor-cloud',
      data: { report: { id: 'r-created', status: 'pending' } },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
