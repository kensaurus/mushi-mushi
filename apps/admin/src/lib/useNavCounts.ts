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
import { getActiveProjectIdSnapshot, useActiveProjectSignal } from './activeProject'
import { getActiveOrgIdSnapshot, useActiveOrgSignal } from './activeOrg'
import type { DashboardData } from '../components/dashboard/types'
import type { ProjectsStats } from '../components/projects/types'
import type { MembersStats } from '../components/members/types'
import { projectsNeedingAttentionCount } from './workspaceNavMeta'
import { EMPTY_NAV_STAT_SLICES, type NavStatSlices } from './extendedNavMeta'
import { fetchNavSlicesFallback } from './fetchNavSlicesFallback'
import {
  normalizeNavSlices,
  type WorkspaceNavMetaResponse,
} from './workspaceNavMetaResponse'
import { useEntitlements } from './useEntitlements'

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
  /** reporter_devices flagged as suspicious — drives the /anti-gaming
   *  sidebar dot. Sourced via the cheap `count_only=1` mode of
   *  /v1/admin/anti-gaming/devices?flagged=true. */
  flaggedDevices: number
  /** Active My feedback tickets with a team reply (sidebar nudge). */
  feedbackWithReply: number
  /** Classifier vs judge disagreements (14d window) for Check-stage badges. */
  judgeDisagreements: number
  /** Accessible projects in workspace — inventory sidebar count. */
  projectCount: number
  /** Derived setup issues (never ingested + stale keys signal). */
  projectsNeedingAttention: number
  neverIngestedCount: number
  staleKeyCount: number
  /** Team roster size; null when org context or members stats unavailable. */
  memberCount: number | null
  pendingInvites: number
  /** Members inactive >30d or never seen — from org members stats. */
  membersInactiveCount: number
  membersAtSeatCap: boolean
  membersExpiringInvites: number
  /** Super-admin platform metrics; null when caller is not an operator. */
  superAdminSignups7d: number | null
  superAdminChurn30d: number | null
  /** Page-level stat slices for extended sidebar badges. */
  slices: NavStatSlices
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
  flaggedDevices: 0,
  feedbackWithReply: 0,
  judgeDisagreements: 0,
  projectCount: 0,
  projectsNeedingAttention: 0,
  neverIngestedCount: 0,
  staleKeyCount: 0,
  memberCount: null,
  pendingInvites: 0,
  membersInactiveCount: 0,
  membersAtSeatCap: false,
  membersExpiringInvites: 0,
  superAdminSignups7d: null,
  superAdminChurn30d: null,
  slices: EMPTY_NAV_STAT_SLICES,
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

interface DeviceCountResp {
  count?: number
}

interface FeedbackSummaryResp {
  with_reply?: number
}

interface JudgeStatsResp {
  disagreementCount?: number
}

interface SuperAdminMetricsResp {
  signups_last_7d?: number
  churn_last_30d?: number
}

interface InboxStatsResp {
  openActions?: number
}

function countHealthIssues(dashboard: DashboardData | undefined): number {
  const integrations = dashboard?.integrations
  if (!Array.isArray(integrations)) return 0
  return integrations.reduce((acc, row) => {
    const status = (row?.lastStatus ?? '').toLowerCase()
    if (status === 'ok' || status === 'green' || status === 'healthy') return acc
    return acc + 1
  }, 0)
}

