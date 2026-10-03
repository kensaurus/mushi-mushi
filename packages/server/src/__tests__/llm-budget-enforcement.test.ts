/**
 * FILE: llm-budget-enforcement.test.ts
 * PURPOSE: project_settings.monthly_llm_budget_usd is enforced on the shared
 *          LLM path (Plan 020 P-2). It used to be stored and drawn on the
 *          Costs page but never read before a call.
 *
 * `llm-failover.ts` reads Deno.env at load, so `Deno` is stubbed before the
 * dynamic imports below (same approach as hosted-oauth-discovery.test.ts).
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

type Answer = { data?: unknown; error?: { message: string } | null }
interface Op {
  table: string
  filters: Record<string, unknown>
  range?: [number, number]
}

/** PostgREST stand-in: every chain resolves through `answer`. */
function fakeDb(answer: (op: Op) => Answer) {
  const ops: Op[] = []
  const db = {
    from(table: string) {
      const op: Op = { table, filters: {} }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        eq: (c: string, v: unknown) => ((op.filters[c] = v), b),
        gte: (c: string, v: unknown) => ((op.filters[`${c}>=`] = v), b),
        in: () => b,
        order: () => b,
        range: (from: number, to: number) => ((op.range = [from, to]), b),
        maybeSingle: () => b,
        single: () => b,
        update: () => b,
        then(resolve: (v: unknown) => void) {
          ops.push(op)
          const a = answer(op)
          resolve({ data: a.data ?? null, error: a.error ?? null })
        },
      }
      return b
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  }
  return { db, ops }
}

/** A project with `budget` and invocations totalling `spend` (in $0.50 rows). */
function project(budget: number | null, spend: number, extra: (op: Op) => Answer | null = () => null) {
  const rows = Array.from({ length: Math.round(spend / 0.5) }, () => ({
    used_model: 'claude-sonnet-5-5',
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0.5,
  }))
  return fakeDb((op) => {
    const custom = extra(op)
    if (custom) return custom
    if (op.table === 'project_settings') return { data: { monthly_llm_budget_usd: budget } }
    if (op.table === 'llm_invocations') {
      const [from, to] = op.range ?? [0, rows.length]
      return { data: rows.slice(from, to + 1) }
    }
    if (op.table === 'llm_cost_usd') return { data: [] }
    if (op.table === 'byok_keys') return { data: [] }
    return { data: null }
  })
}

type Budget = typeof import('../../supabase/functions/_shared/llm-budget.ts')
type Failover = typeof import('../../supabase/functions/_shared/llm-failover.ts')
type Byok = typeof import('../../supabase/functions/_shared/byok.ts')
let budget: Budget
let failover: Failover
let byok: Byok

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  budget = await import('../../supabase/functions/_shared/llm-budget.ts')
  failover = await import('../../supabase/functions/_shared/llm-failover.ts')
  byok = await import('../../supabase/functions/_shared/byok.ts')
})

beforeEach(() => budget.resetLlmBudgetCache())

const NOW = new Date('2026-10-15T12:00:00Z')

describe('readLlmBudgetState', () => {
  it('under budget', async () => {
    const { db } = project(5, 2)
    const s = await budget.readLlmBudgetState(db as never, 'p1', NOW)
    expect(s).toMatchObject({ budgetUsd: 5, spendUsd: 2, over: false })
    expect(s.resetsAt).toBe('2026-11-01T00:00:00.000Z')
  })

  it('over budget', async () => {
    const { db } = project(5, 6)
    expect((await budget.readLlmBudgetState(db as never, 'p1', NOW)).over).toBe(true)
  })

  it('counts this UTC month only, both key sources', async () => {
    const { db, ops } = project(5, 1)
    await budget.readLlmBudgetState(db as never, 'p1', NOW)
    const inv = ops.find((o) => o.table === 'llm_invocations')!
    expect(inv.filters['created_at>=']).toBe('2026-10-01T00:00:00.000Z')
    // No key_source filter: BYOK and platform-key calls both count.
    expect(Object.keys(inv.filters)).toEqual(['project_id', 'created_at>='])
  })

  it('no budget: no spend query at all', async () => {
    const { db, ops } = project(null, 100)
    const s = await budget.readLlmBudgetState(db as never, 'p1', NOW)
    expect(s.over).toBe(false)
    expect(ops.map((o) => o.table)).toEqual(['project_settings'])
  })

  it('a failed read throws instead of reading as $0', async () => {
    const { db } = project(5, 0, (op) =>
      op.table === 'llm_invocations' ? { error: { message: 'statement timeout' } } : null,
    )
    await expect(budget.readLlmBudgetState(db as never, 'p1', NOW)).rejects.toBeInstanceOf(
      budget.LlmBudgetUnavailableError,
    )
  })
})

describe('the shared LLM path enforces the budget', () => {
  it('withLlmFailover refuses before any provider call when over budget', async () => {
    const { db } = project(5, 6)
    let called = false
    const err = await failover
      .withLlmFailover(db as never, 'p1', 'anthropic', async () => {
        called = true
        return 'x'
      })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(budget.LlmBudgetExceededError)
    expect(String((err as Error).message)).toContain('llm_budget_exceeded')
    expect(called).toBe(false)
  })

  it('withLlmFailover proceeds under budget (fails later only for lack of a key)', async () => {
    const { db } = project(5, 2)
    const err = await failover
      .withLlmFailover(db as never, 'p1', 'anthropic', async () => 'x')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(failover.LlmFailoverError)
    expect((err as { code: string }).code).toBe('NO_KEYS_CONFIGURED')
  })

  it('withAnthropicOrOpenAi does not fall through to OpenAI when over budget', async () => {
    const { db } = project(5, 6)
    let openAiCalled = false
    const err = await failover
      .withAnthropicOrOpenAi(
        db as never,
        'p1',
        async () => 'a',
        async () => {
          openAiCalled = true
          return 'o'
        },
      )
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(budget.LlmBudgetExceededError)
    expect(openAiCalled).toBe(false)
  })

  it('resolveLlmKey enforces for generation, not for probes or embeddings', async () => {
    const { db } = project(5, 6)
    await expect(byok.resolveLlmKey(db as never, 'p1', 'openai')).rejects.toBeInstanceOf(
      budget.LlmBudgetExceededError,
    )
    await expect(byok.resolveLlmKey(db as never, 'p1', 'openai', { purpose: 'probe' })).resolves.toBeNull()
    await expect(byok.resolveLlmKey(db as never, 'p1', 'openai', { purpose: 'embedding' })).resolves.toBeNull()
    // Non-LLM providers are outside the budget.
    await expect(byok.resolveLlmKey(db as never, 'p1', 'firecrawl')).resolves.toBeNull()
  })

  it('a failed budget read lets the call proceed (and is logged), never blocks triage', async () => {
    const { db } = project(5, 0, (op) =>
      op.table === 'project_settings' && !('provider_slug' in op.filters)
        ? { error: { message: 'connection reset' } }
        : null,
    )
    await expect(
      byok.enforceLlmBudget(db as never, 'p1', 'anthropic'),
    ).resolves.toBeUndefined()
  })

  it('Stage 1 treats over-budget as "LLM unavailable" and falls back to heuristics', () => {
    const e = new budget.LlmBudgetExceededError('p1', 6, 5, '2026-11-01T00:00:00.000Z')
    expect(failover.isStage1LlmUnavailable(e)).toBe(true)
  })
})
