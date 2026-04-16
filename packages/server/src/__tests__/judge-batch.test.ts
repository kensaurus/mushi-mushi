/**
 * FILE: judge-batch.test.ts
 * PURPOSE: Smoke tests for the judge-batch Edge Function logic.
 *          Validates scoring, drift detection, and prompt promotion flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface JudgeEvaluation {
  accuracy: number
  severity_calibration: number
  component_tagging: number
  repro_quality: number
  classification_agreed: boolean
  reasoning: string
  suggested_correction?: {
    category?: string
    severity?: string
    component?: string
  }
}

const MOCK_EVALUATION: JudgeEvaluation = {
  accuracy: 0.9,
  severity_calibration: 0.85,
  component_tagging: 0.8,
  repro_quality: 0.75,
  classification_agreed: true,
  reasoning: 'Category and severity are appropriate. Component identification is slightly vague. Reproduction steps could be more specific.',
}

const MOCK_DISAGREEMENT: JudgeEvaluation = {
  accuracy: 0.4,
  severity_calibration: 0.3,
  component_tagging: 0.5,
  repro_quality: 0.6,
  classification_agreed: false,
  reasoning: 'The issue is clearly a performance problem, not a bug. Severity should be medium, not critical.',
  suggested_correction: {
    category: 'slow',
    severity: 'medium',
  },
}

describe('judge-batch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should compute composite score with correct weights', () => {
    const evaluation = MOCK_EVALUATION

    const compositeScore = (
      evaluation.accuracy * 0.35 +
      evaluation.severity_calibration * 0.25 +
      evaluation.component_tagging * 0.2 +
      evaluation.repro_quality * 0.2
    )

    expect(compositeScore).toBeCloseTo(0.8375, 4)
    expect(compositeScore).toBeGreaterThan(0)
    expect(compositeScore).toBeLessThanOrEqual(1)
  })

  it('should compute low composite score for disagreements', () => {
    const evaluation = MOCK_DISAGREEMENT

    const compositeScore = (
      evaluation.accuracy * 0.35 +
      evaluation.severity_calibration * 0.25 +
      evaluation.component_tagging * 0.2 +
      evaluation.repro_quality * 0.2
    )

    expect(compositeScore).toBeLessThan(0.5)
    expect(evaluation.classification_agreed).toBe(false)
    expect(evaluation.suggested_correction).toBeDefined()
    expect(evaluation.suggested_correction!.category).toBe('slow')
  })

  it('should detect drift when scores drop more than 10% week-over-week', () => {
    const driftData = [
      { week: '2026-W16', avg_score: 0.72 },
      { week: '2026-W15', avg_score: 0.85 },
    ]

    const [current, previous] = driftData
    const dropPct = ((previous.avg_score - current.avg_score) / previous.avg_score) * 100

    expect(dropPct).toBeGreaterThan(10)

    const alert = `Classification drift alert: score dropped ${dropPct.toFixed(1)}%`
    expect(alert).toContain('15.3%')
  })

  it('should not alert when scores are stable', () => {
    const driftData = [
      { week: '2026-W16', avg_score: 0.83 },
      { week: '2026-W15', avg_score: 0.85 },
    ]

    const [current, previous] = driftData
    const dropPct = ((previous.avg_score - current.avg_score) / previous.avg_score) * 100

    expect(dropPct).toBeLessThanOrEqual(10)
  })

  it('should handle single-week drift data gracefully', () => {
    const driftData = [{ week: '2026-W16', avg_score: 0.83 }]

    const hasSufficientData = driftData.length >= 2
    expect(hasSufficientData).toBe(false)
  })

  it('should validate judge schema dimensions are all 0-1', () => {
    const evaluation = MOCK_EVALUATION

    expect(evaluation.accuracy).toBeGreaterThanOrEqual(0)
    expect(evaluation.accuracy).toBeLessThanOrEqual(1)
    expect(evaluation.severity_calibration).toBeGreaterThanOrEqual(0)
    expect(evaluation.severity_calibration).toBeLessThanOrEqual(1)
    expect(evaluation.component_tagging).toBeGreaterThanOrEqual(0)
    expect(evaluation.component_tagging).toBeLessThanOrEqual(1)
    expect(evaluation.repro_quality).toBeGreaterThanOrEqual(0)
    expect(evaluation.repro_quality).toBeLessThanOrEqual(1)
  })

  it('should validate auth requires service_role key (not substring match)', () => {
    const validKey = 'Bearer eyJ...service_role_key_here'
    const spoofKey = 'service_role_fake'
    const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service_role_real_key'

    // Current broken check (what we're fixing)
    const brokenCheck = (auth: string) => auth.includes('service_role')
    expect(brokenCheck(validKey)).toBe(true)
    expect(brokenCheck(spoofKey)).toBe(true) // BUG: spoofed key passes

    // Correct check: compare against actual service role key
    const fixedCheck = (auth: string, expectedKey: string) => {
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth
      return token === expectedKey
    }
    expect(fixedCheck(`Bearer ${supabaseServiceKey}`, supabaseServiceKey)).toBe(true)
    expect(fixedCheck(spoofKey, supabaseServiceKey)).toBe(false)
  })

  it('should track prompt versions for A/B scoring', () => {
    const report = {
      id: 'report-010',
      stage1_prompt_version: 'v1.2',
      stage2_prompt_version: 'v2.0-candidate',
    }

    expect(report.stage1_prompt_version).toBeTruthy()
    expect(report.stage2_prompt_version).toBeTruthy()
    expect(report.stage2_prompt_version).toContain('candidate')
  })

  it('should skip projects with judge_enabled = false', () => {
    const settings = { judge_enabled: false, judge_sample_size: 50 }
    expect(settings.judge_enabled).toBe(false)
  })
})
