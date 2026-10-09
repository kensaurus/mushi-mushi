/**
 * FILE: packages/server/src/__tests__/usage-by-model.test.ts
 * PURPOSE: A run that calls two models (Claude, then the OpenAI fallback)
 *          writes one `llm_cost_usd` row per model.
 *
 * Why (2026-10-03, gap #14b review): mistake-summarizer wrote one row per run
 * with a compound model id such as `claude-sonnet-5-5+gpt-5.4-mini`. The cost
 * pages group and filter llm_cost_usd by model, so that run became a bogus
 * model bucket of its own and matched no model filter.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { estimateCallCostUsd, UsageByModel } from '../../supabase/functions/_shared/pricing.ts'

describe('UsageByModel', () => {
  it('keeps tokens and cost per model, in first-use order', () => {
    const ledger = new UsageByModel()
    ledger.record('claude-haiku-4-5', 100, 20)
    ledger.record('claude-sonnet-5-5', 1_000, 800)
    ledger.record('claude-haiku-4-5', 50, 10)
    ledger.record('gpt-5.4-mini', 400, 300)

    expect(ledger.rows()).toEqual([
      { model: 'claude-haiku-4-5', inputTokens: 150, outputTokens: 30, costUsd: estimateCallCostUsd('claude-haiku-4-5', 100, 20) + estimateCallCostUsd('claude-haiku-4-5', 50, 10) },
      { model: 'claude-sonnet-5-5', inputTokens: 1_000, outputTokens: 800, costUsd: estimateCallCostUsd('claude-sonnet-5-5', 1_000, 800) },
      { model: 'gpt-5.4-mini', inputTokens: 400, outputTokens: 300, costUsd: estimateCallCostUsd('gpt-5.4-mini', 400, 300) },
    ])
    for (const r of ledger.rows()) expect(r.model).not.toContain('+')
  })

  it('totals the cost across models', () => {
    const ledger = new UsageByModel()
    ledger.record('claude-sonnet-5-5', 1_000, 800)
    ledger.record('gpt-5.4-mini', 400, 300)
    expect(ledger.totalCostUsd).toBeCloseTo(estimateCallCostUsd('claude-sonnet-5-5', 1_000, 800) + estimateCallCostUsd('gpt-5.4-mini', 400, 300), 12)
  })

  it('is empty and costs nothing before any call', () => {
    const ledger = new UsageByModel()
    expect(ledger.rows()).toEqual([])
    expect(ledger.totalCostUsd).toBe(0)
  })

  it('hands out copies, so a caller cannot change the totals', () => {
    const ledger = new UsageByModel()
    ledger.record('claude-haiku-4-5', 10, 10)
    ledger.rows()[0].inputTokens = 999
    expect(ledger.rows()[0].inputTokens).toBe(10)
  })
})

describe('mistake-summarizer writes its spend per model', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/mistake-summarizer/index.ts'), 'utf8')

  // 2026-10-04: the spend moved from the legacy llm_cost_usd ledger to one
  // llm_invocations row per call. Writing both would count it twice on Costs
  // and against the budget, which sum the two tables.
  it('writes one llm_invocations row per call, each under its own model', () => {
    expect(src).toMatch(/new UsageByModel\(\)/)
    expect(src).toMatch(/usageWrites\.push\(recordLlmUsage\(db, \{[\s\S]*?\bmodel,/)
    expect(src).not.toContain("from('llm_cost_usd')")
    expect(src).not.toMatch(/\.join\('\+'\)/)
  })

  it('fails the run, never a silent 200, when the lesson or its cost cannot be written', () => {
    expect(src).toMatch(/const \{ error: updateErr \} = await db\.from\('lessons'\)\.update/)
    expect(src).toMatch(/const costErr = \(await Promise\.all\(usageWrites\)\)\.find\(\(w\) => w\.error\)/)
    expect(src).toMatch(/if \(costErr\) \{[\s\S]*?status: 500/)
  })
})
