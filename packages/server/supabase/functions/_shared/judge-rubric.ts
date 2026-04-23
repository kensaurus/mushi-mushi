/**
 * Pure (Node + Deno safe) helpers for the judge composite-score rubric.
 *
 * Kept in a dedicated file with zero Deno / npm: imports so vitest in the
 * Node workspace can exercise it directly. The Deno edge function
 * re-exports the same symbols from prompt-ab.ts for call-site convenience.
 *
 * Shape of `judge_rubric` column (migration 20260422110000):
 *   {
 *     "accuracy": 0.35,      // classification agreement weight
 *     "severity": 0.25,      // severity-calibration weight
 *     "component": 0.2,      // component-tagging weight
 *     "repro":     0.2,      // repro-quality weight
 *     ...(any future fields; ignored by resolveJudgeWeights)
 *   }
 *
 * Operators can tune weights per prompt version. Absent / invalid fields
 * fall back to the historical 0.35/0.25/0.2/0.2 baseline so scoring is
 * never disrupted by a bad edit.
 */

export interface JudgeRubric {
  accuracy?: number
  severity?: number
  component?: number
  repro?: number
  [extra: string]: number | undefined
}

export const DEFAULT_JUDGE_RUBRIC: Required<
  Pick<JudgeRubric, 'accuracy' | 'severity' | 'component' | 'repro'>
> = {
  accuracy: 0.35,
  severity: 0.25,
  component: 0.2,
  repro: 0.2,
}

/**
 * Combine a rubric (possibly partial / null) with the defaults and return a
 * 4-way weight tuple that always sums to 1.
 *
 * Defensive against operator typos — a rubric that sums to 0 or negative
 * silently falls back to the default so the judge keeps scoring rather
 * than exploding with NaN.
 */
export function resolveJudgeWeights(rubric: JudgeRubric | null | undefined): {
  accuracy: number
  severity: number
  component: number
  repro: number
} {
  const r = rubric ?? {}
  const pickOrDefault = (v: unknown, fallback: number): number => {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback
  }
  const merged = {
    accuracy: pickOrDefault(r.accuracy, DEFAULT_JUDGE_RUBRIC.accuracy),
    severity: pickOrDefault(r.severity, DEFAULT_JUDGE_RUBRIC.severity),
    component: pickOrDefault(r.component, DEFAULT_JUDGE_RUBRIC.component),
    repro: pickOrDefault(r.repro, DEFAULT_JUDGE_RUBRIC.repro),
  }
  const sum = merged.accuracy + merged.severity + merged.component + merged.repro
  if (!Number.isFinite(sum) || sum <= 0) return { ...DEFAULT_JUDGE_RUBRIC }
  return {
    accuracy: merged.accuracy / sum,
    severity: merged.severity / sum,
    component: merged.component / sum,
    repro: merged.repro / sum,
  }
}
