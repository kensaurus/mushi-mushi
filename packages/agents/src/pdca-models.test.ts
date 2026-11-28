import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PDCA_CLAUDE_MODELS,
  PDCA_DEFAULT_MODEL,
  PDCA_OPENAI_FALLBACK_MODEL,
  resolvePdcaClaudeModel,
} from './pdca-models.js'

const SERVER_SHARED = resolve(__dirname, '../../server/supabase/functions/_shared')

describe('pdca-models', () => {
  it('keeps no price table: prices come from the shared price book through priceCall', () => {
    const source = readFileSync(resolve(__dirname, 'pdca-models.ts'), 'utf8')
    expect(source).not.toMatch(/in:\s*[\d.]+,\s*out:\s*[\d.]+/)
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
      expect(() => resolvePdcaClaudeModel('judgeModel', bad)).toThrow(/is not a model the PDCA runner can call/)
    }
  })

})
