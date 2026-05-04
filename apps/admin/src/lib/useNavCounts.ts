/**
 * FILE: apps/admin/src/lib/useNavCounts.ts
 * PURPOSE: Lightweight cross-page counters that power the coloured dots on
 *          sidebar nav items (Reports / Fixes / Repo / Inventory). Fetches a small,
 *          cacheable summary pair and subscribes to realtime so the dots
 *          reflect server-truth seconds after something changes — no
 *          page reload needed.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from './supabase'
import { useRealtimeReload } from './realtime'
import { getActiveProjectIdSnapshot } from './activeProject'

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
  /** Action nodes in inventory with status regressed (v2). */
  regressedActions: number
  /** Whether the hook has loaded once; consumers can skip rendering
   *  dots in the undefined state. */
  ready: boolean
}

const INITIAL: NavCounts = {
  untriagedBacklog: 0,
  fixesInFlight: 0,
  fixesFailed: 0,
  prsOpen: 0,
  regressedActions: 0,
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

interface InventorySummary {
  regressed?: number
}

export function useNavCounts(): NavCounts {
  const [counts, setCounts] = useState<NavCounts>(INITIAL)

  const load = useCallback(async () => {
    const projectId = getActiveProjectIdSnapshot()
    const [summaryRes, reportsRes, invRes] = await Promise.all([
      apiFetch<FixSummaryResp>('/v1/admin/fixes/summary'),
      apiFetch<ReportsListResp>('/v1/admin/reports?status=new&limit=1'),
      projectId
        ? apiFetch<{ summary: InventorySummary | null }>(`/v1/admin/inventory/${projectId}`)
        : Promise.resolve({ ok: false as const, error: { code: 'SKIP', message: '' } }),
    ])
    const summary = summaryRes.ok ? summaryRes.data : null
    const reports = reportsRes.ok ? reportsRes.data : null
    let regressed = 0
    if (invRes.ok && invRes.data?.summary && typeof invRes.data.summary.regressed === 'number') {
      regressed = invRes.data.summary.regressed
    }
    setCounts({
      untriagedBacklog: reports?.total ?? 0,
      fixesInFlight: summary?.inProgress ?? 0,
      fixesFailed: summary?.failed ?? 0,
      prsOpen: summary?.prsOpen ?? 0,
      regressedActions: regressed,
      ready: true,
    })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useRealtimeReload(
    ['reports', 'fix_attempts', 'fix_events', 'graph_nodes', 'status_history', 'inventories'],
    () => { void load() },
    { debounceMs: 1500 },
  )

  return counts
}

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
