/**
 * FILE: apps/admin/src/components/iterate/types.ts
 * PURPOSE: Shared shapes and status styling for the Iterate (PDCA) page.
 */

import { CHIP_TONE } from '../../lib/chipTone'

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
  queued: 'bg-surface-raised text-fg-muted border border-edge-subtle',
  running: CHIP_TONE.warnSubtle,
  succeeded: CHIP_TONE.okSubtle,
  aborted: 'bg-surface-raised text-fg-faint border border-edge-subtle',
  failed: CHIP_TONE.dangerSubtle,
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

export const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
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
