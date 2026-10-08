/**
 * FILE: stage1-model.test.ts
 * PURPOSE: fast-filter honours project_settings.stage1_model.
 *
 * Regression (2026-10-09): the column was stored but never read, so moving
 * the-wanting-mind's quick check to Haiku 5.5 changed nothing. The default
 * (unset, or the column default) must keep the exact request fast-filter
 * always sent; a 5.x model must go through claude-messages.ts.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseClaudeModelSetting, resolveStage1Model } from '../../supabase/functions/_shared/stage1-model.ts'
import { estimateCallCostUsd } from '../../supabase/functions/_shared/pricing.ts'

describe('resolveStage1Model', () => {
  it('keeps Haiku 4.5 on the AI SDK path when unset or at the column default', () => {
    for (const stored of [null, undefined, '', 'claude-haiku-4-5-20251001', 'claude-haiku-4-5']) {
      expect(resolveStage1Model(stored)).toEqual({ model: 'claude-haiku-4-5', messagesApi: false })
    }
  })

  it('sends Haiku 5.5 through the Messages API path', () => {
    expect(resolveStage1Model('claude-haiku-5-5')).toEqual({ model: 'claude-haiku-5-5', messagesApi: true })
  })

  it('ignores a non-Claude id: Stage 1 calls Claude first', () => {
    expect(resolveStage1Model('gpt-5.4-mini').model).toBe('claude-haiku-4-5')
  })
})

describe('parseClaudeModelSetting', () => {
  it('accepts Claude ids', () => {
    expect(parseClaudeModelSetting(' claude-haiku-5-5 ')).toEqual({ ok: true, value: 'claude-haiku-5-5' })
    expect(parseClaudeModelSetting('claude-haiku-4-5-20251001')).toEqual({ ok: true, value: 'claude-haiku-4-5-20251001' })
  })

  it('rejects anything a Claude call cannot take', () => {
    for (const bad of ['gpt-5.4', '', null, 42, 'claude', 'claude-haiku-5-5; drop', 'CLAUDE-HAIKU-5-5']) {
      expect(parseClaudeModelSetting(bad).ok).toBe(false)
    }
  })
})

describe('Haiku 5.5 long-prompt pricing', () => {
  it('bills the base rate up to 100K prompt tokens', () => {
    expect(estimateCallCostUsd('claude-haiku-5-5', 100_000, 1_000)).toBeCloseTo(0.0105, 6)
  })

  it('bills the whole call at the long rate above 100K', () => {
    expect(estimateCallCostUsd('claude-haiku-5-5', 200_000, 1_000)).toBeCloseTo(0.1025, 6)
  })
})

describe('fast-filter wiring', () => {
  it('reads stage1_model and routes 5.x through claudeGenerateObject at low effort', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/fast-filter/index.ts'), 'utf8')
    expect(src).toContain("select('stage1_model, stage2_model,")
    expect(src).toContain('resolveStage1Model(settings?.stage1_model)')
    expect(src).not.toMatch(/PRIMARY_MODEL = STAGE1_MODEL\b/)
    const branch = src.slice(src.indexOf('if (stage1Choice.messagesApi)'))
    expect(branch.slice(0, 600)).toContain('claudeGenerateObject(')
    expect(branch.slice(0, 600)).toContain("effort: 'low'")
  })
})
