import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  AutofixBudgetUnavailableError,
  budgetSnapshot,
  checkAutofixBudget,
  dispatchTrigger,
  isSiblingDispatch,
  parseAutofixCapsBody,
} from '../_shared/autofix-budget.ts'

type Answer = { data?: unknown; error?: { message: string } | null; count?: number | null }

/** Stand-in for the two reads the budget makes: llm_invocations spend and today's dispatch count. */
// deno-lint-ignore no-explicit-any
function fakeDb(spend: Answer, dispatches: Answer): any {
  return {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b,
        eq: () => b,
        gte: () => b,
        neq: () => b,
        then(resolve: (v: unknown) => void) {
          const a = table === 'llm_invocations' ? spend : dispatches
          resolve({ data: a.data ?? null, error: a.error ?? null, count: a.count ?? null })
        },
      }
      return b
    },
  }
}

const CAPS = { autofix_max_spend_usd: 2, autofix_max_dispatches_per_day: 3, autofix_approval_cost_threshold_usd: null }
const OVER_SPEND = { data: [{ cost_usd: 1.5 }, { cost_usd: 0.75 }] } // $2.25 of $2
const UNDER_SPEND = { data: [{ cost_usd: 0.4 }] }

Deno.test('automatic dispatch is blocked once the 30-day spend cap is reached', async () => {
  const check = await checkAutofixBudget(fakeDb(OVER_SPEND, { count: 0 }), 'p1', CAPS, { trigger: 'automatic' })
  assertEquals(check.allowed, false)
  assert(check.reason?.includes('spend ceiling'))
  assertEquals(check.capExceeded, true)
})

Deno.test('manual dispatch proceeds past the spend cap and reports the 30-day spend', async () => {
  const check = await checkAutofixBudget(fakeDb(OVER_SPEND, { count: 0 }), 'p1', CAPS, { trigger: 'manual' })
  assertEquals(check.allowed, true)
  assertEquals(check.capExceeded, true)
  assertEquals(check.spendUsd30d, 2.25)
  assertEquals(check.maxSpendUsd, 2)
  const snap = budgetSnapshot(check)
  assertEquals(snap.trigger, 'manual')
  assertEquals(snap.spend_usd_30d, 2.25)
  assertEquals(snap.cap_exceeded, true)
})

Deno.test('daily dispatch cap: blocks automatic, never manual', async () => {
  const auto = await checkAutofixBudget(fakeDb(UNDER_SPEND, { count: 3 }), 'p1', CAPS, { trigger: 'automatic' })
  assertEquals(auto.allowed, false)
  assert(auto.reason?.includes('quota'))
  const manual = await checkAutofixBudget(fakeDb(UNDER_SPEND, { count: 3 }), 'p1', CAPS, { trigger: 'manual' })
  assertEquals(manual.allowed, true)
  assertEquals(manual.dispatchesToday, 3)
})

Deno.test('the approval gate applies to automatic dispatches only', async () => {
  const caps = { ...CAPS, autofix_approval_cost_threshold_usd: 0.1 }
  const auto = await checkAutofixBudget(fakeDb(UNDER_SPEND, { count: 0 }), 'p1', caps, {
    trigger: 'automatic',
    severity: 'critical',
    estimatedCostUsd: 0.25,
  })
  assertEquals(auto.requiresApproval, true)
  const manual = await checkAutofixBudget(fakeDb(UNDER_SPEND, { count: 0 }), 'p1', caps, {
    trigger: 'manual',
    severity: 'critical',
    estimatedCostUsd: 0.25,
  })
  assertEquals(manual.requiresApproval, false)
})

Deno.test('a failed spend read throws instead of reading as $0', async () => {
  await assertRejects(
    () => checkAutofixBudget(fakeDb({ error: { message: 'statement timeout' } }, { count: 0 }), 'p1', CAPS, { trigger: 'automatic' }),
    AutofixBudgetUnavailableError,
    'statement timeout',
  )
  await assertRejects(
    () => checkAutofixBudget(fakeDb(UNDER_SPEND, { error: { message: 'permission denied' } }), 'p1', CAPS, { trigger: 'manual' }),
    AutofixBudgetUnavailableError,
  )
})

Deno.test('only an explicit manual trigger counts as manual', () => {
  assertEquals(dispatchTrigger({ trigger: 'manual', agent_override: 'cursor_cloud' }), 'manual')
  assertEquals(dispatchTrigger({ trigger: 'automatic' }), 'automatic')
  assertEquals(dispatchTrigger({ source: 'slack' }), 'automatic')
  assertEquals(dispatchTrigger(null), 'automatic')
})

Deno.test('a sibling job never fans out again', () => {
  assertEquals(isSiblingDispatch({ coordination_id: 'c1', dispatch_metadata: {} }), true)
  assertEquals(isSiblingDispatch({ coordination_id: null, dispatch_metadata: { target_repo_id: 'r2' } }), true)
  assertEquals(isSiblingDispatch({ coordination_id: null, dispatch_metadata: { trigger: 'manual' } }), false)
})

Deno.test('caps body: positive numbers or null, at least one field', () => {
  assertEquals(parseAutofixCapsBody({ maxSpendUsd: 2, maxDispatchesPerDay: 3 }), {
    ok: true,
    patch: { autofix_max_spend_usd: 2, autofix_max_dispatches_per_day: 3 },
  })
  assertEquals(parseAutofixCapsBody({ maxSpendUsd: null }), { ok: true, patch: { autofix_max_spend_usd: null } })
  assertEquals(parseAutofixCapsBody({ maxSpendUsd: 0 }).ok, false)
  assertEquals(parseAutofixCapsBody({ maxDispatchesPerDay: 1.5 }).ok, false)
  assertEquals(parseAutofixCapsBody({}).ok, false)
  assertEquals(parseAutofixCapsBody(null).ok, false)
})
