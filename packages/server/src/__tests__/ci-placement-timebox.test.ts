/**
 * FILE: ci-placement-timebox.test.ts
 * PURPOSE: A time-boxed move to GitHub-hosted runners switches back when due
 *          (ADR 0037 amendment, 2026-10-30): once, in the approver's name,
 *          never before it is due, never twice, never without a recorded
 *          "what Mushi left" to compare against.
 */
import { describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import { runTimedReverts, type TimeboxDeps } from '../../supabase/functions/_shared/ci-placement-timebox.ts'

const ORG = 'org-1'
const APPROVER = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-10-30T12:00:00Z')

function executed(over: Record<string, unknown> = {}) {
  return {
    id: 'act-1',
    organization_id: ORG,
    project_id: 'p1',
    connector_kind: 'github',
    action: 'set_actions_variable',
    status: 'executed',
    approved_by: APPROVER,
    executed_at: '2026-10-30T07:00:00Z',
    payload: {
      repo: 'kensaurus/tsumagoi',
      name: 'LINUX_RUNNER',
      value: 'ubuntu-latest',
      expected: { exists: true, value: 'kensaurus-local', updatedAt: '2026-10-01T00:00:00Z' },
      jobs: [],
      expectedLabels: ['ubuntu-latest'],
      fallbackLabels: [],
      revertAfterHours: 4,
    },
    result: { next: { exists: true, value: 'ubuntu-latest', updatedAt: '2026-10-30T07:00:01Z' } },
    ...over,
  }
}

function deps(executeOk = true) {
  const calls: string[] = []
  const d: TimeboxDeps = {
    request: vi.fn(async (_db, input) => {
      calls.push(`request:${(input.payload as { value: string | null }).value}:${input.requestedBy}`)
      return { ok: true, value: { id: 'rev-1', payloadSha256: 'a'.repeat(64) } }
    }) as never,
    approve: vi.fn(async (_db, id, _org, approver) => {
      calls.push(`approve:${id}:${approver}`)
      return { ok: true, value: { expiresAt: '' } }
    }) as never,
    execute: vi.fn(async (_db, id) => {
      calls.push(`execute:${id}`)
      return executeOk ? { ok: true, value: { ok: true, detail: 'ok' } } : { ok: false, code: 'VARIABLE_MOVED', message: 'moved', status: 409 }
    }) as never,
    executeDeps: { fetch: (async () => new Response('{}')) as never, now: () => NOW },
  }
  return { d, calls }
}

describe('runTimedReverts', () => {
  it('switches a due change back once, in the approver’s name, and closes its watch', async () => {
    const db = makeFakeDb({ connector_actions: [executed()], ci_placement_watches: [{ id: 'w1', action_id: 'act-1', status: 'watching' }] })
    const { d, calls } = deps()
    const out = await runTimedReverts(db, NOW, d)
    expect(out).toEqual({ due: 1, reverted: 1, failed: 0 })
    expect(calls).toEqual([`request:kensaurus-local:system:time_box`, `approve:rev-1:${APPROVER}`, 'execute:rev-1'])
    const req = (d.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(req.payload).toMatchObject({ revertOf: 'act-1', timeBox: true, expected: { value: 'ubuntu-latest' } })
    expect(req.payload.revertAfterHours).toBeUndefined()
    expect(db.table('ci_placement_watches')[0]).toMatchObject({ status: 'reverted', revert_action_id: 'rev-1' })
  })

  it('leaves a change alone before it is due, and one without a time box', async () => {
    const db = makeFakeDb({
      connector_actions: [
        executed({ executed_at: '2026-10-30T09:00:00Z' }),
        executed({ id: 'act-2', payload: { ...executed().payload, revertAfterHours: undefined } }),
      ],
    })
    const { d, calls } = deps()
    expect(await runTimedReverts(db, NOW, d)).toEqual({ due: 0, reverted: 0, failed: 0 })
    expect(calls).toEqual([])
  })

  it('never files a second revert, and never reverts without knowing what Mushi left', async () => {
    const db = makeFakeDb({
      connector_actions: [
        executed(),
        { id: 'old-rev', organization_id: ORG, status: 'failed', payload: { revertOf: 'act-1' } },
        executed({ id: 'act-3', result: null }),
      ],
    })
    const { d, calls } = deps()
    expect(await runTimedReverts(db, NOW, d)).toEqual({ due: 0, reverted: 0, failed: 0 })
    expect(calls).toEqual([])
  })

  it('records a refused revert (someone changed the variable) as failed, and keeps the watch', async () => {
    const db = makeFakeDb({ connector_actions: [executed()], ci_placement_watches: [{ id: 'w1', action_id: 'act-1', status: 'watching' }] })
    const { d } = deps(false)
    expect(await runTimedReverts(db, NOW, d)).toEqual({ due: 1, reverted: 0, failed: 1 })
    expect(db.table('ci_placement_watches')[0].status).toBe('watching')
  })
})
