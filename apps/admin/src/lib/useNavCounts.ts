/**
 * FILE: apps/admin/src/lib/useNavCounts.ts
 * PURPOSE: Lightweight cross-page counters that power the coloured dots on
 *          sidebar nav items (Reports / Fixes / Repo). Fetches a small,
 *          cacheable summary pair and subscribes to realtime so the dots
 *          reflect server-truth seconds after something changes — no
 *          page reload needed.
 *
 *          Pattern deliberately mirrors IntegrationHealthDot so the
 *          sidebar's status language stays consistent: grey = idle, green
 *          = healthy, yellow = attention, red = action required.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from './supabase'
import { useRealtimeReload } from './realtime'

export type HealthTone = 'idle' | 'ok' | 'warn' | 'danger'

export interface NavCounts {
  /** Reports with status='new' that have been sitting > 1h. */
  untriagedBacklog: number
  /** Fix attempts in queued/running state. */
  fixesInFlight: number
  /** Fix attempts whose last state is failure or CI-failed. */
  fixesFailed: number
  /** Repo-level aggregate: open PRs awaiting review. */
  prsOpen: number
  /** Whether the hook has loaded once; consumers can skip rendering
   *  dots in the undefined state. */
  ready: boolean
}

const INITIAL: NavCounts = {
  untriagedBacklog: 0,
  fixesInFlight: 0,
  fixesFailed: 0,
  prsOpen: 0,
  ready: false,
}

interface FixSummaryResp {
  inProgress?: number
  failed?: number
  prsOpen?: number
}

interface ReportsListResp {
  total?: number
}

/**
 * Fetch the per-nav counters from two tiny endpoints. Both are cheap
 * aggregate reads; failure is silent (dots just stay grey) because this
 * is decoration, not a critical path.
 */
export function useNavCounts(): NavCounts {
  const [counts, setCounts] = useState<NavCounts>(INITIAL)

  const load = useCallback(async () => {
    const [summaryRes, reportsRes] = await Promise.all([
      apiFetch<FixSummaryResp>('/v1/admin/fixes/summary'),
      apiFetch<ReportsListResp>('/v1/admin/reports?status=new&limit=1'),
    ])
    const summary = summaryRes.ok ? summaryRes.data : null
    const reports = reportsRes.ok ? reportsRes.data : null
    setCounts({
      untriagedBacklog: reports?.total ?? 0,
      fixesInFlight: summary?.inProgress ?? 0,
      fixesFailed: summary?.failed ?? 0,
      prsOpen: summary?.prsOpen ?? 0,
      ready: true,
    })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Nav-level counters reflect the core PDCA tables. A 1.5s debounce
  // collapses bursty webhooks (push + pr + check_run) into a single
  // refresh — same principle as the list pages but slightly more
  // relaxed because nav dots don't need sub-second accuracy.
  useRealtimeReload(
    ['reports', 'fix_attempts', 'fix_events'],
    () => { void load() },
    { debounceMs: 1500 },
  )

  return counts
}

/** Map a numeric count to a tone using project-appropriate thresholds. */
export function toneForBacklog(n: number): HealthTone {
  if (n === 0) return 'ok'
  if (n <= 5) return 'warn'
  return 'danger'
}

export function toneForFailed(n: number): HealthTone {
  if (n === 0) return 'ok'
  if (n <= 2) return 'warn'
  return 'danger'
}

export function toneForInFlight(n: number): HealthTone {
  if (n === 0) return 'idle'
  return 'ok'
}
