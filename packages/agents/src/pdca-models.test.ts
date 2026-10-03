import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PDCA_CLAUDE_MODELS,
  PDCA_DEFAULT_MODEL,
  PDCA_OPENAI_FALLBACK_MODEL,
  PDCA_PRICING_PER_M_TOKENS,
  pdcaCallCostUsd,
  resolvePdcaClaudeModel,
} from './pdca-models.js'

const SERVER_SHARED = resolve(__dirname, '../../server/supabase/functions/_shared')

/** `'model': { in: 1.00, out: 5.00 }` rows of the server pricing table. */
function serverPrices(): Map<string, { in: number; out: number }> {
  const source = readFileSync(resolve(SERVER_SHARED, 'pricing.ts'), 'utf8')
  const rows = new Map<string, { in: number; out: number }>()
  for (const m of source.matchAll(/'([\w.-]+)':\s*\{\s*in:\s*([\d.]+),\s*out:\s*([\d.]+)\s*\}/g)) {
    rows.set(m[1], { in: Number(m[2]), out: Number(m[3]) })
  }
  return rows
}

describe('pdca-models', () => {
  it('prices every model exactly as the server pricing table does', () => {
    const server = serverPrices()
    expect(server.size).toBeGreaterThan(10)
    for (const [model, price] of Object.entries(PDCA_PRICING_PER_M_TOKENS)) {
      expect(server.get(model), `server pricing.ts row for ${model}`).toEqual(price)
    }
  })

  it('defaults to the same Sonnet and OpenAI fallback as the server', () => {
    const models = readFileSync(resolve(SERVER_SHARED, 'models.ts'), 'utf8')
    expect(models).toContain(`export const ANTHROPIC_SONNET_LATEST = '${PDCA_DEFAULT_MODEL}'`)
    expect(models).toContain(`export const OPENAI_PRIMARY = '${PDCA_OPENAI_FALLBACK_MODEL}'`)
    expect(PDCA_DEFAULT_MODEL).toBe('claude-sonnet-5-5')
    expect(PDCA_CLAUDE_MODELS).toContain(PDCA_DEFAULT_MODEL)
  })

  it('resolves absent to the default, trims, and refuses anything unpriced', () => {
    expect(resolvePdcaClaudeModel('primaryModel', undefined)).toBe('claude-sonnet-5-5')
    expect(resolvePdcaClaudeModel('judgeModel', ' claude-opus-5-5 ')).toBe('claude-opus-5-5')
    for (const bad of ['', 'claude-sonnet-4-6', 'claude-foo', 'gpt-5.4']) {
      expect(() => resolvePdcaClaudeModel('judgeModel', bad)).toThrow(/is not a model the PDCA runner can call and price/)
    }
  })

  it('computes cost per call from token counts', () => {
    expect(pdcaCallCostUsd('claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(12, 10)
    expect(pdcaCallCostUsd('gpt-5.4', { inputTokens: undefined, outputTokens: 2_000_000 })).toBeCloseTo(30, 10)
  })
})
