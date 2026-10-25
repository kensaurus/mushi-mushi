/**
 * FILE: apps/admin/src/lib/skillRuns.ts
 * PURPOSE: Skill runs (ADR 0042) for the console: start one skill on one
 *          part of an app for a few rounds, read the runs, stop one, and say
 *          in one line where a run is.
 */

import { apiFetch } from './supabase'

export interface SkillRunSkill {
  slug: string
  label: string
  measure: string
  inCatalog: boolean
}

export interface SkillRun {
  id: string
  project_id: string
  skill_slug: string
  scope: string
  rounds_max: number
  round: number
  auto_merge: boolean
  status: 'active' | 'done' | 'stopped'
  stop_reason: string | null
  current_report_id: string | null
  history: Array<{ round: number; reportId: string; outcome: string; prUrl?: string | null }>
  created_at: string
  updated_at: string
}

/** "Round 2 of 3 · 1 merged" / "Done: the agent found nothing left to change in scope." */
export function skillRunLine(run: Pick<SkillRun, 'status' | 'round' | 'rounds_max' | 'stop_reason' | 'history'>): string {
  const merged = run.history.filter((h) => h.outcome === 'merged').length
  const tail = merged ? ` · ${merged} merged` : ''
  if (run.status === 'active') {
    if (run.round === 0) return 'Starting: the first round is being filed.'
    const retry = run.stop_reason?.startsWith('Will retry') ? ` · ${run.stop_reason}` : ''
    return `Round ${run.round} of ${run.rounds_max}${tail}${retry}`
  }
  const reason = run.stop_reason ?? (run.status === 'done' ? 'Finished.' : 'Stopped.')
  return `${run.status === 'done' ? 'Done' : 'Stopped'}: ${reason}${tail}`
}

/** Runs the caller can see. `projectId` limits them to the open app (GET ?projectId=). */
export async function loadSkillRuns(projectId?: string | null) {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return apiFetch<{ runs: SkillRun[]; skills: SkillRunSkill[] }>(`/v1/admin/skill-runs${query}`, { cache: 'no-store', scope: 'enumeration' })
}

export async function startSkillRun(projectId: string, input: { skillSlug: string; scope: string; rounds: number; autoMerge: boolean }) {
  return apiFetch<{ run: SkillRun }>(`/v1/admin/projects/${projectId}/skill-runs`, { method: 'POST', body: JSON.stringify(input) })
}

export async function stopSkillRun(projectId: string, runId: string) {
  return apiFetch<{ id: string }>(`/v1/admin/projects/${projectId}/skill-runs/${runId}/stop`, { method: 'POST' })
}
