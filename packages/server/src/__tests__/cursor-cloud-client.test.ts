/**
 * FILE: cursor-cloud-client.test.ts
 * PURPOSE: Pin the Cursor Cloud Agents v1 wire shape and the v0 webhook
 *          contract in `_shared/cursor-cloud.ts` against the official
 *          OpenAPI (cursor.com/docs-static/cloud-agents-openapi.yaml):
 *          top-level autoCreatePR, repos[], bc-<uuid> agentId idempotency
 *          (409 agent_id_conflict), run-status mapping, PR URL extraction,
 *          and the sha256=<hex> HMAC over the raw v0 webhook body.
 */

import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  CURSOR_AGENT_ID_RE,
  CursorApiError,
  buildCreateAgentV0Body,
  buildCreateAgentV1Body,
  buildV0WebhookSecret,
  cancelCursorRun,
  createCursorAgentV1,
  deterministicCursorAgentId,
  extractCursorBranch,
  extractCursorPrUrl,
  getCursorRun,
  mapCursorRunStatus,
  verifyV0WebhookSignature,
} from '../../supabase/functions/_shared/cursor-cloud.ts'

const AGENT_ID = 'bc-11111111-2222-5333-8444-555555555555'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fetchMockReturning(body: unknown, status = 200) {
  return vi.fn(async () => jsonResponse(body, status)) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

describe('buildCreateAgentV1Body', () => {
  it('matches the documented v1 shape (autoCreatePR top-level, repos[], model.id, agentId)', () => {
    const body = buildCreateAgentV1Body({
      prompt: 'fix the bug',
      repoUrl: 'https://github.com/org/repo',
      startingRef: 'main',
      agentId: AGENT_ID,
      name: 'Mushi fix',
      model: 'composer-2.5',
      autoCreatePR: true,
      skipReviewerRequest: true,
      envVars: { MUSHI_REPORT_ID: 'r-1' },
    })
    expect(body).toEqual({
      prompt: { text: 'fix the bug' },
      repos: [{ url: 'https://github.com/org/repo', startingRef: 'main' }],
      autoCreatePR: true,
      agentId: AGENT_ID,
      name: 'Mushi fix',
      model: { id: 'composer-2.5' },
      skipReviewerRequest: true,
      envVars: { MUSHI_REPORT_ID: 'r-1' },
    })
    expect(body).not.toHaveProperty('cloud')
    expect(body).not.toHaveProperty('source')
    expect(body).not.toHaveProperty('target')
  })

  it('defaults autoCreatePR to true and omits optional keys', () => {
    const body = buildCreateAgentV1Body({ prompt: 'x', repoUrl: 'https://github.com/o/r' })
    expect(body).toEqual({ prompt: { text: 'x' }, repos: [{ url: 'https://github.com/o/r' }], autoCreatePR: true })
  })
})

describe('createCursorAgentV1', () => {
  it('POSTs /v1/agents with a Bearer key and returns agent + run', async () => {
    const fetchImpl = fetchMockReturning({
      agent: { id: AGENT_ID, status: 'ACTIVE', url: 'https://cursor.com/agents/x', latestRunId: 'run_1' },
      run: { id: 'run_1', agentId: AGENT_ID, status: 'CREATING', git: { branches: [] } },
    }, 201)
    const res = await createCursorAgentV1(
      { apiKey: 'crsr_key', fetchImpl },
      { prompt: 'p', repoUrl: 'https://github.com/o/r', agentId: AGENT_ID },
    )
    expect(res.agent.id).toBe(AGENT_ID)
    expect(res.run.id).toBe('run_1')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.cursor.com/v1/agents')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer crsr_key')
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toMatchObject({ agentId: AGENT_ID, autoCreatePR: true })
  })

  it('maps 409 agent_id_conflict to a CursorApiError with the code', async () => {
    const fetchImpl = fetchMockReturning({ error: { code: 'agent_id_conflict', message: 'exists' } }, 409)
    await expect(
      createCursorAgentV1({ apiKey: 'k', fetchImpl }, { prompt: 'p', repoUrl: 'https://github.com/o/r', agentId: AGENT_ID }),
    ).rejects.toMatchObject({ name: 'CursorApiError', status: 409, code: 'agent_id_conflict' })
  })

  it('maps 401 to unauthorized and keeps the "Cursor API" prefix for failure categorisation', async () => {
    const fetchImpl = fetchMockReturning({ error: { code: 'unauthorized', message: 'bad key' } }, 401)
    const err = await createCursorAgentV1({ apiKey: 'k', fetchImpl }, { prompt: 'p', repoUrl: 'https://github.com/o/r' }).catch((e) => e)
    expect(err).toBeInstanceOf(CursorApiError)
    expect((err as CursorApiError).message).toMatch(/^Cursor API 401 unauthorized/)
  })

  it('rejects a 2xx body without agent/run ids', async () => {
    const fetchImpl = fetchMockReturning({ agent: {} }, 201)
    await expect(
      createCursorAgentV1({ apiKey: 'k', fetchImpl }, { prompt: 'p', repoUrl: 'https://github.com/o/r' }),
    ).rejects.toMatchObject({ code: 'malformed_response' })
  })
})

