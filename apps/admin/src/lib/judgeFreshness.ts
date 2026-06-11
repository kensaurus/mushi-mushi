/**
 * FILE: apps/admin/src/lib/judgeFreshness.ts
 * PURPOSE: Shared judge-batch freshness read/write for PipelineStatusRibbon
 *          and sidebar Check-stage staleness badges.
 */

export const JUDGE_FRESHNESS_KEY = 'mushi:health:judge-freshness-ts'

export function readJudgeStaleHours(): number | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(JUDGE_FRESHNESS_KEY)
  const ts = raw ? Number(raw) : NaN
  if (!Number.isFinite(ts)) return null
  return (Date.now() - ts) / 3_600_000
}

export function markJudgeBatchSeen(ts: number = Date.now()) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(JUDGE_FRESHNESS_KEY, String(ts))
  } catch {
    // localStorage write can fail in private mode; non-fatal.
  }
}
