/**
 * FILE: apps/admin/src/lib/useNavCounts.ts
 * PURPOSE: Lightweight cross-page counters that power the coloured dots on
 *          sidebar nav items (Reports / Fixes / Repo / Inventory / Inbox /
 *          Notifications / Queue / Health).
 *          ONE request per context: GET /v1/admin/workspace/nav-meta with
 *          include=counts returns every slice and per-item counter. The
 *          snapshot is shared by every caller, and Layout's `live` instance
 *          subscribes to realtime so the dots follow server truth shortly
 *          after something changes — no page reload needed.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { apiFetch } from './supabase'
import { useRealtimeReload } from './realtime'
import { getActiveProjectIdSnapshot, useActiveProjectSignal } from './activeProject'
import { getActiveOrgIdSnapshot, useActiveOrgSignal } from './activeOrg'
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
  /** Unfixed reports with a fix queued or running (counted per report). */
  fixesInFlight: number
  /** Unfixed reports whose latest attempt failed, was skipped, or whose PR closed / went red. */
  fixesFailed: number
  /** Subset of `fixesFailed` a retry can clear right now. */
  fixesRetryable: number
  /** Unfixed reports with a fix PR awaiting review or merge. */
  prsOpen: number
  /** Critical or high reports still waiting on a decision (any age). */
  urgentOpenReports: number
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
  fixesRetryable: 0,
  prsOpen: 0,
  urgentOpenReports: 0,
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

/** Tables whose writes can move a sidebar badge. */
const NAV_COUNT_TABLES = [
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
]

/**
 * Builds the single sidebar request. `include=counts` asks nav-meta for the
 * per-item counters it used to take ten separate requests to read;
 * `fresh=1` skips the server's short per-user cache (sent after a realtime
 * change, when the cached copy is known to be stale).
 */
function navMetaPath(opts: {
  inventoryEnabled: boolean
  isSuperAdmin: boolean
  fresh: boolean
  /** Slice keys to compute; null = all (Advanced shows every badge). */
  slices: readonly string[] | null
}): string {
  const include = ['counts']
  if (opts.inventoryEnabled) include.push('inventory')
  if (opts.isSuperAdmin) include.push('superadmin')
  const params = new URLSearchParams({ include: include.join(',') })
  if (opts.slices) params.set('slices', [...opts.slices].sort().join(','))
  if (opts.fresh) params.set('fresh', '1')
  return `/v1/admin/workspace/nav-meta?${params.toString()}`
}

/** A 404 means this API build predates nav-meta; anything else is an outage. */
function isRouteMissing(error: { code: string; message: string } | undefined): boolean {
  if (!error) return false
  return error.code === 'NOT_FOUND' || /^404\b/.test(error.message)
}

