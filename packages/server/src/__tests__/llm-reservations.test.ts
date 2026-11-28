/**
 * FILE: llm-reservations.test.ts
 * PURPOSE: A UX run reserves its AI budget before it starts (ADR 0073): the
 *          size of a reservation per run kind, capped by the persona's cost
 *          cap; a start refused when the budget minus spend minus other holds
 *          cannot cover it, or when the budget cannot be read; a call that
 *          does not fit the reservation refused; the release.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  budgetHeadroom,
  chargeRunBudget,
  freshEyesReserveUsd,
  refundRunBudget,
  releaseRunBudget,
  reservationRefusal,
  reserveRunBudget,
  scorecardReserveUsd,
} from '../../supabase/functions/_shared/llm-reservations.ts'
import type { LlmBudgetState } from '../../supabase/functions/_shared/llm-budget.ts'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

const P = '1a000000-0000-4000-8000-000000000000'
const RUN = '2a000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-11-27T10:00:00Z')

const state = (over: Partial<LlmBudgetState> = {}): LlmBudgetState => ({ budgetUsd: 10, spendUsd: 4, unpricedCalls: 0, unpricedTokens: 0, over: false, resetsAt: '2026-12-01T00:00:00.000Z', ...over })

describe('the size of a reservation', () => {
  it('a scorecard: one call a page plus the grouping, capped', () => {
    expect(scorecardReserveUsd(10)).toBe(0.58)
    expect(scorecardReserveUsd(10, 0.2)).toBe(0.2)
    expect(scorecardReserveUsd(0)).toBe(0.13)
    expect(scorecardReserveUsd(5000)).toBe(50)
  })

  it('a fresh-eyes run: classifying what it may file, capped by the persona, never below the floor', () => {
    expect(freshEyesReserveUsd()).toBe(0.3)
    expect(freshEyesReserveUsd(0.1)).toBe(0.1)
    expect(freshEyesReserveUsd(0.01)).toBe(0.05)
    expect(freshEyesReserveUsd(5)).toBe(0.3)
  })

  it('the headroom is the budget minus spend, or none without a budget', () => {
    expect(budgetHeadroom(state())).toBe(6)
    expect(budgetHeadroom(state({ spendUsd: 12 }))).toBe(0)
    expect(budgetHeadroom(state({ budgetUsd: null }))).toBeNull()
    expect(reservationRefusal({ needUsd: 0.58, headroomUsd: 1, heldElsewhereUsd: 0.75 })).toContain('$0.25 is left this month after $0.75 held')
  })
})

describe('reserveRunBudget', () => {
  const db = (rpc: (fn: string, args: Record<string, unknown>) => unknown) => makeFakeDb({}, { rpc })

  it('reserves under the project lock with the headroom it read', async () => {
    const d = db(() => [{ ok: true, reservation_id: 'res1', held_elsewhere_usd: 0 }])
    const r = await reserveRunBudget(d as never, { projectId: P, uxRunId: RUN, kind: 'scorecard', usd: 0.58, createdBy: 'u1', now: NOW }, async () => state())
    expect(r).toEqual({ ok: true, reservationId: 'res1', reservedUsd: 0.58 })
    expect(d.rpcCalls[0]).toEqual({ fn: 'reserve_llm_run_budget', args: { p_project_id: P, p_ux_run_id: RUN, p_kind: 'scorecard', p_usd: 0.58, p_headroom_usd: 6, p_created_by: 'u1', p_ttl_hours: 12 } })
  })

  it('passes no headroom without a monthly budget: the run cap alone holds', async () => {
    const d = db(() => [{ ok: true, reservation_id: 'res1', held_elsewhere_usd: 0 }])
    await reserveRunBudget(d as never, { projectId: P, uxRunId: RUN, kind: 'fresh_eyes', usd: 0.3, createdBy: null, now: NOW }, async () => state({ budgetUsd: null }))
    expect(d.rpcCalls[0]!.args).toMatchObject({ p_headroom_usd: null, p_ttl_hours: 26 })
  })

  it('refuses when other runs hold the rest, when the month is spent, and when the budget cannot be read', async () => {
    const full = await reserveRunBudget(db(() => [{ ok: false, reservation_id: null, held_elsewhere_usd: 5.9 }]) as never, { projectId: P, uxRunId: RUN, kind: 'scorecard', usd: 0.58, createdBy: 'u1', now: NOW }, async () => state())
    expect(full).toMatchObject({ ok: false, code: 'RUN_BUDGET_RESERVED', status: 402 })
    const over = await reserveRunBudget(db(() => null) as never, { projectId: P, uxRunId: RUN, kind: 'scorecard', usd: 0.58, createdBy: 'u1', now: NOW }, async () => state({ spendUsd: 10, over: true }))
    expect(over).toMatchObject({ ok: false, code: 'LLM_BUDGET_EXCEEDED', status: 402 })
    const blind = await reserveRunBudget(db(() => null) as never, { projectId: P, uxRunId: RUN, kind: 'scorecard', usd: 0.58, createdBy: 'u1', now: NOW }, async () => {
      throw new Error('read failed')
    })
    expect(blind).toMatchObject({ ok: false, code: 'RUN_BUDGET_UNAVAILABLE', status: 503 })
  })
})

describe('chargeRunBudget and releaseRunBudget', () => {
  it('charges a run with a reservation, says spent when it is full, and none when the run never reserved', async () => {
    expect(await chargeRunBudget(makeFakeDb({}, { rpc: () => true }) as never, RUN, 0.05)).toBe('charged')
    expect(await chargeRunBudget(makeFakeDb({ llm_run_reservations: [{ id: 'r', ux_run_id: RUN }] }, { rpc: () => false }) as never, RUN, 0.05)).toBe('spent')
    expect(await chargeRunBudget(makeFakeDb({ llm_run_reservations: [] }, { rpc: () => false }) as never, RUN, 0.05)).toBe('none')
    expect(await chargeRunBudget(makeFakeDb({}, { rpcError: () => ({ code: 'X', message: 'down' }) }) as never, RUN, 0.05)).toBe('unavailable')
  })

  it('gives back the charge of a call that failed, so a retry does not eat the later calls', async () => {
    const d = makeFakeDb({}, { rpc: () => true })
    expect(await refundRunBudget(d as never, RUN, 0.05)).toBe(true)
    expect(d.rpcCalls[0]).toEqual({ fn: 'refund_llm_run_reservation', args: { p_ux_run_id: RUN, p_usd: 0.05 } })
    expect(await refundRunBudget(makeFakeDb({}, { rpcError: () => ({ code: 'X', message: 'down' }) }) as never, RUN, 0.05)).toBe(false)
  })

  it('releases what the run did not charge', async () => {
    expect(await releaseRunBudget(makeFakeDb({}, { rpc: () => 0.25 }) as never, RUN)).toBe(0.25)
    expect(await releaseRunBudget(makeFakeDb({}, { rpcError: () => ({ code: 'X', message: 'down' }) }) as never, RUN)).toBeNull()
  })
})

describe('the scorecard routes give a failed call its charge back', () => {
  it('refunds before every failure answer that follows a charge', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/ux-scorecard.ts'), 'utf8')
    for (const code of ["'UPSTREAM_ERROR', 'Could not read the page screenshots", "'LLM_UNAVAILABLE'", "'LLM_BAD_ANSWER'"]) {
      const at = src.indexOf(code)
      expect(at, code).toBeGreaterThan(0)
      expect(src.slice(Math.max(0, at - 260), at), code).toContain('refundRunBudget(db, run.id, UX_SCORE_CALL_RESERVE_USD)')
    }
    expect(src).toContain('refundRunBudget(db, run.id, UX_GROUP_CALL_RESERVE_USD)')
  })
})