export function useNavCounts(): NavCounts {
  const [counts, setCounts] = useState<NavCounts>(INITIAL)
  const { isSuperAdmin, has: hasFeature } = useEntitlements()
  const inventoryEnabled = hasFeature('inventory_v2')
  const activeProjectSignal = useActiveProjectSignal()
  const activeOrgSignal = useActiveOrgSignal()

  const load = useCallback(async () => {
    const projectId = getActiveProjectIdSnapshot()
    const orgId = getActiveOrgIdSnapshot()
    const [
      summaryRes,
      reportsRes,
      invRes,
      dashRes,
      notifRes,
      queueRes,
      flaggedRes,
      feedbackRes,
      judgeRes,
      inboxStatsRes,
      navMetaRes,
      superAdminMetricsRes,
    ] = await Promise.all([
      apiFetch<FixSummaryResp>('/v1/admin/fixes/summary'),
      apiFetch<ReportsListResp>('/v1/admin/reports?status=new&limit=1'),
      projectId && inventoryEnabled
        ? apiFetch<{ summary: InventorySummary | null }>(`/v1/admin/inventory/${projectId}`)
        : Promise.resolve({ ok: false as const, error: { code: 'SKIP', message: '' } }),
      apiFetch<DashboardData>('/v1/admin/dashboard'),
      apiFetch<NotificationCountResp>('/v1/admin/notifications?unread=1&count_only=1'),
      apiFetch<QueueSummaryResp>('/v1/admin/queue/summary'),
      apiFetch<DeviceCountResp>('/v1/admin/anti-gaming/devices?flagged=true&count_only=1'),
      apiFetch<FeedbackSummaryResp>('/v1/admin/support/tickets/summary'),
      apiFetch<JudgeStatsResp>('/v1/admin/judge/stats'),
      apiFetch<InboxStatsResp>('/v1/admin/inbox/stats'),
      apiFetch<WorkspaceNavMetaResponse>('/v1/admin/workspace/nav-meta'),
      isSuperAdmin
        ? apiFetch<SuperAdminMetricsResp>('/v1/super-admin/metrics')
        : Promise.resolve({ ok: false as const, error: { code: 'SKIP', message: '' } }),
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
    const flaggedDevices = flaggedRes.ok ? (flaggedRes.data?.count ?? 0) : 0
    const feedbackWithReply = feedbackRes.ok ? (feedbackRes.data?.with_reply ?? 0) : 0
    const judgeDisagreements = judgeRes.ok ? (judgeRes.data?.disagreementCount ?? 0) : 0
    const inboxOpenActions = inboxStatsRes.ok
      ? (inboxStatsRes.data?.openActions ?? 0)
      : 0
    const superAdminSignups7d = superAdminMetricsRes.ok
      ? (superAdminMetricsRes.data?.signups_last_7d ?? null)
      : null
    const superAdminChurn30d = superAdminMetricsRes.ok
      ? (superAdminMetricsRes.data?.churn_last_30d ?? null)
      : null

    let slices: NavStatSlices = EMPTY_NAV_STAT_SLICES
    let projectCount = 0
    let neverIngestedCount = 0
    let staleKeyCount = 0
    let memberCount: number | null = null
    let pendingInvites = 0
    let membersInactiveCount = 0
    let membersAtSeatCap = false
    let membersExpiringInvites = 0

    if (navMetaRes.ok && navMetaRes.data) {
      slices = normalizeNavSlices(navMetaRes.data.slices)
      if (navMetaRes.data.projects) {
        projectCount = navMetaRes.data.projects.projectCount
        neverIngestedCount = navMetaRes.data.projects.neverIngestedCount
        staleKeyCount = navMetaRes.data.projects.staleKeyCount
      }
      if (navMetaRes.data.members) {
        memberCount = navMetaRes.data.members.memberCount
        pendingInvites = navMetaRes.data.members.pendingInvites
        membersInactiveCount = navMetaRes.data.members.inactiveCount ?? 0
        membersAtSeatCap = navMetaRes.data.members.atSeatCap ?? false
        membersExpiringInvites = navMetaRes.data.members.expiringSoonInvites ?? 0
      }
    } else {
      const [fallbackSlices, projectsStatsRes, membersStatsRes] = await Promise.all([
        fetchNavSlicesFallback(projectId),
        apiFetch<ProjectsStats>('/v1/admin/projects/stats'),
        orgId
          ? apiFetch<MembersStats>(`/v1/org/${orgId}/members/stats`)
          : Promise.resolve({ ok: false as const, error: { code: 'SKIP', message: '' } }),
      ])
      slices = fallbackSlices
      const projectsStats = projectsStatsRes.ok ? projectsStatsRes.data : null
      const membersStats = membersStatsRes.ok ? membersStatsRes.data : null
      projectCount = projectsStats?.projectCount ?? 0
      neverIngestedCount = projectsStats?.neverIngestedCount ?? 0
      staleKeyCount = projectsStats?.staleKeyCount ?? 0
      memberCount = membersStats?.memberCount ?? null
      pendingInvites = membersStats?.pendingInvites ?? 0
      membersInactiveCount = membersStats?.inactiveCount ?? 0
      membersAtSeatCap = membersStats?.atSeatCap ?? false
      membersExpiringInvites = membersStats?.expiringSoonInvites ?? 0
    }

    setCounts({
      untriagedBacklog: reports?.total ?? 0,
      fixesInFlight: summary?.inProgress ?? 0,
      fixesFailed: summary?.failed ?? 0,
      prsOpen: summary?.prsOpen ?? 0,
      regressedActions: regressed,
      inboxOpenActions,
      notificationsUnread: notifUnread,
      queueFailed,
      healthIssues: countHealthIssues(dashboard),
      flaggedDevices,
      feedbackWithReply,
      judgeDisagreements,
      projectCount,
      projectsNeedingAttention: projectsNeedingAttentionCount({
        neverIngestedCount,
        staleKeyCount,
      }),
      neverIngestedCount,
      staleKeyCount,
      memberCount,
      pendingInvites,
      membersInactiveCount,
      membersAtSeatCap,
      membersExpiringInvites,
      superAdminSignups7d,
      superAdminChurn30d,
      slices,
      ready: true,
    })
  }, [activeProjectSignal, activeOrgSignal, inventoryEnabled, isSuperAdmin])

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
      'reporter_devices',
      'support_tickets',
      'classification_evaluations',
      'projects',
      'project_api_keys',
      'organization_members',
      'invitations',
      'qa_stories',
      'qa_story_runs',
      'pdca_runs',
      'gate_findings',
      'gate_runs',
      'content_quality_issues',
      'experiments',
      'intelligence_reports',
      'intelligence_generation_jobs',
      'releases',
      'project_codebase_files',
      'end_user_activity',
      'audit_logs',
      'usage_events',
      'billing_subscriptions',
      'skill_pipeline_runs',
      'skill_pipeline_step_runs',
      'feature_request_votes',
      'project_plugins',
      'enterprise_sso_configs',
      'project_storage_settings',
      'nl_query_history',
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

export function toneForOpen(n: number, dangerAt: number): HealthTone {
  if (n === 0) return 'ok'
  if (n >= dangerAt) return 'danger'
  return 'warn'
}
