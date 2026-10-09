/**
 * FILE: prompt-lab-contracts.test.ts
 * PURPOSE: Prompt Lab contracts that used to fail silently:
 *          - Clone accepted only stage1/stage2, although eight more workers
 *            read project overrides through getPromptForStage;
 *          - fine-tuning jobs could be created for a vendor that can never
 *            train (Anthropic direct);
 *          - every fine-tuning step dynamically imported `../_shared/…`
 *            from api/routes, a directory that does not exist, so Export,
 *            Submit, Poll, Validate and Promote all threw "module not found".
 *            The last check covers every dynamic import under api/.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CUSTOMIZABLE_PROMPT_STAGES,
  isCustomizablePromptStage,
} from '../../supabase/functions/_shared/prompt-stages.ts'
import { fineTuneBaseModelError } from '../../supabase/functions/_shared/fine-tune-base-model.ts'

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
const ADMIN_TYPES = resolve(__dirname, '../../../../apps/admin/src/components/prompt-lab/types.ts')

describe('customizable prompt stages', () => {
  it('match the stages a worker reads through getPromptForStage', () => {
    const readers = new Set<string>()
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts')) {
          for (const m of readFileSync(full, 'utf8').matchAll(/getPromptForStage\([^)]*?,\s*'([^']+)'\s*\)/g)) {
            readers.add(m[1]!)
          }
        }
      }
    }
    walk(FUNCTIONS)
    expect([...readers].sort()).toEqual([...CUSTOMIZABLE_PROMPT_STAGES].sort())
  })

  it('accepts the judge stage and rejects stages nobody reads', () => {
    expect(isCustomizablePromptStage('judge')).toBe(true)
    expect(isCustomizablePromptStage('modernizer')).toBe(false)
    expect(isCustomizablePromptStage(42)).toBe(false)
  })

  it('is mirrored by the console list', () => {
    const src = readFileSync(ADMIN_TYPES, 'utf8')
    const block = /CUSTOMIZABLE_PROMPT_STAGES: readonly string\[\] = \[([\s\S]*?)\]/.exec(src)?.[1] ?? ''
    const consoleStages = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
    expect(consoleStages.sort()).toEqual([...CUSTOMIZABLE_PROMPT_STAGES].sort())
  })
})

describe('fineTuneBaseModelError', () => {
  it('allows OpenAI and Bedrock models', () => {
    expect(fineTuneBaseModelError('openai:gpt-4o-mini')).toBeNull()
    expect(fineTuneBaseModelError('bedrock:anthropic.claude-3-haiku-20240307-v1:0')).toBeNull()
  })

  it('refuses vendors that can never train', () => {
    expect(fineTuneBaseModelError('anthropic:contact-required')).toMatch(/Bedrock/)
    expect(fineTuneBaseModelError('claude-sonnet-4-6')).toMatch(/Bedrock/)
    expect(fineTuneBaseModelError('mystery-model')).toMatch(/Unknown base model/)
    expect(fineTuneBaseModelError('')).toBeTruthy()
  })
})

describe('dynamic imports under api/', () => {
  it('every relative `await import()` resolves to a file that exists', () => {
    const missing: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts')) {
          for (const m of readFileSync(full, 'utf8').matchAll(/await import\('(\.{1,2}\/[^']+)'\)/g)) {
            if (!existsSync(resolve(dirname(full), m[1]!))) missing.push(`${full.slice(FUNCTIONS.length + 1)} → ${m[1]}`)
          }
        }
      }
    }
    walk(join(FUNCTIONS, 'api'))
    expect(missing).toEqual([])
  })
})
