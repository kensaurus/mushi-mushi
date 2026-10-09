import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  AutofixBudgetUnavailableError,
  budgetSnapshot,
  checkAutofixBudget,
  dispatchTrigger,
  isSiblingDispatch,
  validateSpendLimit,
} from '../_shared/autofix-budget.ts'
import { siblingDispatchRow } from '../_shared/sibling-dispatch.ts'

type Row = Record<string, unknown>

/**
 * In-memory stand-in for the two tables the budget reads. eq / neq / gte are
 * applied to the rows, so the tests check the real query, not a canned count.
 */
// deno-lint-ignore no-explicit-any
function fakeDb(tables: { llm_invocations?: Row[]; fix_dispatch_jobs?: Row[] }, fail: Partial<Record<string, string>> = {}): any {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b,
        limit: () => b,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
        gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), b),
        then(resolve: (v: unknown) => void) {
          if (fail[table]) return resolve({ data: null, error: { message: fail[table] } })
          const rows = ((tables as Record<string, Row[]>)[table] ?? []).filter((r) => filters.every((f) => f(r)))
          resolve({ data: rows, error: null })
        },
      }
      return b
    },
  }
}

const P = 'p1'
const today = () => new Date().toISOString()
const yesterday = () => new Date(Date.now() - 86_400_000 * 1.5).toISOString()
const job = (id: string, over: Row = {}): Row => ({
  id,
  project_id: P,
  status: 'completed',
  created_at: today(),
  dispatch_metadata: {},
  ...over,
})
const spend = (usd: number): Row => ({ project_id: P, function_name: 'fix-worker', created_at: today(), cost_usd: usd })

const CAPS = { autofix_max_spend_usd: 2, autofix_max_dispatches_per_day: 3, autofix_approval_cost_threshold_usd: null }

Deno.test('a daily cap of 3 allows exactly 3 automatic dispatches', async () => {
  // The dispatch being checked is already a row; prior ones are counted.
  const rows = [job('a'), job('b'), job('current', { status: 'running' })]
  const third = await checkAutofixBudget(fakeDb({ fix_dispatch_jobs: rows }), P, CAPS, {
    trigger: 'automatic',
    excludeDispatchId: 'current',
  })
  assertEquals(third.dispatchesToday, 2)
  assertEquals(third.allowed, true)

  const fourth = await checkAutofixBudget(
    fakeDb({ fix_dispatch_jobs: [...rows.slice(0, 2), job('c'), job('current', { status: 'running' })] }),
    P,
    CAPS,
    { trigger: 'automatic', excludeDispatchId: 'current' },
  )
  assertEquals(fourth.dispatchesToday, 3)
  assertEquals(fourth.allowed, false)
  assert(fourth.reason?.includes('quota'))
})

Deno.test('the daily count skips skipped, manual, other-project and earlier-day dispatches', async () => {
  const rows = [
    job('skipped', { status: 'skipped' }),
    job('manual', { dispatch_metadata: { trigger: 'manual' } }),
    job('other', { project_id: 'p2' }),
    job('old', { created_at: yesterday() }),
    job('auto'),
  ]
  const check = await checkAutofixBudget(fakeDb({ fix_dispatch_jobs: rows }), P, CAPS, { trigger: 'automatic' })
  assertEquals(check.dispatchesToday, 1)
})

Deno.test("sibling fan-out jobs count against the parent project's caps", async () => {
  const sibling = (id: string): Row => ({
    id,
    created_at: today(),
    ...siblingDispatchRow({
      projectId: P,
      reportId: 'r1',
      coordinationId: 'c1',
      sibling: { id: `repo-${id}`, repo_url: `https://github.com/o/${id}` },
      prUrl: 'https://github.com/o/front/pull/1',
      siblingCount: 3,
    }),
    status: 'completed',
  })
  // A primary plus two siblings already ran today; the third sibling is checked.
  const rows = [job('primary'), sibling('s1'), sibling('s2'), { ...sibling('s3'), status: 'running' }]
  const check = await checkAutofixBudget(fakeDb({ fix_dispatch_jobs: rows }), P, CAPS, {
    trigger: dispatchTrigger(sibling('s3').dispatch_metadata),
    excludeDispatchId: 's3',
  })
  assertEquals(check.trigger, 'automatic')
  assertEquals(check.dispatchesToday, 3)
  assertEquals(check.allowed, false)

  // Sibling LLM spend is fix-worker spend of the same project.
  const spent = await checkAutofixBudget(
    fakeDb({ llm_invocations: [spend(1.5), spend(0.75)], fix_dispatch_jobs: [] }),
    P,
    CAPS,
    { trigger: 'automatic' },
  )
  assertEquals(spent.allowed, false)
  assert(spent.reason?.includes('spend ceiling'))
})

