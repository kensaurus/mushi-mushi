/**
 * FILE: packages/server/src/__tests__/claude-call-paths.test.ts
 * PURPOSE: Keep every Sonnet caller on `claude-messages.ts`, and keep every
 *          routed model priced.
 *
 * Why (2026-10-03, gap #14b): Sonnet 5.5 rejects a non-default `temperature`
 * and a forced `tool_choice`. AI SDK v4 (`createAnthropic` + `generateObject`
 * / `generateText` / `streamText`) sends both on every call, so a route on
 * that path 400s on every Sonnet 5.5 call and silently falls back to OpenAI
 * (or fails outright where there is no fallback). These routes moved to
 * `claude-messages.ts`; only Haiku 4.5 calls, which still accept the v4
 * shape, may stay on `createAnthropic`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as models from '../../supabase/functions/_shared/models.ts'
import { LLM_PRICING_PER_M_TOKENS } from '../../supabase/functions/_shared/pricing.ts'

const FUNCTIONS_ROOT = resolve(__dirname, '../../supabase/functions')

/** The gap #14b routes and the model constant each one routes Sonnet calls to. */
const MIGRATED: Array<{ file: string; constants: string[] }> = [
  { file: 'release-builder/index.ts', constants: ['RELEASE_NOTES_MODEL'] },
  { file: 'story-mapper/index.ts', constants: ['STORY_MAP_MODEL'] },
  { file: 'mistake-clusterer/index.ts', constants: ['MISTAKE_MODEL'] },
  { file: 'mistake-summarizer/index.ts', constants: ['MISTAKE_MODEL'] },
  { file: 'inventory-propose/index.ts', constants: ['INVENTORY_PROPOSE_MODEL'] },
  { file: 'api/routes/codebase-understand.ts', constants: ['CODEBASE_ASSIST_MODEL'] },
  { file: '_shared/nl-query.ts', constants: ['NL_QUERY_PLANNER_MODEL'] },
  { file: 'generate-synthetic/index.ts', constants: ['SYNTHETIC_MODEL'] },
  { file: 'library-modernizer/index.ts', constants: ['MODERNIZER_MODEL'] },
  { file: 'prompt-auto-tune/index.ts', constants: ['PROMPT_TUNE_MODEL'] },
  { file: 'test-gen-from-story/index.ts', constants: ['TEST_GEN_MODEL'] },
]

/** Model constants a `createAnthropic` provider may still be called with. */
const AI_SDK_V4_SAFE = new Set(['ANTHROPIC_HAIKU', 'NL_QUERY_SUMMARY_MODEL'])

const modelValues = models as unknown as Record<string, unknown>

describe('gap #14b: Sonnet callers use claude-messages.ts', () => {
  for (const { file, constants } of MIGRATED) {
    describe(file, () => {
      const src = readFileSync(resolve(FUNCTIONS_ROOT, file), 'utf8')

      it('calls Claude through claude-messages.ts', () => {
        expect(src).toMatch(/claude(Generate|Stream)(Object|Text)\(/)
        expect(src).toMatch(/from '\.\.?\/(\.\.\/)?(_shared\/)?claude-messages\.ts'/)
      })

      it('hands a createAnthropic provider only Haiku', () => {
        // `anthropic(X)`, `anthropicFast(X)`, `createAnthropic({...})(X)`.
        const calls = [...src.matchAll(/\banthropic\w*\(\s*([A-Z_][A-Z0-9_]*|'[^']*')\s*\)/g)].map((m) => m[1])
        for (const arg of calls) expect(AI_SDK_V4_SAFE.has(arg), `${file} passes ${arg} to the AI SDK v4 provider`).toBe(true)
        expect(src).not.toMatch(/createAnthropic\([^)]*\)\(/)
      })

      it('routes to Sonnet 5.5, which only the claude-messages path can call', () => {
        for (const name of constants) {
          expect(modelValues[name], name).toBe(models.ANTHROPIC_SONNET_LATEST)
          expect(src).toContain(name)
        }
        expect(models.acceptsSamplingKnobs(models.ANTHROPIC_SONNET_LATEST)).toBe(false)
      })
    })
  }
})

describe('every model a route can call is priced', () => {
  const modelIds = Object.entries(modelValues)
    .filter(([, v]) => typeof v === 'string' && /^(claude-|gpt-|text-embedding-)/.test(v))
    .map(([k, v]) => [k, v as string] as const)

  it('finds the model constants', () => {
    expect(modelIds.length).toBeGreaterThan(10)
  })

  for (const [name, id] of modelIds) {
    it(`${name} (${id}) has a pricing.ts row`, () => {
      expect(LLM_PRICING_PER_M_TOKENS[id], `${id} is unpriced, so it would bill at the fallback rate`).toBeDefined()
    })
  }

  it('the server-side refusal fallback of Sonnet 5.5 is priced too', () => {
    // A refusal fallback is served (and billed) as `claude-sonnet-5`.
    expect(LLM_PRICING_PER_M_TOKENS['claude-sonnet-5']).toBeDefined()
  })
})
