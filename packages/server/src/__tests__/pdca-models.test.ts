/**
 * FILE: pdca-models.test.ts
 * PURPOSE: PDCA runs use the canonical Sonnet (5.5) through claude-messages.
 *          Locks the queue-time validation, the run-time model resolution
 *          (retired and non-Claude ids fall back to the default), and that
 *          pdca-runner no longer hardcodes Sonnet 4.5 or calls Claude through
 *          AI SDK v4, which Sonnet 5.5 rejects.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDCA_DEFAULT_MODEL, pdcaModelError, resolvePdcaModel } from '../../supabase/functions/_shared/pdca-models.ts'
import { ANTHROPIC_SONNET_LATEST } from '../../supabase/functions/_shared/models.ts'

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')

describe('PDCA model rules', () => {
  it('defaults to the canonical current Sonnet', () => {
    expect(PDCA_DEFAULT_MODEL).toBe(ANTHROPIC_SONNET_LATEST)
    expect(PDCA_DEFAULT_MODEL).toBe('claude-sonnet-5-5')
  })

  it('accepts absent or Claude ids and refuses everything else at queue time', () => {
    expect(pdcaModelError('primary_model', undefined)).toBeNull()
    expect(pdcaModelError('primary_model', '')).toBeNull()
    expect(pdcaModelError('primary_model', 'claude-sonnet-5-5')).toBeNull()
    expect(pdcaModelError('judge_model', 'claude-opus-5-5')).toBeNull()
    expect(pdcaModelError('judge_model', 'claude-haiku-4-5')).toBeNull()
    expect(pdcaModelError('primary_model', 'gpt-5.4')).toContain('primary_model must be a Claude model id')
    expect(pdcaModelError('judge_model', 42)).toContain('judge_model')
    expect(pdcaModelError('judge_model', 'claude-; drop table')).not.toBeNull()
  })

  it('refuses a Claude-shaped id the runner cannot call or price, and accepts every console choice', () => {
    expect(pdcaModelError('primary_model', 'claude-foo')).toContain('is not a Claude model Mushi knows')
    expect(pdcaModelError('judge_model', 'claude-sonnet-9-9')).toContain('is not a Claude model Mushi knows')
    // Retired or dated ids still resolve to a priced model, so they pass.
    expect(pdcaModelError('primary_model', 'claude-sonnet-4-5')).toBeNull()
    expect(pdcaModelError('primary_model', 'claude-haiku-4-5-20251001')).toBeNull()
    const consoleTypes = readFileSync(resolve(__dirname, '../../../../apps/admin/src/components/iterate/types.ts'), 'utf-8')
    const choices = [...consoleTypes.slice(consoleTypes.indexOf('export const MODEL_OPTIONS')).matchAll(/value: '([^']+)'/g)].map((m) => m[1])
    expect(choices).toEqual(['claude-opus-5-5', 'claude-haiku-4-5'])
    for (const id of [PDCA_DEFAULT_MODEL, ...choices]) expect(pdcaModelError('primary_model', id)).toBeNull()
  })

  it('maps stored retired or non-Claude models to the default at run time', () => {
    expect(resolvePdcaModel(null)).toBe(PDCA_DEFAULT_MODEL)
    expect(resolvePdcaModel('gpt-5.4')).toBe(PDCA_DEFAULT_MODEL)
    expect(resolvePdcaModel('claude-sonnet-4-5')).toBe(PDCA_DEFAULT_MODEL)
    expect(resolvePdcaModel('claude-3-5-sonnet-20241022')).toBe(PDCA_DEFAULT_MODEL)
    expect(resolvePdcaModel('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
    expect(resolvePdcaModel('claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(resolvePdcaModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
  })
})

describe('pdca-runner source', () => {
  const src = readFileSync(resolve(FUNCTIONS, 'pdca-runner/index.ts'), 'utf-8')

  it('has no hardcoded Claude model ids and no AI SDK Anthropic provider', () => {
    expect(src).not.toMatch(/claude-sonnet-4-5/)
    expect(src).not.toMatch(/['"]claude-[a-z0-9-]+['"]/)
    expect(src).not.toContain('createAnthropic')
    expect(src).not.toContain("'gpt-5.4'")
    // Every OpenAI fallback (producer, critic and the QA-story improver) uses the shared id.
    expect(src).not.toContain("'gpt-4.1'")
    expect(src).not.toMatch(/createOpenAI\([^)]*\)\('gpt-/)
  })

  it('calls Claude through claude-messages and resolves stored models', () => {
    expect(src).toContain('claudeGenerateObject')
    expect(src).toContain('claudeGenerateText')
    expect(src).toContain('resolvePdcaModel(run.primary_model')
    expect(src).toContain('resolvePdcaModel(run.judge_model')
    expect(src).toContain('estimateCallCostUsd(')
  })

  it('the queue route defaults to the shared model and validates both fields', () => {
    const route = readFileSync(resolve(FUNCTIONS, 'api/routes/pdca.ts'), 'utf-8')
    expect(route).not.toContain("'claude-sonnet-4-6'")
    expect(route).toContain("pdcaModelError('primary_model'")
    expect(route).toContain("pdcaModelError('judge_model'")
    expect(route).toContain('PDCA_DEFAULT_MODEL')
  })
})