Deno.test('automatic dispatch is blocked once the 30-day spend cap is reached', async () => {
  const check = await checkAutofixBudget(fakeDb({ llm_invocations: [spend(1.5), spend(0.75)] }), P, CAPS, { trigger: 'automatic' })
  assertEquals(check.allowed, false)
  assert(check.reason?.includes('spend ceiling'))
  assertEquals(check.capExceeded, true)
})

Deno.test('manual dispatch proceeds past the caps and reports the 30-day spend', async () => {
  const check = await checkAutofixBudget(
    fakeDb({ llm_invocations: [spend(1.5), spend(0.75)], fix_dispatch_jobs: [job('a'), job('b'), job('c')] }),
    P,
    CAPS,
    { trigger: 'manual' },
  )
  assertEquals(check.allowed, true)
  assertEquals(check.capExceeded, true)
  assertEquals(check.spendUsd30d, 2.25)
  assertEquals(check.maxSpendUsd, 2)
  const snap = budgetSnapshot(check)
  assertEquals(snap.trigger, 'manual')
  assertEquals(snap.spend_usd_30d, 2.25)
  assertEquals(snap.cap_exceeded, true)
})

Deno.test('the approval gate applies to manual and automatic dispatches alike', async () => {
  const caps = { ...CAPS, autofix_approval_cost_threshold_usd: 0.1 }
  const opts = { severity: 'critical', estimatedCostUsd: 0.25 }
  const auto = await checkAutofixBudget(fakeDb({}), P, caps, { ...opts, trigger: 'automatic' })
  assertEquals(auto.requiresApproval, true)
  // The caps step aside for a person; the owner's approval threshold does not.
  const manual = await checkAutofixBudget(fakeDb({}), P, caps, { ...opts, trigger: 'manual' })
  assertEquals(manual.requiresApproval, true)
  assertEquals(manual.allowed, true)
})

Deno.test('a failed budget read throws instead of reading as zero', async () => {
  await assertRejects(
    () => checkAutofixBudget(fakeDb({}, { llm_invocations: 'statement timeout' }), P, CAPS, { trigger: 'automatic' }),
    AutofixBudgetUnavailableError,
    'statement timeout',
  )
  await assertRejects(
    () => checkAutofixBudget(fakeDb({}, { fix_dispatch_jobs: 'permission denied' }), P, CAPS, { trigger: 'manual' }),
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

Deno.test('a repo a person chose means that repo only: the job never fans out', () => {
  assertEquals(
    isSiblingDispatch({ coordination_id: null, dispatch_metadata: { trigger: 'manual', target_repo_id: 'r2' } }),
    true,
  )
  assertEquals(
    isSiblingDispatch({ coordination_id: null, dispatch_metadata: { trigger: 'automatic', target_repo_id: 'r2' } }),
    true,
  )
  assertEquals(
    isSiblingDispatch({ coordination_id: 'c1', dispatch_metadata: { trigger: 'manual', target_repo_id: 'r2' } }),
    true,
  )
})

Deno.test('spend limits: positive numbers (whole for the daily cap) or null', () => {
  assertEquals(validateSpendLimit('autofix_max_spend_usd', 2), { ok: true, value: 2 })
  assertEquals(validateSpendLimit('autofix_max_spend_usd', 2.345), { ok: true, value: 2.35 })
  assertEquals(validateSpendLimit('monthly_llm_budget_usd', null), { ok: true, value: null })
  assertEquals(validateSpendLimit('autofix_max_dispatches_per_day', 3), { ok: true, value: 3 })
  assertEquals(validateSpendLimit('autofix_max_dispatches_per_day', 1.5).ok, false)
  assertEquals(validateSpendLimit('autofix_max_dispatches_per_day', 0).ok, false)
  assertEquals(validateSpendLimit('autofix_approval_cost_threshold_usd', 0).ok, false)
  assertEquals(validateSpendLimit('monthly_llm_budget_usd', -5).ok, false)
  assertEquals(validateSpendLimit('monthly_llm_budget_usd', '5').ok, false)
  assertEquals(validateSpendLimit('monthly_llm_budget_usd', 1_000_000).ok, false)
})
