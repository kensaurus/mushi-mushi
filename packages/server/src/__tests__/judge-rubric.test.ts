/**
 * Unit tests for the Wave S judge rubric plumbing.
 *
 * The rubric is loaded from `prompt_versions.judge_rubric` and merged with
 * the historical 0.35/0.25/0.2/0.2 defaults. These tests lock in:
 *   - missing / null rubrics fall back to defaults
 *   - partial rubrics fill missing fields from defaults
 *   - weights always sum to 1 after normalization
 *   - bad operator input (0, negative, NaN) never produces NaN scores
 *
 * We import the compiled `.ts` file directly because the helper is
 * framework-agnostic (no Deno-only APIs in this branch of prompt-ab.ts).
 * If that changes, this test needs a stub shim — but the helper is kept
 * small and pure by design.
 */

import { describe, it, expect } from 'vitest'
import {
  resolveJudgeWeights,
  DEFAULT_JUDGE_RUBRIC,
} from '../../supabase/functions/_shared/judge-rubric.ts'

const EPS = 1e-9

describe('resolveJudgeWeights', () => {
  it('returns the default rubric when given null', () => {
    const w = resolveJudgeWeights(null)
    expect(w.accuracy).toBeCloseTo(DEFAULT_JUDGE_RUBRIC.accuracy, 6)
    expect(w.severity).toBeCloseTo(DEFAULT_JUDGE_RUBRIC.severity, 6)
    expect(w.component).toBeCloseTo(DEFAULT_JUDGE_RUBRIC.component, 6)
    expect(w.repro).toBeCloseTo(DEFAULT_JUDGE_RUBRIC.repro, 6)
  })

  it('returns the default rubric when given an empty object', () => {
    const w = resolveJudgeWeights({})
    expect(w.accuracy + w.severity + w.component + w.repro).toBeCloseTo(1, 6)
  })

  it('normalizes a custom rubric so weights sum to 1', () => {
    const w = resolveJudgeWeights({ accuracy: 2, severity: 1, component: 1, repro: 1 })
    const sum = w.accuracy + w.severity + w.component + w.repro
    expect(Math.abs(sum - 1)).toBeLessThan(EPS)
    // Accuracy should dominate (2/5 = 0.4)
    expect(w.accuracy).toBeCloseTo(0.4, 6)
  })

  it('fills partial rubrics from defaults', () => {
    const w = resolveJudgeWeights({ accuracy: 0.5 })
    // severity/component/repro pulled from defaults, then the whole set
    // normalized. Ratios should still preserve the relative ordering.
    expect(w.severity).toBeGreaterThan(0)
    expect(w.component).toBeGreaterThan(0)
    expect(w.repro).toBeGreaterThan(0)
    expect(w.accuracy + w.severity + w.component + w.repro).toBeCloseTo(1, 6)
  })

  it('falls back to defaults when a weight is zero or negative', () => {
    const w = resolveJudgeWeights({ accuracy: 0, severity: -1, component: NaN })
    // All three bad values replaced with defaults; repro pulled from default.
    // Sum still == 1 after normalization.
    expect(w.accuracy + w.severity + w.component + w.repro).toBeCloseTo(1, 6)
    expect(w.accuracy).toBeGreaterThan(0)
    expect(w.severity).toBeGreaterThan(0)
    expect(w.component).toBeGreaterThan(0)
  })

  it('never emits NaN even with all-bad input', () => {
    const w = resolveJudgeWeights({ accuracy: NaN, severity: -1, component: 0, repro: Infinity })
    expect(Number.isFinite(w.accuracy)).toBe(true)
    expect(Number.isFinite(w.severity)).toBe(true)
    expect(Number.isFinite(w.component)).toBe(true)
    expect(Number.isFinite(w.repro)).toBe(true)
    expect(w.accuracy + w.severity + w.component + w.repro).toBeCloseTo(1, 6)
  })
})