function countOrZero(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Pure mapping from one nav-meta answer to the sidebar's counters. */
function navCountsFromNavMeta(data: WorkspaceNavMetaResponse): NavCounts {
  const slices = normalizeNavSlices(data.slices)
  const counts = data.counts ?? null
  const neverIngestedCount = data.projects?.neverIngestedCount ?? 0
  const staleKeyCount = data.projects?.staleKeyCount ?? 0
  return {
    untriagedBacklog: countOrZero(counts?.untriagedBacklog),
    fixesInFlight: countOrZero(counts?.fixesInFlight),
    fixesFailed: countOrZero(counts?.fixesFailed),
    fixesRetryable: countOrZero(counts?.fixesRetryable),
    prsOpen: countOrZero(counts?.prsOpen),
    urgentOpenReports: countOrZero(counts?.urgentOpenReports),
    regressedActions: countOrZero(counts?.regressedActions),
    inboxOpenActions: countOrZero(counts?.inboxOpenActions),
    notificationsUnread: countOrZero(counts?.notificationsUnread),
    queueFailed: countOrZero(counts?.queueFailed),
    // Same definition the full /v1/admin/dashboard payload used here before:
    // integrations whose latest health check is not `ok`.
    healthIssues: countOrZero(slices.dashboard?.integrationIssues),
    flaggedDevices: countOrZero(counts?.flaggedDevices),
    feedbackWithReply: countOrZero(counts?.feedbackWithReply),
    judgeDisagreements: countOrZero(counts?.judgeDisagreements),
    projectCount: data.projects?.projectCount ?? 0,
    projectsNeedingAttention: projectsNeedingAttentionCount({ neverIngestedCount, staleKeyCount }),
    neverIngestedCount,
    staleKeyCount,
    memberCount: data.members?.memberCount ?? null,
    pendingInvites: data.members?.pendingInvites ?? 0,
    membersInactiveCount: data.members?.inactiveCount ?? 0,
    membersAtSeatCap: data.members?.atSeatCap ?? false,
    membersExpiringInvites: data.members?.expiringSoonInvites ?? 0,
    superAdminSignups7d: counts?.superAdminSignups7d ?? null,
    superAdminChurn30d: counts?.superAdminChurn30d ?? null,
    slices,
    ready: true,
  }
}

// ── Shared store ────────────────────────────────────────────────────────────
// Layout and PipelineStatusRibbon both read these counters. As two hook
// instances they each fired the whole request set; now every instance reads
// one module-level snapshot and loads are deduplicated by context key.

interface LoadContext {
  key: string
  inventoryEnabled: boolean
  isSuperAdmin: boolean
  slices: readonly string[] | null
}

let snapshot: NavCounts = INITIAL
const listeners = new Set<() => void>()
let loadedKey: string | null = null
let inflightKey: string | null = null
let loadSeq = 0
let rerun: { ctx: LoadContext; fresh: boolean } | null = null

function publish(next: NavCounts): void {
  snapshot = next
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

async function runLoad(ctx: LoadContext, fresh: boolean): Promise<void> {
  const seq = ++loadSeq
  inflightKey = ctx.key
  try {
    const res = await apiFetch<WorkspaceNavMetaResponse>(
      navMetaPath({
        inventoryEnabled: ctx.inventoryEnabled,
        isSuperAdmin: ctx.isSuperAdmin,
        slices: ctx.slices,
        fresh,
      }),
      fresh ? { cache: 'no-store' } : undefined,
    )
    if (seq !== loadSeq) return
    if (res.ok && res.data) {
      publish(navCountsFromNavMeta(res.data))
    } else if (isRouteMissing(res.error)) {
      // Only an API build without nav-meta takes the per-slice fallback; on
      // a 5xx that fan-out would multiply the load on a struggling API.
      const projectId = getActiveProjectIdSnapshot()
      const orgId = getActiveOrgIdSnapshot()
      const [fallbackSlices, projectsStatsRes, membersStatsRes] = await Promise.all([
        fetchNavSlicesFallback(projectId),
        apiFetch<ProjectsStats>('/v1/admin/projects/stats'),
        orgId
          ? apiFetch<MembersStats>(`/v1/org/${orgId}/members/stats`)
          : Promise.resolve({ ok: false as const, data: undefined }),
      ])
      if (seq !== loadSeq) return
      const projectsStats = projectsStatsRes.ok ? projectsStatsRes.data : undefined
      const membersStats = membersStatsRes.ok ? membersStatsRes.data : undefined
      publish(
        navCountsFromNavMeta({
          generatedAt: new Date().toISOString(),
          slices: fallbackSlices,
          counts: null,
          projects: projectsStats
            ? {
                projectCount: projectsStats.projectCount ?? 0,
                neverIngestedCount: projectsStats.neverIngestedCount ?? 0,
                staleKeyCount: projectsStats.staleKeyCount ?? 0,
              }
            : null,
          members: membersStats
            ? {
                memberCount: membersStats.memberCount ?? null,
                pendingInvites: membersStats.pendingInvites ?? 0,
                inactiveCount: membersStats.inactiveCount ?? 0,
                atSeatCap: membersStats.atSeatCap ?? false,
                expiringSoonInvites: membersStats.expiringSoonInvites ?? 0,
              }
            : null,
        }),
      )
    } else if (!snapshot.ready) {
      // Outage before anything loaded: stay not-ready. Every consumer
      // (badges, section counts, page hero, pipeline ribbon) treats that as
      // "not checked" — publishing ready with the all-zero initial snapshot
      // would show "0 failed / all clear" as a fact.
      publish({ ...snapshot })
    }
    // Outage after a good load: keep the last real numbers on screen.
    loadedKey = ctx.key
  } finally {
    if (seq === loadSeq) inflightKey = null
    const queued = rerun
    if (queued && seq === loadSeq) {
      rerun = null
      void runLoad(queued.ctx, queued.fresh)
    }
  }
}

/** Load for `ctx` unless that exact context is already loaded or loading. */
function requestLoad(ctx: LoadContext, fresh: boolean): void {
  if (!fresh && (loadedKey === ctx.key || inflightKey === ctx.key)) return
  if (fresh && inflightKey === ctx.key) {
    // A load for this context is running; refresh once it lands.
    rerun = { ctx, fresh: true }
    return
  }
  void runLoad(ctx, fresh)
}

/**
 * Sidebar counters, shared across every caller.
 *
 * The `live` caller (Layout, exactly one) owns loading: it says which slices
 * the visible sidebar and page need (`slices`, null = all) and subscribes to
 * realtime. Every other caller only reads the shared snapshot, so a second
 * reader never starts a second request set.
 */
export function useNavCounts(
  opts: { live?: boolean; slices?: readonly string[] | null } = {},
): NavCounts {
  const counts = useSyncExternalStore(subscribe, () => snapshot, () => INITIAL)
  const { isSuperAdmin, has: hasFeature } = useEntitlements()
  const inventoryEnabled = hasFeature('inventory_v2')
  const activeProjectSignal = useActiveProjectSignal()
  const activeOrgSignal = useActiveOrgSignal()
  const live = opts.live === true
  const slices = opts.slices ?? null
  const slicesKey = slices ? [...slices].sort().join(',') : '*'
  const key = `${activeOrgSignal}|${activeProjectSignal}|${inventoryEnabled ? 1 : 0}|${isSuperAdmin ? 1 : 0}|${slicesKey}`

  useEffect(() => {
    if (!live) return
    requestLoad({ key, inventoryEnabled, isSuperAdmin, slices }, false)
    // `slices` is captured through `key` (slicesKey).
  }, [live, key, inventoryEnabled, isSuperAdmin])

  useRealtimeReload(
    NAV_COUNT_TABLES,
    () => {
      requestLoad({ key, inventoryEnabled, isSuperAdmin, slices }, true)
    },
    { debounceMs: 1500, enabled: live },
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
