/**
 * A check_run delivery stores the head's rollup, not the one event.
 *
 * GitHub keeps an older failed run on the list after a re-run it already
 * scores as green. The report page reads fix_attempts.check_run_conclusion,
 * so both webhook paths must write the rollup (report 9e2ec6f0). A green
 * rollup also clears a stale ci_infra flag.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, eqValue, findQueries, hasFilter } from './__stubs__/fake-query-recorder.ts'

const fetchLatestCheckRun = vi.hoisted(() => vi.fn())

vi.mock('../../supabase/functions/_shared/github.ts', () => ({
  fetchLatestCheckRun,
}))

import { applyHeadCheckRollup } from '../../supabase/functions/_shared/check-run-head.ts'

const REF = { owner: 'kensaurus', repo: 'glot.it' }
const SHA = 'a'.repeat(40)
const STALE_INFRA = { infra: true, kind: 'runner_lost' }

beforeEach(() => {
  fetchLatestCheckRun.mockReset()
})

describe('applyHeadCheckRollup', () => {
  it('stores the rollup success when the event itself failed, and clears ci_infra', async () => {
    fetchLatestCheckRun.mockResolvedValue({ status: 'completed', conclusion: 'success' })
    const { db, queries } = createFakeDb(() => ({ data: null, error: null }))
    const out = await applyHeadCheckRollup(db as never, ['attempt-1'], 'one', {
      eventStatus: 'completed',
      eventConclusion: 'failure',
      token: 'ghs_test',
      ref: REF,
      sha: SHA,
      now: new Date('2026-10-28T00:00:00.000Z'),
      classifyInfra: async () => STALE_INFRA,
    })
    expect(fetchLatestCheckRun).toHaveBeenCalledWith('ghs_test', REF, SHA)
    expect(out.head.conclusion).toBe('success')
    const update = findQueries(queries, 'fix_attempts', 'update')
    expect(update).toHaveLength(1)
    expect(update[0]?.payload).toEqual({
      check_run_status: 'completed',
      check_run_conclusion: 'success',
      check_run_updated_at: '2026-10-28T00:00:00.000Z',
      ci_infra: null,
    })
    expect(eqValue(update[0]!, 'id')).toBe('attempt-1')
  })

  it.each(['neutral', 'skipped'] as const)('a %s rollup clears ci_infra', async (conclusion) => {
    fetchLatestCheckRun.mockResolvedValue({ status: 'completed', conclusion })
    const { db, queries } = createFakeDb(() => ({ data: null, error: null }))
    await applyHeadCheckRollup(db as never, ['attempt-1'], 'many', {
      eventStatus: 'completed',
      eventConclusion: 'failure',
      token: 'ghs_test',
      ref: REF,
      sha: SHA,
    })
    const update = findQueries(queries, 'fix_attempts', 'update')[0]
    expect(update?.payload).toMatchObject({ check_run_conclusion: conclusion, ci_infra: null })
    expect(hasFilter(update!, 'in', 'id')).toBe(true)
  })

  it('a red rollup keeps the infra verdict and the failure', async () => {
    fetchLatestCheckRun.mockResolvedValue({ status: 'completed', conclusion: 'failure' })
    const { db, queries } = createFakeDb(() => ({ data: null, error: null }))
    await applyHeadCheckRollup(db as never, ['attempt-1'], 'one', {
      eventStatus: 'completed',
      eventConclusion: 'failure',
      token: 'ghs_test',
      ref: REF,
      sha: SHA,
      classifyInfra: async () => STALE_INFRA,
    })
    const update = findQueries(queries, 'fix_attempts', 'update')[0]
    expect(update?.payload).toMatchObject({
      check_run_conclusion: 'failure',
      ci_infra: STALE_INFRA,
    })
  })

  it('keeps the event conclusion and does not clear ci_infra when the rollup cannot be read', async () => {
    fetchLatestCheckRun.mockRejectedValue(new Error('github down'))
    const onRollupError = vi.fn()
    const { db, queries } = createFakeDb(() => ({ data: null, error: null }))
    await applyHeadCheckRollup(db as never, ['attempt-1'], 'one', {
      eventStatus: 'completed',
      eventConclusion: 'failure',
      token: 'ghs_test',
      ref: REF,
      sha: SHA,
      onRollupError,
    })
    expect(onRollupError).toHaveBeenCalledOnce()
    const payload = findQueries(queries, 'fix_attempts', 'update')[0]?.payload as Record<string, unknown>
    expect(payload.check_run_conclusion).toBe('failure')
    expect(payload).not.toHaveProperty('ci_infra')
  })
})