describe('getCursorRun / cancelCursorRun', () => {
  it('GETs /v1/agents/{id}/runs/{runId}', async () => {
    const fetchImpl = fetchMockReturning({ id: 'run_1', agentId: AGENT_ID, status: 'FINISHED' })
    const run = await getCursorRun({ apiKey: 'k', fetchImpl }, AGENT_ID, 'run_1')
    expect(run.status).toBe('FINISHED')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.cursor.com/v1/agents/${AGENT_ID}/runs/run_1`)
    expect(init.method).toBe('GET')
  })

  it('POSTs /v1/agents/{id}/runs/{runId}/cancel', async () => {
    const fetchImpl = fetchMockReturning({ id: 'run_1' })
    const res = await cancelCursorRun({ apiKey: 'k', fetchImpl }, AGENT_ID, 'run_1')
    expect(res.id).toBe('run_1')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.cursor.com/v1/agents/${AGENT_ID}/runs/run_1/cancel`)
    expect(init.method).toBe('POST')
  })
})

describe('run status mapping', () => {
  it.each([
    ['CREATING', 'working'],
    ['RUNNING', 'working'],
    ['FINISHED', 'completed'],
    ['ERROR', 'failed'],
    ['EXPIRED', 'failed'],
    ['CANCELLED', 'cancelled'],
    ['weird', 'working'],
    [undefined, 'working'],
  ])('%s → %s', (input, expected) => {
    expect(mapCursorRunStatus(input as string | undefined)).toBe(expected)
  })

  it('extracts the first prUrl / branch from run.git.branches[]', () => {
    const run = {
      git: {
        branches: [
          { repoUrl: 'github.com/o/r', branch: 'bugfix/MUSHI-x-cursor-cloud' },
          { repoUrl: 'github.com/o/r2', branch: 'other', prUrl: 'https://github.com/o/r2/pull/9' },
        ],
      },
    }
    expect(extractCursorPrUrl(run)).toBe('https://github.com/o/r2/pull/9')
    expect(extractCursorBranch(run)).toBe('bugfix/MUSHI-x-cursor-cloud')
    expect(extractCursorPrUrl({ git: { branches: [] } })).toBeNull()
    expect(extractCursorPrUrl(undefined)).toBeNull()
  })
})

describe('deterministicCursorAgentId', () => {
  it('is stable per seed, differs across seeds, and is bc-<uuid> shaped', async () => {
    const a = await deterministicCursorAgentId('dispatch-1')
    const b = await deterministicCursorAgentId('dispatch-1')
    const c = await deterministicCursorAgentId('dispatch-2')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(CURSOR_AGENT_ID_RE)
    // RFC 9562 name-based layout: version nibble 5, variant 10xx.
    expect(a.split('-')[3]).toMatch(/^5/)
    expect(a.split('-')[4]).toMatch(/^[89ab]/)
  })
})

describe('v0 webhook contract', () => {
  const PROJECT = '0f7f2b1a-1111-4222-8333-444455556666'

  it('derives a ≥ 32-char hex secret per project from the internal caller secret', async () => {
    const s1 = await buildV0WebhookSecret(PROJECT, 'internal-secret')
    const s2 = await buildV0WebhookSecret(PROJECT, 'internal-secret')
    const s3 = await buildV0WebhookSecret('another-project', 'internal-secret')
    expect(s1).toBe(s2)
    expect(s1).not.toBe(s3)
    expect(s1).toMatch(/^[0-9a-f]{64}$/)
    expect(s1.length).toBeGreaterThanOrEqual(32)
  })

  it('throws without a secret source', async () => {
    await expect(buildV0WebhookSecret(PROJECT, undefined)).rejects.toThrow(/MUSHI_INTERNAL_CALLER_SECRET/)
  })

  it('verifies sha256=<hex> over the raw body and rejects tampering / missing header', async () => {
    const secret = await buildV0WebhookSecret(PROJECT, 'internal-secret')
    const body = JSON.stringify({ id: AGENT_ID, status: 'FINISHED' })
    const hex = createHmac('sha256', secret).update(body).digest('hex')
    expect(await verifyV0WebhookSignature(body, `sha256=${hex}`, secret)).toBe(true)
    expect(await verifyV0WebhookSignature(body, `SHA256=${hex.toUpperCase()}`, secret)).toBe(true)
    expect(await verifyV0WebhookSignature(body + ' ', `sha256=${hex}`, secret)).toBe(false)
    expect(await verifyV0WebhookSignature(body, null, secret)).toBe(false)
    expect(await verifyV0WebhookSignature(body, 'sha256=deadbeef', secret)).toBe(false)
  })

  it('builds the documented v0 body with webhook { url, secret } and rejects short secrets', () => {
    const body = buildCreateAgentV0Body({
      prompt: 'p',
      repoUrl: 'https://github.com/o/r',
      ref: 'main',
      branchName: 'bugfix/MUSHI-r-cursor-cloud',
      model: 'composer-2.5',
      webhook: { url: 'https://x.supabase.co/functions/v1/cursor-webhook?project=p', secret: 'a'.repeat(64) },
    })
    expect(body).toEqual({
      prompt: { text: 'p' },
      source: { repository: 'https://github.com/o/r', ref: 'main' },
      target: { autoCreatePr: true, branchName: 'bugfix/MUSHI-r-cursor-cloud', skipReviewerRequest: true },
      model: 'composer-2.5',
      webhook: { url: 'https://x.supabase.co/functions/v1/cursor-webhook?project=p', secret: 'a'.repeat(64) },
    })
    expect(() =>
      buildCreateAgentV0Body({ prompt: 'p', repoUrl: 'https://github.com/o/r', webhook: { url: 'https://x', secret: 'short' } }),
    ).toThrow(/32/)
  })
})
