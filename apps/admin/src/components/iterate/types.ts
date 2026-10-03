/**
 * FILE: apps/admin/src/components/iterate/types.ts
 * PURPOSE: Shared shapes and status styling for the Iterate (PDCA) page.
 */

import { runStatusChipTone } from '../../lib/chipTone'

export interface PdcaRun {
  id: string
  project_id: string
  target_url: string
  goal: string
  iterations_target: number
  current_iteration: number
  status: 'queued' | 'running' | 'succeeded' | 'aborted' | 'failed'
  primary_model: string
  judge_model: string
  persona: string
  target_score: number
  started_at: string | null
  finished_at: string | null
  final_score: number | null
  created_at: string
  iterations?: PdcaIteration[]
}

export interface PdcaIteration {
  id: string
  run_id: string
  iteration_n: number
  draft_html_url: string | null
  screenshot_after_url: string | null
  critique_text: string | null
  score: number | null
  score_breakdown: Record<string, number>
  model_cost_usd: number
  ms_elapsed: number
  created_at: string
}

export interface PdcaStats {
  total: number
  queued: number
  running: number
  succeeded: number
  failed: number
  aborted: number
  avgFinalScore: number | null
  lastRunAt: string | null
}

export const STATUS_CLS: Record<PdcaRun['status'], string> = {
  queued: runStatusChipTone('queued'),
  running: runStatusChipTone('running'),
  succeeded: runStatusChipTone('succeeded'),
  aborted: runStatusChipTone('aborted'),
  failed: runStatusChipTone('failed'),
}

export const STATUS_LABEL: Record<PdcaRun['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  aborted: 'Aborted',
  failed: 'Failed',
}

export const PERSONA_OPTIONS = [
  { value: 'nng-heuristic', label: 'Nielsen Norman (UX heuristics)' },
  { value: 'accessibility', label: 'Accessibility reviewer' },
  { value: 'conversion', label: 'Conversion rate optimizer' },
  { value: 'senior-dev', label: 'Senior developer (clean code)' },
] as const

/** Producer + judge default. Mirrors PDCA_DEFAULT_MODEL in
 *  packages/server/supabase/functions/_shared/pdca-models.ts. */
export const PDCA_DEFAULT_MODEL = 'claude-sonnet-5-5'

/** Claude only: the runner falls back to OpenAI by itself when Anthropic is
 *  down, so GPT is not a choice here (the server refuses non-Claude ids). */
export const MODEL_OPTIONS = [
  { value: PDCA_DEFAULT_MODEL, label: 'Claude Sonnet 5.5 (default)' },
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fastest)' },
] as const

export function scoreTone(pct: number): 'ok' | 'warn' | 'danger' {
  if (pct >= 70) return 'ok'
  if (pct >= 50) return 'warn'
  return 'danger'
}

export function scoreBarClass(pct: number): string {
  const tone = scoreTone(pct)
  if (tone === 'ok') return 'bg-ok'
  if (tone === 'warn') return 'bg-warn'
  return 'bg-danger'
}
