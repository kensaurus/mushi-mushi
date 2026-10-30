/**
 * lib/pipeline.ts: the one-line result of a bulk action, the age label, the
 * queue-merge mapping of skipped fixes, and chunked pipeline actions.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ posts: [] as Array<{ path: string; body: unknown }>, respond: (_p: string): unknown => ({ ok: true }) }))
vi.mock('./supabase', () => ({
  apiFetch: async (path: string, opts: { body?: string } = {}) => {
    state.posts.push({ path, body: opts.body ? JSON.parse(opts.body) : null })
    return state.respond(path)
  },
}))

import { ageLabel, DEPLOY_EVENT_BODY, deploysBehindMerges, openerSummary, outcomeSummary, runPipelineAction, type DispatcherStatus, type PipelineData } from './pipeline'

beforeEach(() => {
  state.posts = []
})

describe('pipeline helpers', () => {
  it('outcomeSummary: one message, all done, or the first refusal', () => {
    expect(outcomeSummary([{ id: 'a', ok: true, message: 'Closed.' }])).toBe('Closed.')
    expect(outcomeSummary([{ id: 'a', ok: true, message: 'x' }, { id: 'b', ok: true, message: 'x' }])).toBe('2 done.')
    expect(outcomeSummary([{ id: 'a', ok: true, message: 'x' }, { id: 'b', ok: false, message: 'Not in the merge queue.' }])).toBe('1 done · 1 not: Not in the merge queue.')
    expect(outcomeSummary([{ id: 'b', ok: false, message: 'GitHub refused.' }])).toBe('GitHub refused.')
  })

  it('ageLabel: minutes, hours, then days', () => {
    const now = Date.parse('2026-10-26T12:00:00Z')
    expect(ageLabel('2026-10-26T11:45:00Z', now)).toBe('15 min')
    expect(ageLabel('2026-10-26T02:00:00Z', now)).toBe('10 h')
    expect(ageLabel('2026-10-23T12:00:00Z', now)).toBe('3 d')
    expect(ageLabel(null, now)).toBe('')
  })

  it('queue_merge maps skipped fixes to their reasons', async () => {
    state.respond = () => ({ ok: true, data: { queued: 1, skipped: [{ fixId: 'b', reason: 'Already merged.' }] } })
    const out = await runPipelineAction('queue_merge', ['a', 'b'])
    expect(state.posts).toEqual([{ path: '/v1/admin/merge-queue', body: { fixIds: ['a', 'b'] } }])
    expect(out).toEqual([
      { id: 'a', ok: true, message: 'Queued to merge.' },
      { id: 'b', ok: false, message: 'Already merged.' },
    ])
  })

  it('pipeline actions go in chunks of 10 and a failed request marks each PR', async () => {
    state.respond = () => ({ ok: false, error: { code: 'X', message: 'Server down.' } })
    const ids = Array.from({ length: 30 }, (_, i) => `f${i}`)
    const out = await runPipelineAction('update_branch', ids)
    expect(state.posts.map((p) => (p.body as { fixIds: string[] }).fixIds.length)).toEqual([10, 10, 10])
    expect(out).toHaveLength(30)
    expect(out.every((r) => !r.ok && r.message === 'Server down.')).toBe(true)
  })

  it('deploysBehindMerges flags a merge newer than the last deploy, not an old deploy by itself (9f64a77b)', () => {
    const item = (projectId: string, since: string) => ({
      id: `${projectId}-${since}`,
      projectId,
      reportId: null,
      title: 'Fix',
      repo: null,
      prNumber: null,
      prUrl: null,
      queueId: null,
      since,
      lastError: null,
      lastEventAt: null,
      lastEventLabel: null,
      failingChecks: [],
      review: null,
      queueDetail: null,
    })
    const data = (over: Partial<PipelineData>): PipelineData => ({
      generatedAt: '2026-10-26T12:00:00Z',
      projects: [
        { id: 'p1', name: 'glot.it', lastDeploy: { at: '2026-10-13T00:00:00Z', version: '1.1.0', ok: true } },
        { id: 'p2', name: 'quiet', lastDeploy: { at: '2026-10-13T00:00:00Z', version: null, ok: true } },
        { id: 'p3', name: 'caught-up', lastDeploy: { at: '2026-10-26T08:00:00Z', version: '1.2.0', ok: true } },
      ],
      stages: [
        {
          id: 'merged',
          label: 'Merged',
          count: 2,
          stuck: 1,
          oldestAt: null,
          groups: [
            { id: 'not_deployed', stage: 'merged', tone: 'stuck', label: '', count: 1, oldestAt: null, actions: [], settings: null, items: [item('p1', '2026-10-25T00:00:00Z')] },
            { id: 'merged', stage: 'merged', tone: 'done', label: '', count: 1, oldestAt: null, actions: [], settings: null, items: [item('p3', '2026-10-26T00:00:00Z')] },
          ],
        },
        {
          id: 'deployed',
          label: 'Deployed',
          count: 1,
          stuck: 0,
          oldestAt: null,
          groups: [
            { id: 'deployed', stage: 'deployed', tone: 'done', label: '', count: 1, oldestAt: null, actions: [], settings: null, items: [item('p3', '2026-10-26T09:00:00Z')] },
          ],
        },
      ],
      dispatchers: null,
      trains: [],
      intake: null,
      ciReadable: true,
      ...over,
    })
    // p2's deploy is 13 days old and nothing merged since: not a lag.
    expect(deploysBehindMerges(data({})).map((l) => l.projectId)).toEqual(['p1'])
    // No deploy recorded, and a merge is waiting.
    const never = data({})
    never.projects = [{ id: 'p1', name: 'glot.it', lastDeploy: null }]
    never.stages[0].groups = [
      { id: 'not_deployed', stage: 'merged', tone: 'stuck', label: '', count: 1, oldestAt: null, actions: [], settings: null, items: [item('p1', '2026-10-25T00:00:00Z')] },
    ]
    expect(deploysBehindMerges(never)[0]).toMatchObject({ projectId: 'p1', lastDeployAt: null })
    // A deploy after the merge clears it. The deployed group's since is the deploy, not the merge.
    const after = data({})
    after.projects = [{ id: 'p1', name: 'glot.it', lastDeploy: { at: '2026-10-26T00:00:00Z', version: '1.3.0', ok: true } }]
    expect(deploysBehindMerges(after)).toEqual([])
    expect(DEPLOY_EVENT_BODY).toContain('"type":"deploy.completed"')
  })

  it('openerSummary counts apps by who opened a fix in 24 h', () => {
    const d = (server: number, local: number) =>
      ({ server: { dispatches24h: server }, local: { runs24h: local } }) as unknown as DispatcherStatus
    expect(openerSummary([d(0, 3), d(2, 0), d(0, 0), d(1, 1)])).toEqual({ server: 2, local: 2, nobody: 1 })
  })
})
