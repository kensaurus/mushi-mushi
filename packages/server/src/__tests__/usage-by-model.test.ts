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

// The UsageByModel unit tests live in llm-cost.test.ts (prices come from the shared book).

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
