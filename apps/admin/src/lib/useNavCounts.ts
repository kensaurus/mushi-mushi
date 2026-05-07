/**
 * FILE: apps/admin/src/lib/useNavCounts.ts
 * PURPOSE: Lightweight cross-page counters that power the coloured dots on
 *          sidebar nav items (Reports / Fixes / Repo / Inventory / Inbox /
 *          Notifications / Queue / Health).
 *          Fetches summaries plus `/v1/admin/dashboard` for the Action Inbox
 *          open-count and integration health, and subscribes to realtime so
 *          the dots reflect server truth shortly after something changes — no
 *          page reload needed.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from './supabase'
import { useRealtimeReload } from './realtime'
import { getActiveProjectIdSnapshot } from './activeProject'
import type { DashboardData } from '../components/dashboard/types'
import { inboxOpenActionCount } from './actionInboxFromDashboard'

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
  /**
   * Cards on /inbox with a non-null action — same derivation as
   * `buildInboxCards` on `/v1/admin/dashboard`.
   */
  inboxOpenActions: number
  /** Unread reporter_notifications across owned projects. */
  notificationsUnread: number
  /** processing_queue rows in dead_letter or failed status. */
  queueFailed: number
  /** Integrations whose last status is not `ok` (red + amber). */
  healthIssues: number
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
  inboxOpenActions: 0,
  notificationsUnread: 0,
  queueFailed: 0,
  healthIssues: 0,
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

interface NotificationCountResp {
  unread_count?: number
}

interface QueueSummaryResp {
  byStatus?: Record<string, number>
}

function countHealthIssues(dashboard: DashboardData | undefined): number {
  const integrations = dashboard?.integrations
  if (!Array.isArray(integrations)) return 0
  return integrations.reduce((acc, row) => {
    const status = (row?.lastStatus ?? '').toLowerCase()
    // Anything not explicitly healthy counts as an issue worth surfacing —
    // includes `red`, `amber`, `down`, `error`, `degraded`, plus null/empty.
    if (status === 'ok' || status === 'green' || status === 'healthy') return acc
    return acc + 1
  }, 0)
}

export function useNavCounts(): NavCounts {
  const [counts, setCounts] = useState<NavCounts>(INITIAL)

  const load = useCallback(async () => {
    const projectId = getActiveProjectIdSnapshot()
    const [summaryRes, reportsRes, invRes, dashRes, notifRes, queueRes] = await Promise.all([
      apiFetch<FixSummaryResp>('/v1/admin/fixes/summary'),
      apiFetch<ReportsListResp>('/v1/admin/reports?status=new&limit=1'),
      projectId
        ? apiFetch<{ summary: InventorySummary | null }>(`/v1/admin/inventory/${projectId}`)
        : Promise.resolve({ ok: false as const, error: { code: 'SKIP', message: '' } }),
      apiFetch<DashboardData>('/v1/admin/dashboard'),
      apiFetch<NotificationCountResp>('/v1/admin/notifications?unread=1&count_only=1'),
      apiFetch<QueueSummaryResp>('/v1/admin/queue/summary'),
    ])
    const summary = summaryRes.ok ? summaryRes.data : null
    const reports = reportsRes.ok ? reportsRes.data : null
    let regressed = 0
    if (invRes.ok && invRes.data?.summary && typeof invRes.data.summary.regressed === 'number') {
      regressed = invRes.data.summary.regressed
    }
    const dashboard = dashRes.ok ? dashRes.data : undefined
    const notifUnread = notifRes.ok ? (notifRes.data?.unread_count ?? 0) : 0
    const queueByStatus = queueRes.ok ? (queueRes.data?.byStatus ?? {}) : {}
    const queueFailed = (queueByStatus.dead_letter ?? 0) + (queueByStatus.failed ?? 0)
    setCounts({
      untriagedBacklog: reports?.total ?? 0,
      fixesInFlight: summary?.inProgress ?? 0,
      fixesFailed: summary?.failed ?? 0,
      prsOpen: summary?.prsOpen ?? 0,
      regressedActions: regressed,
      inboxOpenActions: inboxOpenActionCount(dashboard),
      notificationsUnread: notifUnread,
      queueFailed,
      healthIssues: countHealthIssues(dashboard),
      ready: true,
    })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useRealtimeReload(
    [
      'reports',
      'fix_attempts',
      'fix_events',
      'graph_nodes',
      'status_history',
      'inventories',
      'reporter_notifications',
      'processing_queue',
    ],
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
