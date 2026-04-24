/**
 * Regression tests for Sentry MUSHI-MUSHI-SERVER-9 — "Failed to evaluate
 * report" with upstream `400 invalid_request_error "Thinking may not be
 * enabled when tool_choice forces tool use."`
 *
 * The bug history:
 *   - Wave R (2026-04-22) bumped JUDGE_MODEL + PROMPT_TUNE_MODEL to Opus 4.7.
 *   - Opus 4.7 deprecated `temperature`. AI SDK v4 hardcodes
 *     `temperature ?? 0` in `prepareCallSettings`, so Anthropic 400'd every
 *     judge call.
 *   - Commit `e218bbf` (2026-04-24 01:37 UTC) tried to fix this by enabling
 *     Anthropic thinking mode (which strips `temperature` before the wire).
 *   - 1h23m after that deploy (2026-04-24 03:00 UTC) Sentry fired again with
 *     a NEW upstream message: "Thinking may not be enabled when tool_choice
 *     forces tool use." `generateObject` always sets
 *     `tool_choice: { type: 'tool', name: 'json' }` for Anthropic, which
 *     Anthropic forbids in combination with thinking. Tracked upstream in
 *     vercel/ai#7220 (closed) and vercel/ai#9351 (open).
 *
 * The fix: pin JUDGE_MODEL and PROMPT_TUNE_MODEL to a model that still
 * accepts `temperature` (Sonnet 4.6) and remove the broken thinking-mode
 * branch from both Edge Functions. This regression test prevents either
 * half from silently coming back:
 *
 *   1. JUDGE_MODEL and PROMPT_TUNE_MODEL must pass `acceptsSamplingKnobs`
 *      — otherwise the codepath WILL 400 because AI SDK v4 can't omit
 *      `temperature` and we just removed the (broken) thinking workaround.
 *   2. Neither Edge Function source may import `anthropicThinkingProviderOptions`
 *      or set `experimental_providerMetadata: { anthropic: { thinking ... } }`
 *      on a `generateObject` call — both are the exact pattern that re-fired
 *      SERVER-9.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  JUDGE_MODEL,
  PROMPT_TUNE_MODEL,
  ANTHROPIC_OPUS,
  acceptsSamplingKnobs,
} from '../../supabase/functions/_shared/models.ts'

const FUNCTIONS_ROOT = resolve(__dirname, '../../supabase/functions')

describe('MUSHI-MUSHI-SERVER-9 regression — Opus 4.7 + generateObject + thinking', () => {
  it('JUDGE_MODEL is not a model that requires the broken thinking workaround', () => {
    expect(acceptsSamplingKnobs(JUDGE_MODEL)).toBe(true)
    // Belt-and-braces: catch the literal "Wave R" regression by name.
    // If you genuinely need to revisit Opus 4.7 for judge, you must first
    // either upgrade to AI SDK v5 (which exposes a non-forced tool_choice
    // path) OR add the vercel/ai#7220 middleware AND a new test that proves
    // the middleware actually shipped. Bumping the model alone is not enough.
    expect(JUDGE_MODEL).not.toBe(ANTHROPIC_OPUS)
  })

  it('PROMPT_TUNE_MODEL is not a model that requires the broken thinking workaround', () => {
    expect(acceptsSamplingKnobs(PROMPT_TUNE_MODEL)).toBe(true)
    expect(PROMPT_TUNE_MODEL).not.toBe(ANTHROPIC_OPUS)
  })

  it('judge-batch/index.ts does not enable Anthropic thinking on a generateObject call', () => {
    const src = readFileSync(resolve(FUNCTIONS_ROOT, 'judge-batch/index.ts'), 'utf8')
    expect(src).not.toMatch(/anthropicThinkingProviderOptions/)
    expect(src).not.toMatch(/anthropic\s*:\s*\{\s*thinking\s*:/)
  })

  it('prompt-auto-tune/index.ts does not enable Anthropic thinking on a generateObject call', () => {
    const src = readFileSync(resolve(FUNCTIONS_ROOT, 'prompt-auto-tune/index.ts'), 'utf8')
    expect(src).not.toMatch(/anthropicThinkingProviderOptions/)
    expect(src).not.toMatch(/anthropic\s*:\s*\{\s*thinking\s*:/)
  })

  it('judge schema reasoning cap is generous enough for frontier models (>=2000 chars)', () => {
    // Sentry MUSHI-MUSHI-SERVER-9 follow-up: after we reverted to Sonnet
    // 4.6 the per-report path immediately started 8/8 failing because the
    // judge schema capped `reasoning` at 500 chars and Sonnet emits ~600–
    // 1500 char reasoning when `classification_agreed=false`. The cap was
    // bumped to 2000. Pin that here so a future "let's tighten the
    // reasoning cap" PR doesn't silently re-fire SERVER-9 with a different
    // underlying cause but the same Sentry fingerprint.
    const src = readFileSync(resolve(FUNCTIONS_ROOT, 'judge-batch/index.ts'), 'utf8')
    const match = src.match(/reasoning:\s*z\.string\(\)\.max\((\d+)\)/)
    expect(match, 'reasoning field with .max(N) should exist in judge-batch/index.ts').not.toBeNull()
    const cap = Number(match![1])
    expect(cap).toBeGreaterThanOrEqual(2000)
  })

  it('acceptsSamplingKnobs still rejects Opus 4.7 family (sanity-check the matcher itself)', () => {
    // If this assertion ever flips, the family-level matcher silently broke
    // and a future Opus bump would no-op the regression above.
    expect(acceptsSamplingKnobs(ANTHROPIC_OPUS)).toBe(false)
    expect(acceptsSamplingKnobs('claude-opus-4-7')).toBe(false)
    expect(acceptsSamplingKnobs('claude-opus-4-8')).toBe(false)
    expect(acceptsSamplingKnobs('claude-opus-5-0')).toBe(false)
  })
})
