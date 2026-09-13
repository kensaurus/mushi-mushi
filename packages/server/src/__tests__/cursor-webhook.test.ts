/**
 * FILE: cursor-webhook.test.ts
 * PURPOSE: The Cursor v0 `statusChange` receiver: HMAC verification over the
 *          raw body (401 on mismatch, nothing read before it), X-Webhook-ID
 *          dedupe stored on fix_attempts.external_agent_ref, and the
 *          FINISHED / ERROR → applyCloudAgentOutcome mapping. Always 200
 *          after a valid signature.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { createFakeDb, findQueries, type FakeQuery } from './__stubs__/fake-query-recorder.ts'

const mocks = vi.hoisted(() => ({
  apply: vi.fn(async (): Promise<{ applied: boolean; reason?: string }> => ({ applied: true })),
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => {
    throw new Error('test must inject deps.db')
  },
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  withSentry: (_name: string, handler: unknown) => handler,
}))
vi.mock('../../supabase/functions/_shared/agent-adapters.ts', () => ({
  applyCloudAgentOutcome: (...args: unknown[]) => mocks.apply(...(args as [])),
}))

import { handleCursorWebhook } from '../../supabase/functions/cursor-webhook/index.ts'

const PROJECT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const REPORT = '0f7f2b1a-1111-4222-8333-444455556666'
const AGENT_ID = 'bc-11111111-2222-5333-8444-555555555555'
const SECRET = 'f'.repeat(64)
const secretFor = async () => SECRET

function signedRequest(payload: unknown, opts: { webhookId?: string; badSignature?: boolean; project?: string } = {}): Request {
  const body = JSON.stringify(payload)
  const hex = createHmac('sha256', SECRET).update(body).digest('hex')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Signature': `sha256=${opts.badSignature ? 'ab'.repeat(32) : hex}`,
    'X-Webhook-Event': 'statusChange',
    'User-Agent': 'Cursor-Agent-Webhook/1.0',
  }
  if (opts.webhookId) headers['X-Webhook-ID'] = opts.webhookId
  const project = opts.project ?? PROJECT
  return new Request(`https://x.supabase.co/functions/v1/cursor-webhook?project=${project}`, { method: 'POST', headers, body })
}

function attemptDb(overrides: Record<string, unknown> = {}) {
  return createFakeDb((q: FakeQuery) => {
    if (q.table === 'fix_attempts' && q.op === 'select') {
      return {
        data: {
          id: 'fa-1',
          project_id: PROJECT,
          report_id: REPORT,
          agent: 'cursor_cloud',
          status: 'running',
          pr_url: null,
          branch_name: 'bugfix/MUSHI-r-cursor-cloud',
          cursor_agent_id: AGENT_ID,
          cursor_run_id: null,
          external_agent_ref: {},
          ...overrides,
        },
      }
    }
    return { data: null }
  })
}

beforeEach(() => {
  mocks.apply.mockClear()
  mocks.apply.mockResolvedValue({ applied: true })
})

describe('cursor-webhook — security gate', () => {
  it('400s without ?project=', async () => {
    const res = await handleCursorWebhook(
      new Request('https://x.supabase.co/functions/v1/cursor-webhook', { method: 'POST', body: '{}' }),
      { secretFor },
    )
    expect(res.status).toBe(400)
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('401s on a bad signature and never touches the database', async () => {
    const { db, queries } = attemptDb()
    const res = await handleCursorWebhook(signedRequest({ id: AGENT_ID, status: 'FINISHED' }, { badSignature: true }), { db, secretFor })
    expect(res.status).toBe(401)
    expect(queries).toHaveLength(0)
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('405s non-POST', async () => {
    const res = await handleCursorWebhook(new Request(`https://x.supabase.co/functions/v1/cursor-webhook?project=${PROJECT}`), { secretFor })
    expect(res.status).toBe(405)
  })
})

describe('cursor-webhook — outcome mapping', () => {
  it('FINISHED with target.prUrl → applyCloudAgentOutcome(pr_opened) and 200', async () => {
    const { db, queries } = attemptDb()
    const res = await handleCursorWebhook(
      signedRequest(
        {
          event: 'statusChange',
          timestamp: '2026-09-12T00:00:00Z',
          id: AGENT_ID,
          status: 'FINISHED',
          source: { repository: 'https://github.com/o/r', ref: 'main' },
          target: { url: 'https://cursor.com/agents/1', branchName: 'bugfix/MUSHI-r-cursor-cloud', prUrl: 'https://github.com/o/r/pull/12' },
          summary: 'Fixed the crash',
        },
        { webhookId: 'wh-1' },
      ),
      { db, secretFor },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, applied: true, fixAttemptId: 'fa-1' })
    expect(mocks.apply).toHaveBeenCalledTimes(1)
    const [, target, outcome] = mocks.apply.mock.calls[0] as unknown as [unknown, Record<string, unknown>, Record<string, unknown>]
    expect(target).toEqual({ attemptId: 'fa-1', projectId: PROJECT, reportId: REPORT, agent: 'cursor_cloud' })
    expect(outcome).toEqual({ kind: 'pr_opened', prUrl: 'https://github.com/o/r/pull/12', branch: 'bugfix/MUSHI-r-cursor-cloud', summary: 'Fixed the crash' })
    // X-Webhook-ID remembered on the attempt for dedupe.
    const dedupeWrite = findQueries(queries, 'fix_attempts', 'update')[0]
    expect(dedupeWrite.payload).toMatchObject({ external_agent_ref: expect.objectContaining({ webhook_ids: ['wh-1'], last_webhook_status: 'FINISHED' }) })
  })

  it('drops a redelivered X-Webhook-ID without re-applying', async () => {
    const { db, queries } = attemptDb({ external_agent_ref: { webhook_ids: ['wh-1'] } })
    const res = await handleCursorWebhook(
      signedRequest({ id: AGENT_ID, status: 'FINISHED', target: { prUrl: 'https://github.com/o/r/pull/12' } }, { webhookId: 'wh-1' }),
      { db, secretFor },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true })
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(findQueries(queries, 'fix_attempts', 'update')).toHaveLength(0)
  })

  it('FINISHED without a prUrl → completed_no_pr', async () => {
    const { db } = attemptDb()
    await handleCursorWebhook(signedRequest({ id: AGENT_ID, status: 'FINISHED', summary: 'nothing to do' }), { db, secretFor })
    expect(mocks.apply.mock.calls[0][2]).toEqual({ kind: 'completed_no_pr', summary: 'nothing to do' })
  })

  it('ERROR → failed with cursor_api_error', async () => {
    const { db } = attemptDb()
    const res = await handleCursorWebhook(signedRequest({ id: AGENT_ID, status: 'ERROR', summary: 'sandbox exploded' }), { db, secretFor })
    expect(res.status).toBe(200)
    expect(mocks.apply.mock.calls[0][2]).toMatchObject({ kind: 'failed', error: 'Cursor run ERROR: sandbox exploded', failureCategory: 'cursor_api_error' })
  })

  it('unknown agent id → 200 ignored, nothing applied', async () => {
    const { db } = createFakeDb(() => ({ data: null }))
    const res = await handleCursorWebhook(signedRequest({ id: 'bc-unknown', status: 'FINISHED' }), { db, secretFor })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, ignored: 'unknown_agent' })
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('non-terminal status → 200 ignored', async () => {
    const { db } = attemptDb()
    const res = await handleCursorWebhook(signedRequest({ id: AGENT_ID, status: 'RUNNING' }), { db, secretFor })
    expect(await res.json()).toMatchObject({ ok: true, ignored: 'non_terminal_status' })
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('invalid payload after a valid signature → 200 ignored (Cursor must not retry)', async () => {
    const { db } = attemptDb()
    const res = await handleCursorWebhook(signedRequest({ status: 'FINISHED' }), { db, secretFor })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, ignored: 'invalid_payload' })
  })
})
