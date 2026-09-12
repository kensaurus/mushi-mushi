/**
 * FILE: linear-agent-dispatch.test.ts
 * PURPOSE: Contract for the Linear agent-session dispatch (exec plan row 35).
 *          The old handler POSTed fix-worker a `{ trigger: 'linear_agent' }`
 *          body that answered 400 `dispatchId required`, swallowed it, and
 *          logged success. Now: find-or-create the Mushi report for the
 *          issue, call dispatchFixForReport (the Slack path), and post the
 *          REAL outcome back to the Linear session.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createFakeDb, findQueries, eqValue, type FakeQuery } from './__stubs__/fake-query-recorder.ts'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true, dispatchId: 'd-1', status: 'queued' })),
  postActivity: vi.fn(async () => undefined),
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/linear-agent.ts', () => ({
  getLinearActorToken: vi.fn(),
  getAgentSessionContext: vi.fn(),
  postAgentActivity: vi.fn(),
}))
vi.mock('../../supabase/functions/_shared/integration-probes.ts', () => ({ dereferenceMaybeVault: vi.fn() }))
vi.mock('../../supabase/functions/_shared/webhook-middleware.ts', () => ({
  createWebhookMiddleware: () => ({}),
  ReplayAttackError: class extends Error {},
  RateLimitError: class extends Error {},
}))
vi.mock('../../supabase/functions/_shared/dispatch.ts', () => ({
  dispatchFixForReport: (...args: unknown[]) => mocks.dispatch(...(args as [])),
}))

import {
  describeDispatchOutcome,
  findOrCreateLinearReport,
  linearPriorityToSeverity,
  runLinearAgentDispatch,
} from '../../supabase/functions/webhooks-linear-agent/index.ts'

const PROJECT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const SESSION = {
  id: 'ags_1',
  issue: {
    id: 'lin_issue_1',
    identifier: 'ENG-42',
    title: 'Login button does nothing on Safari',
    description: 'Tapping Sign in on iOS Safari 18 does not navigate.',
    url: 'https://linear.app/acme/issue/ENG-42',
    priority: 2,
    state: { name: 'Todo', type: 'unstarted' },
    assignee: null,
  },
  promptContext: 'User @-mentioned Mushi: please fix this',
  createdAt: '2026-09-12T00:00:00Z',
}

const deps = {
  dispatch: (...args: unknown[]) => mocks.dispatch(...(args as [])) as never,
  postActivity: (...args: unknown[]) => mocks.postActivity(...(args as [])) as never,
}

beforeEach(() => {
  mocks.dispatch.mockReset()
  mocks.dispatch.mockResolvedValue({ ok: true, dispatchId: 'd-1', status: 'queued' })
  mocks.postActivity.mockClear()
})

describe('findOrCreateLinearReport', () => {
  it('creates a report + report_external_issues link, retrying without reports.source when the column is missing', async () => {
    const { db, queries } = createFakeDb((q: FakeQuery) => {
      if (q.table === 'report_external_issues' && q.op === 'select') return { data: [] }
      if (q.table === 'reports' && q.op === 'insert') {
        if ((q.payload as { source?: string }).source === 'linear') {
          return { error: { code: '42703', message: 'column "source" of relation "reports" does not exist' } }
        }
        return { data: { id: 'rep-1' } }
      }
      return { data: null }
    })
    const res = await findOrCreateLinearReport(db, PROJECT, SESSION)
    expect(res).toEqual({ reportId: 'rep-1', created: true })
    const inserts = findQueries(queries, 'reports', 'insert')
    expect(inserts).toHaveLength(2)
    expect(inserts[0].payload).toMatchObject({ source: 'linear' })
    expect(inserts[1].payload).not.toHaveProperty('source')
    expect(inserts[1].payload).toMatchObject({
      project_id: PROJECT,
      category: 'bug',
      severity: 'high',
      status: 'new',
      reporter_token_hash: 'linear-agent',
      summary: 'ENG-42: Login button does nothing on Safari',
      custom_metadata: expect.objectContaining({ source: 'linear', linearIssueId: 'lin_issue_1', linearAgentSessionId: 'ags_1' }),
    })
    expect((inserts[1].payload as { description: string }).description).toContain('iOS Safari 18')
    const link = findQueries(queries, 'report_external_issues', 'insert')[0]
    expect(link.payload).toEqual({ report_id: 'rep-1', project_id: PROJECT, system: 'linear', external_id: 'lin_issue_1', external_url: SESSION.issue.url })
  })

  it('re-uses the report already linked to the issue', async () => {
    const { db, queries } = createFakeDb((q: FakeQuery) => {
      if (q.table === 'report_external_issues' && q.op === 'select') return { data: [{ report_id: 'rep-9' }] }
      if (q.table === 'reports' && q.op === 'select') return { data: { id: 'rep-9' } }
      return { data: null }
    })
    expect(await findOrCreateLinearReport(db, PROJECT, SESSION)).toEqual({ reportId: 'rep-9', created: false })
    expect(findQueries(queries, 'reports', 'insert')).toHaveLength(0)
    const lookup = findQueries(queries, 'report_external_issues', 'select')[0]
    expect(eqValue(lookup, 'system')).toBe('linear')
    expect(eqValue(lookup, 'external_id')).toBe('lin_issue_1')
  })

  it('maps Linear priority onto severity', () => {
    expect(linearPriorityToSeverity(1)).toBe('critical')
    expect(linearPriorityToSeverity(2)).toBe('high')
    expect(linearPriorityToSeverity(3)).toBe('medium')
    expect(linearPriorityToSeverity(4)).toBe('low')
    expect(linearPriorityToSeverity(0)).toBe('low')
    expect(linearPriorityToSeverity(null)).toBe('low')
  })
})

describe('runLinearAgentDispatch', () => {
  function dbWithExistingReport() {
    return createFakeDb((q: FakeQuery) => {
      if (q.table === 'report_external_issues' && q.op === 'select') return { data: [{ report_id: 'rep-9' }] }
      if (q.table === 'reports' && q.op === 'select') return { data: { id: 'rep-9' } }
      return { data: null }
    })
  }

  it('calls dispatchFixForReport with source=linear metadata and posts the dispatch id back', async () => {
    const { db } = dbWithExistingReport()
    const outcome = await runLinearAgentDispatch(db, { projectId: PROJECT, agentSessionId: 'ags_1', actorToken: 'lin_tok', session: SESSION }, deps)
    expect(outcome).toEqual({
      ok: true,
      code: 'OK',
      reportId: 'rep-9',
      dispatchId: 'd-1',
      reportCreated: false,
      message: expect.stringContaining('d-1'),
    })
    expect(mocks.dispatch).toHaveBeenCalledWith({
      projectId: PROJECT,
      reportId: 'rep-9',
      requestedBy: null,
      skipMembershipCheck: true,
      metadata: {
        source: 'linear',
        requestedBy: 'linear-agent',
        linearAgentSessionId: 'ags_1',
        linearIssueId: 'lin_issue_1',
        linearIssueIdentifier: 'ENG-42',
      },
    })
    expect(mocks.postActivity).toHaveBeenCalledWith('lin_tok', 'ags_1', { type: 'text', body: expect.stringContaining('ENG-42') })
  })

  it('surfaces AUTOFIX_DISABLED as an error activity with the real code (no more silent success)', async () => {
    mocks.dispatch.mockResolvedValue({ ok: false, code: 'AUTOFIX_DISABLED', message: 'Enable Autofix in project settings first' })
    const { db } = dbWithExistingReport()
    const outcome = await runLinearAgentDispatch(db, { projectId: PROJECT, agentSessionId: 'ags_1', actorToken: 'lin_tok', session: SESSION }, deps)
    expect(outcome).toMatchObject({ ok: false, code: 'AUTOFIX_DISABLED', reportId: 'rep-9', dispatchId: null })
    expect(mocks.postActivity).toHaveBeenCalledWith('lin_tok', 'ags_1', { type: 'error', body: expect.stringContaining('Autofix is disabled') })
  })

  it('treats ALREADY_DISPATCHED as informational text', async () => {
    mocks.dispatch.mockResolvedValue({ ok: false, code: 'ALREADY_DISPATCHED', message: 'in progress', dispatchId: 'd-old' })
    const { db } = dbWithExistingReport()
    const outcome = await runLinearAgentDispatch(db, { projectId: PROJECT, agentSessionId: 'ags_1', actorToken: 'lin_tok', session: SESSION }, deps)
    expect(outcome.code).toBe('ALREADY_DISPATCHED')
    expect(mocks.postActivity.mock.calls[0][2]).toMatchObject({ type: 'text', body: expect.stringContaining('d-old') })
  })

  it('describeDispatchOutcome never claims success for a failed dispatch', () => {
    expect(describeDispatchOutcome({ ok: false, code: 'DISPATCH_FAILED', message: 'boom' }, 'ENG-1')).toContain('boom')
    expect(describeDispatchOutcome({ ok: true, dispatchId: 'd' }, 'ENG-1')).toContain('draft pull request')
  })

  it('the handler no longer POSTs fix-worker directly', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/webhooks-linear-agent/index.ts'), 'utf-8')
    expect(src).not.toContain('/functions/v1/fix-worker')
    // The old body literal (`trigger: 'linear_agent',` inside a JSON.stringify) must be gone.
    expect(src).not.toMatch(/JSON\.stringify\(\{[\s\S]{0,400}trigger: 'linear_agent'/)
    expect(src).toContain('dispatchFixForReport')
  })
})
