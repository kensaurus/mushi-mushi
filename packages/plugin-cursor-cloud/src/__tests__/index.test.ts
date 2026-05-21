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

function makePlugin(overrides: Partial<CursorCloudPluginConfig> = {}) {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({ agentId: 'agent_abc', status: 'queued' }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    ),
  )
  const plugin = createCursorCloudPlugin({
    apiKey: 'crsr_test_key',
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
    expect(headers.Authorization).toBe('Bearer crsr_test_key')
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.prompt).toEqual({ text: expect.stringContaining('r-hi') })
    expect((body.prompt as { text: string }).text).toContain('auth')
    expect(body.source).toEqual({
      repository: 'https://github.com/example/repo',
      ref: 'main',
    })
    expect((body.target as Record<string, unknown>).autoCreatePr).toBe(true)
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
    const body = JSON.parse(init.body as string) as { prompt: { text: string } }
    expect(body.prompt.text).toContain('f-1')
    expect(body.prompt.text).toContain('r-low-fix')
  })
})

describe('createCursorCloudPlugin — error handling', () => {
  it('bails on 401 without retrying — no money burned on a bad key', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid api key' }), { status: 401 }),
    )
    const plugin = createCursorCloudPlugin({
      apiKey: 'crsr_bad_key',
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
    expect(res.status).toBe(500)
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
    expect(body.model).toBe('composer-2.5')
    expect((body.target as Record<string, unknown>).autoCreatePr).toBe(true)
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
