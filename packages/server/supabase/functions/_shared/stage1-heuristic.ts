/**
 * FILE: packages/server/supabase/functions/_shared/stage1-heuristic.ts
 * PURPOSE: Deterministic Stage-1 classification when every LLM provider is
 *          unavailable (401/403, exhausted key pool, or hosted-wallet denial).
 *
 * This is a product fallback, not a symptom suppressor. Reports must leave
 * `status='new'` so the 5-minute `mushi-pipeline-recovery` cron does not
 * retry-storm the same row (Sentry MUSHI-MUSHI-SERVER-19: Anthropic 401 →
 * OpenAI 401 → log.error('Unhandled error') → recovery re-invokes forever
 * because failures never incremented `processing_attempts`).
 */

export const HEURISTIC_STAGE1_MODEL = 'heuristic'

export type Stage1Category = 'bug' | 'slow' | 'visual' | 'confusing' | 'other'
export type Stage1Severity = 'critical' | 'high' | 'medium' | 'low'

export interface HeuristicStage1Result {
  symptom: string
  action: string
  expected: string
  actual: string
  emotion: string
  category: Stage1Category
  severity: Stage1Severity
  confidence: number
}

const CATEGORIES = new Set<Stage1Category>(['bug', 'slow', 'visual', 'confusing', 'other'])

function clip(value: string, max = 240): string {
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

export function normalizeStage1Category(raw: unknown): Stage1Category {
  const v = String(raw ?? '').toLowerCase().trim()
  if (CATEGORIES.has(v as Stage1Category)) return v as Stage1Category
  if (v.includes('slow') || v.includes('perf')) return 'slow'
  if (v.includes('visual') || v.includes('ui') || v.includes('layout')) return 'visual'
  if (v.includes('confus') || v.includes('ux')) return 'confusing'
  if (v.includes('bug') || v.includes('error') || v.includes('crash')) return 'bug'
  return 'other'
}

export function heuristicStage1Classification(report: {
  description?: string | null
  user_category?: string | null
  user_intent?: string | null
  console_logs?: Array<{ level?: string; message?: string }> | null
  network_logs?: Array<{ status?: number; error?: string }> | null
}): HeuristicStage1Result {
  const description = clip(String(report.description ?? '')) || 'No description provided'
  const category = normalizeStage1Category(report.user_category)
  const consoleErrors = (report.console_logs ?? []).filter((l) => l.level === 'error')
  const serverFails = (report.network_logs ?? []).filter((l) => {
    const status = Number(l.status ?? 0)
    return status >= 500 || Boolean(l.error)
  })

  let severity: Stage1Severity = 'medium'
  if (category === 'visual' || category === 'confusing') severity = 'low'
  if (consoleErrors.length >= 1 || serverFails.length >= 1 || category === 'bug') {
    severity = 'high'
  }
  if (
    consoleErrors.length >= 3 ||
    serverFails.length >= 2 ||
    /data loss|cannot log ?in|payment (fail|error)|crash|unusable/i.test(description)
  ) {
    severity = 'critical'
  }

  return {
    symptom: description,
    action: clip(String(report.user_intent ?? 'Using the app')) || 'Using the app',
    expected: 'The action should complete without an error',
    actual: description,
    emotion: '',
    category,
    severity,
    // Below the default 0.85 auto-finalize threshold; the caller still
    // finalizes Stage 1 when LLM is unavailable so Stage 2 (same keys)
    // is not invoked into another 401 loop.
    confidence: 0.4,
  }
}
