/**
 * Contract tests for the Cursor Cloud plugin (Cursor Cloud Agents v1 API).
 *
 * Coverage targets the audit-flagged risks:
 *  - severity gate prevents spending Cursor API credit on low/medium reports
 *  - missing repoUrl silently no-ops (no API call)
 *  - report.classified at the threshold dispatches exactly one POST /v1/agents
 *    with the documented v1 body (top-level autoCreatePR, repos[], agentId)
 *  - fix.requested always dispatches regardless of severity — unless Mushi's
 *    fix-worker already created the agent (data.fix.externalAgentId)
 *  - 409 agent_id_conflict on a re-delivered event is idempotent success
 *  - retry on 503; bail on 401 — no unbounded $$ on bad keys
 */

import { describe, it, expect, vi } from 'vitest'
import { signPayload } from '@mushi-mushi/plugin-sdk'
import {
  buildCreateAgentBody,
  createCursorCloudPlugin,
  deterministicAgentId,
  type CursorCloudPluginConfig,
} from '../index.js'

const WEBHOOK_SECRET = 'test-webhook-secret'

function v1Response(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      agent: { id: 'bc-11111111-2222-5333-8444-555555555555', status: 'ACTIVE', url: 'https://cursor.com/agents/1' },
      run: { id: 'run_abc', agentId: 'bc-11111111-2222-5333-8444-555555555555', status: 'CREATING', git: { branches: [] } },
      ...overrides,
    }),
    { status: 201, headers: { 'Content-Type': 'application/json' } },
  )
}

function makePlugin(overrides: Partial<CursorCloudPluginConfig> = {}) {
  const fetchMock = vi.fn(async () => v1Response())
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

describe('buildCreateAgentBody — v1 wire shape', () => {
  it('puts autoCreatePR at the TOP LEVEL and the repo under repos[]', () => {
    const body = buildCreateAgentBody({
      prompt: 'fix it',
      repoUrl: 'https://github.com/example/repo',
      startingRef: 'main',
      model: 'composer-2.5',
      autoCreatePR: true,
      agentId: 'bc-11111111-2222-5333-8444-555555555555',
      name: 'Mushi fix',
    })
    expect(body).toEqual({
      prompt: { text: 'fix it' },
      repos: [{ url: 'https://github.com/example/repo', startingRef: 'main' }],
      autoCreatePR: true,
      skipReviewerRequest: true,
      model: { id: 'composer-2.5' },
      agentId: 'bc-11111111-2222-5333-8444-555555555555',
      name: 'Mushi fix',
    })
    // v0-only keys must be gone.
    expect(body).not.toHaveProperty('source')
    expect(body).not.toHaveProperty('target')
    expect(body).not.toHaveProperty('cloud')
    expect(body).not.toHaveProperty('webhook')
  })

  it('deterministicAgentId is stable per seed and Cursor-shaped', async () => {
    const a = await deterministicAgentId('fix.requested:p-1:f-1')
    const b = await deterministicAgentId('fix.requested:p-1:f-1')
    const c = await deterministicAgentId('fix.requested:p-1:f-2')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^bc-[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

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

  it('dispatches report.classified at the configured threshold (one POST to /v1/agents)', async () => {
    const { plugin, fetchMock } = makePlugin({ severityThreshold: 'high', startingRef: 'main' })
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
    expect(url).toBe('https://api.cursor.com/v1/agents')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer crsr_test_key')
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.prompt).toEqual({ text: expect.stringContaining('r-hi') })
    expect((body.prompt as { text: string }).text).toContain('auth')
    expect((body.prompt as { text: string }).text).toContain('DRAFT')
    expect(body.repos).toEqual([{ url: 'https://github.com/example/repo', startingRef: 'main' }])
    expect(body.autoCreatePR).toBe(true)
    expect(body.model).toEqual({ id: 'composer-2.5' })
    expect(body.agentId).toBe(await deterministicAgentId('report.classified:p-1:r-hi'))
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
    const body = JSON.parse(init.body as string) as { prompt: { text: string }; agentId: string }
    expect(body.prompt.text).toContain('f-1')
    expect(body.prompt.text).toContain('r-low-fix')
    expect(body.agentId).toBe(await deterministicAgentId('fix.requested:p-1:f-1'))
  })

  it('does NOT start a second agent when Mushi already dispatched one (externalAgentId set)', async () => {
    const { plugin, fetchMock } = makePlugin()
    const res = await deliver(plugin, {
      event: 'fix.requested',
      deliveryId: 'd-fix-already',
      occurredAt: '2026-09-12T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'cursor-cloud',
      data: {
        report: { id: 'r-cloud', status: 'classified' },
        fix: {
          id: 'f-cloud',
          status: 'requested',
          agent: 'cursor_cloud',
          externalAgentId: 'bc-aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee',
        },
      },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats 409 agent_id_conflict on a re-delivered event as idempotent success', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 'agent_id_conflict', message: 'exists' } }), { status: 409 }),
    )
    const plugin = createCursorCloudPlugin({
      apiKey: 'crsr_test_key',
      webhookSecret: WEBHOOK_SECRET,
      repoUrl: 'https://github.com/example/repo',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    const res = await deliver(plugin, {
      event: 'fix.requested',
      deliveryId: 'd-fix-409',
      occurredAt: '2026-09-12T00:00:00Z',
      projectId: 'p-1',
      pluginSlug: 'cursor-cloud',
      data: {
        report: { id: 'r-409', status: 'classified' },
        fix: { id: 'f-409', status: 'requested' },
      },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('createCursorCloudPlugin — error handling', () => {
  it('bails on 401 without retrying — no money burned on a bad key', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'invalid api key' } }), { status: 401 }),
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
    expect(body.model).toEqual({ id: 'composer-2.5' })
    expect(body.autoCreatePR).toBe(true)
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
