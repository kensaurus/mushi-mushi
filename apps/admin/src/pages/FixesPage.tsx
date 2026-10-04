/**
 * FILE: apps/admin/src/pages/FixesPage.tsx
 * PURPOSE: V5.3 §2.10 + §2.18 — the auto-fix pipeline dashboard.
 *          Page-level orchestration only: data loading, polling, retry-all.
 *          Presentation lives in components/fixes/* so each piece (KPIs,
 *          recommendation banner, in-flight list, per-fix card) can evolve
 *          and be reasoned about in isolation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { useRealtimeReload } from '../lib/realtime'
import { usePublishPageContext } from '../lib/pageContext'
import { usePlatformIntegrations } from '../lib/usePlatformIntegrations'
import { pluralize, pluralizeWithCount } from '../lib/format'
import { Btn, SegmentedControl, ErrorAlert, FreshnessPill, HelpBanner } from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ActiveFiltersRail, type ActiveFilter } from '../components/ActiveFiltersRail'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { SetupNudge } from '../components/SetupNudge'
import { HeroFixWrench } from '../components/illustrations/HeroIllustrations'
import { useToast } from '../lib/toast'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import type { FixTimelineEvent } from '../components/FixGitGraph'
import { FixSummaryRow } from '../components/fixes/FixSummaryRow'
import { FixRecommendation } from '../components/fixes/FixRecommendation'
import { InflightDispatches } from '../components/fixes/InflightDispatches'
import { FixesTable } from '../components/fixes/FixesTable'
import { FixBulkActionBar } from '../components/fixes/FixBulkActionBar'
import { canMergeFix, isFixMerged, mergeFixAttempt } from '../lib/mergeFix'
import { isFixCountedFailed } from '../lib/pdcaAct'
import { failureCause, fixCauseLabel, fixReportLabel, needsAttention, retryCandidates } from '../lib/fixReportTruth'
import {
  RETRY_AGENT_OPTIONS,
  commonRetryAgent,
  resolveFixesTabParam,
  retryAgentFor,
  retryDispatchBody,
  type RetryAgent,
} from '../lib/fixRetry'
import type { FixAttempt, DispatchJob, FixSummary } from '../components/fixes/types'
import { FixesStatusBanner } from '../components/fixes/FixesStatusBanner'
import { FixesPipelineGuide } from '../components/fixes/FixesPipelineGuide'
import { FixesSnapshotStrip } from '../components/fixes/FixesSnapshotStrip'
import { FixesFailedSummary } from '../components/fixes/FixesFailedSummary'
import { EMPTY_FIXES_STATS, type FixesStats, type FixesTabId } from '../components/fixes/FixesStatsTypes'
import { usePageCopy } from '../lib/copy'
import { useFixesUx, resolveQuickFixesTab } from '../lib/fixesModeUx'
import { useQuickstartLandingTab } from '../lib/useQuickstartTab'
import { fixRowDomId, readFixDeepLinkId } from '../lib/fixDeepLink'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { trackSelf } from '../lib/track'
interface InventoryActionNode {
  actionNodeId?: string
  id?: string
  actionLabel?: string
  label?: string
  actionDescription?: string | null
  pagePath?: string | null
  storyTitle?: string | null
  expectedOutcome?: Record<string, unknown> | null
  status?: string | null
  metadata?: Record<string, unknown>
}

type StatusBucket = 'all' | 'inflight' | 'pr_open' | 'merged' | 'failed'

const STATUS_BUCKETS: { id: StatusBucket; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'inflight', label: 'In flight' },
  { id: 'pr_open', label: 'PR open' },
  { id: 'merged', label: 'Shipped' },
  { id: 'failed', label: 'Failed / skipped' },
]

const FIXES_TABS: Array<{ id: FixesTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Pipeline posture, summary KPIs, and the next recommended action.',
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    description: 'In-flight dispatches and failure categories before PRs land.',
  },
  {
    id: 'attempts',
    label: 'Attempts',
    description: 'Every draft PR — expand a card for rationale, CI status, and retry.',
  },
]

/** Attempts per request; the list route allows up to 200. */
const FIXES_PAGE_SIZE = 200

type RetryRequest =
  | { kind: 'one'; reportId: string; agent: RetryAgent }
  | { kind: 'all'; agent: RetryAgent }
  | { kind: 'selected'; agent: RetryAgent }

function bucketize(fix: FixAttempt): StatusBucket {
  const status = fix.status?.toLowerCase()
  if (status === 'queued' || status === 'running') return 'inflight'
  // "Failed / skipped" holds the latest attempt of each report that is
  // still unfixed after it failed, was skipped (2026-08-16 audit P1-4), or
  // its PR went red / closed unmerged (2026-10-02). Earlier attempts on a
  // report a later PR fixed are history, not failures (glot.it 2026-10-04),
  // so the filter count equals the banner's per-report count.
  if (needsAttention(fix)) return 'failed'
  if (isFixMerged(fix)) return 'merged'
  // Open PRs (including CI-green) stay in pr_open — "Shipped" is merged-only.
  if (fix.report_fix_state === 'pr_open' && fix.pr_url && !isFixCountedFailed(fix)) return 'pr_open'
  return 'all'
}

interface CodebaseStats {
  codebase_index_enabled: boolean
  indexed_files: number
}

export function FixesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const copy = usePageCopy('/fixes')
  const ux = useFixesUx()

  const tabParam = searchParams.get('tab')
  // A status filter lives on Attempts, so `/fixes?status=failed` (banners,
  // alerts, tiles) opens it instead of Overview (console QA 94).
  const activeTab = resolveFixesTabParam(tabParam, searchParams.get('status'))
  const causeFilter = searchParams.get('cause')
  const location = useLocation()
  const activeTabMeta = FIXES_TABS.find((t) => t.id === activeTab) ?? FIXES_TABS[0]

  const {
    data: statsData,
    loading: statsLoading,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<FixesStats>(
    activeProjectId ? '/v1/admin/fixes/stats' : null,
  )
  usePublishPageHeroStats('/fixes', statsData)
  const fixesStats = statsData ?? EMPTY_FIXES_STATS

  const setActiveTab = useCallback(
    (id: FixesTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      // The status and cause filters belong to Attempts.
      if (id !== 'attempts') {
        next.delete('status')
        next.delete('cause')
      }
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  // Quick mode opens the posture tab once; links and clicks then win.
  useQuickstartLandingTab({
    enabled: ux.isQuickstart && Boolean(activeProjectId),
    ready: !statsLoading,
    tabParam: tabParam,
    activeTab: activeTab,
    quickTab: resolveQuickFixesTab(fixesStats),
    setActiveTab: setActiveTab,
  })
  // Latest page (refreshed by realtime) plus older pages loaded on request,
  // so every attempt is reachable instead of the first 50 (console QA 91).
  const [latestFixes, setLatestFixes] = useState<FixAttempt[]>([])
  const [olderFixes, setOlderFixes] = useState<FixAttempt[]>([])
  const [fixesTotal, setFixesTotal] = useState<number | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const fixes = useMemo(() => {
    if (olderFixes.length === 0) return latestFixes
    const seen = new Set(latestFixes.map((f) => f.id))
    return [...latestFixes, ...olderFixes.filter((f) => !seen.has(f.id))]
  }, [latestFixes, olderFixes])
  const [codebaseStats, setCodebaseStats] = useState<CodebaseStats | null>(null)
  const [dispatches, setDispatches] = useState<DispatchJob[]>([])
  const [summary, setSummary] = useState<FixSummary | null>(null)
  const [timelines, setTimelines] = useState<Record<string, FixTimelineEvent[]>>({})
  const [baseBranches, setBaseBranches] = useState<Record<string, string | null>>({})
  const [inventoryActions, setInventoryActions] = useState<Record<string, InventoryActionNode | null>>({})
  const [loading, setLoading] = useState(true)
  const [isValidating, setIsValidating] = useState(true)
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [retryingAll, setRetryingAll] = useState(false)
  // Every retry spends LLM budget, so each one goes through a confirm that
  // also picks the agent (console QA 96, 241).
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null)
  // Bulk selection on the Attempts tab. Set of fix_attempt ids.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<string | null>(null)
  const [bulkMergeConfirm, setBulkMergeConfirm] = useState(false)
  const urlStatus = searchParams.get('status')
  const initialBucket: StatusBucket =
    urlStatus === 'failed' ? 'failed' :
    urlStatus === 'inflight' ? 'inflight' :
    urlStatus === 'pr_open' ? 'pr_open' :
    urlStatus === 'merged' ? 'merged' :
    'all'
  const [statusBucket, setStatusBucket] = useState<StatusBucket>(initialBucket)
  const toast = useToast()

  useEffect(() => {
    if (urlStatus === 'failed') setStatusBucket('failed')
    else if (urlStatus === 'inflight') setStatusBucket('inflight')
    else if (urlStatus === 'pr_open') setStatusBucket('pr_open')
    else if (urlStatus === 'merged') setStatusBucket('merged')
    else if (!urlStatus) setStatusBucket('all')
  }, [urlStatus])
  // Guard refs prevent overlapping polls and post-unmount state writes —
  // both happen often in StrictMode dev because effects mount twice.
  const inFlightRef = useRef(false)
  const cancelledRef = useRef(false)

  const loadFixes = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setError(false)
    setIsValidating(true)
    try {
      const [fixRes, dispRes, sumRes] = await Promise.all([
        apiFetch<{ fixes: FixAttempt[]; total?: number }>(`/v1/admin/fixes?limit=${FIXES_PAGE_SIZE}`),
        apiFetch<{ dispatches: DispatchJob[] }>('/v1/admin/fixes/dispatches'),
        apiFetch<FixSummary>('/v1/admin/fixes/summary'),
      ])
      if (cancelledRef.current) return
      if (fixRes.ok && fixRes.data) {
        setLatestFixes(fixRes.data.fixes)
        setFixesTotal(typeof fixRes.data.total === 'number' ? fixRes.data.total : null)
      } else setError(true)
      if (dispRes.ok && dispRes.data) setDispatches(dispRes.data.dispatches)
      if (sumRes.ok && sumRes.data) setSummary(sumRes.data)
      if (!cancelledRef.current) setLastFetchedAt(new Date().toISOString())
    } catch {
      if (!cancelledRef.current) setError(true)
    } finally {
      inFlightRef.current = false
      if (!cancelledRef.current) {
        setLoading(false)
        setIsValidating(false)
      }
    }
  }, [])

  const loadOlderFixes = useCallback(async () => {
    setLoadingOlder(true)
    try {
      const res = await apiFetch<{ fixes: FixAttempt[]; total?: number }>(
        `/v1/admin/fixes?limit=${FIXES_PAGE_SIZE}&offset=${fixes.length}`,
      )
      if (res.ok && res.data) {
        const page = res.data.fixes
        setOlderFixes((prev) => {
          const seen = new Set(prev.map((f) => f.id))
          return [...prev, ...page.filter((f) => !seen.has(f.id))]
        })
        if (typeof res.data.total === 'number') setFixesTotal(res.data.total)
      } else {
        toast.push({ tone: 'error', message: res.error?.message ?? "Couldn't load older attempts. Try again." })
      }
    } finally {
      setLoadingOlder(false)
    }
  }, [fixes.length, toast])

  // Codebase-index state drives the "you'll get stub PRs" banner. Loaded
  // once per project switch; cheap single-row + count read on the backend.
  useEffect(() => {
    if (!activeProjectId) {
      setCodebaseStats(null)
      return
    }
    let cancelled = false
    apiFetch<CodebaseStats>(`/v1/admin/projects/${activeProjectId}/codebase/stats`)
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.data) setCodebaseStats(res.data)
      })
      .catch(() => { /* banner just won't render — not fatal */ })
    return () => { cancelled = true }
  }, [activeProjectId])

  useEffect(() => {
    cancelledRef.current = false
    void loadFixes()
    return () => {
      cancelledRef.current = true
    }
  }, [loadFixes])

  // Realtime replaces the 5s poll. `fix_attempts` flips when an agent
  // moves through queued → running → succeeded/failed; `fix_events` fires
  // on every downstream GitHub webhook (push, pull_request, check_run).
  // We debounce because a single PR merge commonly emits 3–4 events within
  // the same second — collapsing them into one refresh keeps the list
  // stable for users who are reading while things land.
  const { channelState } = useRealtimeReload(['fix_attempts', 'fix_events', 'fix_dispatch_jobs'], () => {
    if (cancelledRef.current) return
    void loadFixes()
  })

  // Lazily fetch the per-fix PDCA timeline only once a card is expanded.
  // Cached by fix.id so re-opening is instant; refetched if status flips so
  // running fixes get a live update without polling every fix on the page.
  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    apiFetch<{ events: FixTimelineEvent[]; base_branch?: string | null }>(`/v1/admin/fixes/${expanded}/timeline`)
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.data) {
          const data = res.data
          setTimelines((prev) => ({ ...prev, [expanded]: data.events }))
          setBaseBranches((prev) => ({ ...prev, [expanded]: data.base_branch ?? null }))
        }
      })
      .catch(() => {
        /* timeline is best-effort; the card still renders without it */
      })
    return () => {
      cancelled = true
    }
  }, [expanded, fixes])

  // Lazily fetch the inventory action node when a fix with an anchor is expanded.
  // Cached by action node ID so re-opening any fix pointing to the same action
  // is instant. Null sentinel prevents re-fetching nodes that returned 404.
  //
  // The /v1/admin/graph/node/:nodeId endpoint returns { node: {...} } — we
  // unwrap to the inner node so callers don't have to know about the envelope.
  useEffect(() => {
    if (!expanded) return
    const fix = fixes.find((f) => f.id === expanded)
    const nodeId = fix?.inventory_action_node_id
    if (!nodeId) return
    if (inventoryActions[nodeId] !== undefined) return
    let cancelled = false
    apiFetch<{ node: InventoryActionNode }>(`/v1/admin/graph/node/${nodeId}`)
      .then((res) => {
        if (cancelled) return
        const node = res.ok && res.data?.node ? res.data.node : null
        setInventoryActions((prev) => ({ ...prev, [nodeId]: node }))
      })
      .catch(() => {
        setInventoryActions((prev) => ({ ...prev, [nodeId]: null }))
      })
    return () => {
      cancelled = true
    }
  }, [expanded, fixes, inventoryActions])

  const platform = usePlatformIntegrations()

  const successRate = useMemo(() => {
    if (!summary) return null
    const finished = summary.completed + summary.failed
    if (finished === 0) return null
    return summary.completed / finished
  }, [summary])

  // One entry per still-unfixed report a retry can clear now — never an
  // attempt on a report a merged PR already fixed (server-derived flag).
  const failedFixes = useMemo(() => retryCandidates(fixes), [fixes])

  // Pre-bucket every fix once so the segmented filter and the per-bucket
  // counts in the segmented control stay in sync without re-scanning the
  // list per render. closes the missing FixesPage status
  // filter finding.
  const bucketCounts = useMemo(() => {
    const counts: Record<StatusBucket, number> = { all: fixes.length, inflight: 0, pr_open: 0, merged: 0, failed: 0 }
    for (const f of fixes) {
      const b = bucketize(f)
      if (b !== 'all') counts[b] += 1
    }
    return counts
  }, [fixes])

  // "Common causes" chips narrow the failed list to one cause (console QA 93).
  const visibleFixes = useMemo(() => {
    const inBucket = statusBucket === 'all' ? fixes : fixes.filter((f) => bucketize(f) === statusBucket)
    if (!causeFilter || statusBucket !== 'failed') return inBucket
    return inBucket.filter((f) => failureCause(f) === causeFilter)
  }, [fixes, statusBucket, causeFilter])

  const reviewFailedCause = useCallback(
    (category: string) => {
      const next = new URLSearchParams(searchParams)
      next.set('tab', 'attempts')
      next.set('status', 'failed')
      if (category) next.set('cause', category)
      else next.delete('cause')
      setSearchParams(next, { replace: true, preventScrollReset: true })
      setStatusBucket('failed')
    },
    [searchParams, setSearchParams],
  )
  const clearCause = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('cause')
    setSearchParams(next, { replace: true, preventScrollReset: true })
  }, [searchParams, setSearchParams])

  // A link to one fix (command palette, Activity drawer, Ask Mushi, Slack):
  // open Attempts, make sure the fix is in the visible filter, expand it and
  // scroll to it. Once per id, so the user can collapse it afterwards. The
  // hash form `#fix-<id>` (failed-alert previews) lands here too.
  const deepLinkFixId = readFixDeepLinkId(searchParams, location.hash)
  const handledDeepLinkRef = useRef<string | null>(null)
  useEffect(() => {
    if (!deepLinkFixId || loading || error) return
    if (handledDeepLinkRef.current === deepLinkFixId) return
    handledDeepLinkRef.current = deepLinkFixId
    const target = fixes.find((f) => f.id === deepLinkFixId)
    if (!target) {
      toast.info(
        "That fix is not in this project's recent fixes.",
        'It may belong to another project. Switch project in the top bar, or open it from its report.',
      )
      return
    }
    if (activeTab !== 'attempts') setActiveTab('attempts')
    if (statusBucket !== 'all' && bucketize(target) !== statusBucket) setStatusBucket('all')
    setExpanded(target.id)
    let tries = 0
    const scroll = () => {
      const row = document.getElementById(fixRowDomId(target.id))
      if (row) row.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      else if (++tries < 10) window.setTimeout(scroll, 50)
    }
    window.setTimeout(scroll, 0)
  }, [deepLinkFixId, loading, error, fixes, activeTab, setActiveTab, statusBucket, toast])

  // (Page context publish moved below retryAllFailed so the action
  // closures bind to the live function reference without TDZ issues.)

  // Capped at 12 entries so a freshly-loaded list of 100+ fixes still finishes
  // its entrance animation in well under half a second
  // Optimistic-only dispatch rows: inserted synchronously when the user
  // clicks retry so the InflightDispatches panel updates within a frame
  // instead of waiting for the POST + realtime round-trip (typically
  // 300–800ms). Each optimistic row has an `optimistic_` id prefix so
  // `mergeDispatches` below can tell it apart from real ones returned by
  // the server and swap it out once the backend confirms. Failed POSTs
  // also flip the row to status=failed so the user sees why.
  const [optimisticDispatches, setOptimisticDispatches] = useState<DispatchJob[]>([])

  const pushOptimistic = useCallback((reportId: string): string => {
    const id = `optimistic_${reportId}_${Date.now().toString(36)}`
    setOptimisticDispatches((prev) => [
      {
        id,
        project_id: activeProjectId ?? 'unknown',
        report_id: reportId,
        status: 'queued',
        created_at: new Date().toISOString(),
      },
      ...prev,
    ])
    return id
  }, [activeProjectId])

  const settleOptimistic = useCallback((id: string, outcome: 'ok' | 'error', message?: string) => {
    if (outcome === 'ok') {
      // Drop immediately — loadFixes will replace it with the real row.
      setOptimisticDispatches((prev) => prev.filter((d) => d.id !== id))
      return
    }
    setOptimisticDispatches((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, status: 'failed' as const, error: message, finished_at: new Date().toISOString() } : d,
      ),
    )
    // Clear failed optimistic rows after a short grace period so the panel
    // doesn't accumulate stale error rows if the user ignores them.
    setTimeout(() => {
      setOptimisticDispatches((prev) => prev.filter((d) => d.id !== id))
    }, 8000)
  }, [])

  const retryOne = useCallback(
    async (reportId: string, agent: RetryAgent) => {
      const optimisticId = pushOptimistic(reportId)
      const res = await apiFetch('/v1/admin/fixes/dispatch', {
        method: 'POST',
        body: retryDispatchBody(reportId, activeProjectId, agent),
      })
      if (res.ok) {
        trackSelf('fix_dispatched', { report_id: reportId, agent: agent === 'auto' ? 'default' : agent })
        toast.push({ tone: 'success', message: 'Fix re-dispatched' })
        settleOptimistic(optimisticId, 'ok')
        void loadFixes()
      } else {
        toast.push({ tone: 'error', message: res.error?.message ?? 'Re-dispatch failed' })
        settleOptimistic(optimisticId, 'error', res.error?.message)
      }
    },
    [activeProjectId, loadFixes, pushOptimistic, settleOptimistic, toast],
  )

  /** Open the retry confirm for one report, defaulting to its last agent. */
  const requestRetryOne = useCallback(
    (reportId: string) => {
      const last = fixes.find((f) => f.report_id === reportId && f.is_latest_attempt) ?? fixes.find((f) => f.report_id === reportId)
      setRetryRequest({ kind: 'one', reportId, agent: retryAgentFor(last?.agent) })
    },
    [fixes],
  )

  const retryAllFailed = useCallback(async (agent: RetryAgent) => {
    if (failedFixes.length === 0) return
    setRetryingAll(true)
    const optimisticIds = failedFixes.map((f) => ({ reportId: f.report_id, id: pushOptimistic(f.report_id) }))
    const results = await Promise.allSettled(
      optimisticIds.map(({ reportId }) =>
        apiFetch('/v1/admin/fixes/dispatch', {
          method: 'POST',
          body: retryDispatchBody(reportId, activeProjectId, agent),
        }),
      ),
    )
    setRetryingAll(false)
    results.forEach((r, idx) => {
      const { id, reportId } = optimisticIds[idx]
      const ok = r.status === 'fulfilled' && (r.value as { ok: boolean }).ok
      const msg = r.status === 'fulfilled' ? (r.value as { error?: { message?: string } }).error?.message : 'Request failed'
      if (ok) trackSelf('fix_dispatched', { report_id: reportId, agent: agent === 'auto' ? 'default' : agent })
      settleOptimistic(id, ok ? 'ok' : 'error', msg)
    })
    const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as { ok: boolean }).ok).length
    const failed = results.length - ok
    if (failed === 0) {
      toast.push({ tone: 'success', message: `Re-dispatched ${ok} ${pluralize(ok, 'fix', 'fixes')}` })
    } else {
      toast.push({ tone: 'warning', message: `Re-dispatched ${ok} \u00b7 ${failed} failed` })
    }
    void loadFixes()
  }, [activeProjectId, failedFixes, loadFixes, pushOptimistic, settleOptimistic, toast])

  // ── Bulk selection ────────────────────────────────────────────────────────
  // Drop ids that have scrolled out of existence (e.g. after a reload removed a
  // merged fix) so the selection counts never reference stale rows.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev
      const live = new Set(fixes.map((f) => f.id))
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (live.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [fixes])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [statusBucket])

  const activeBucketLabel = useMemo(
    () => (statusBucket === 'all' ? null : STATUS_BUCKETS.find((b) => b.id === statusBucket)?.label),
    [statusBucket],
  )

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  const toggleSelectFix = useCallback((fixId: string, on: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(fixId)
      else next.delete(fixId)
      return next
    })
  }, [])

  // Select-all operates on the *current view* (the active status bucket), and
  // the label communicates that scope explicitly — NN/g guideline for select-all.
  const allVisibleSelected = useMemo(
    () => visibleFixes.length > 0 && visibleFixes.every((f) => selectedIds.has(f.id)),
    [visibleFixes, selectedIds],
  )
  const someVisibleSelected = useMemo(
    () => visibleFixes.some((f) => selectedIds.has(f.id)),
    [visibleFixes, selectedIds],
  )

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (visibleFixes.every((f) => next.has(f.id))) {
        for (const f of visibleFixes) next.delete(f.id)
      } else {
        for (const f of visibleFixes) next.add(f.id)
      }
      return next
    })
  }, [visibleFixes])

  // Counts that drive which bulk actions are enabled. Only fixes that are both
  // selected AND actionable count toward each action.
  const selectedFixes = useMemo(
    () => fixes.filter((f) => selectedIds.has(f.id)),
    [fixes, selectedIds],
  )
  const selectedMergeable = useMemo(
    () => selectedFixes.filter((f) => canMergeFix(f) && f.pr_url),
    [selectedFixes],
  )
  const selectedFailed = useMemo(() => retryCandidates(selectedFixes), [selectedFixes])
  const selectedMerged = useMemo(
    () => selectedFixes.filter((f) => isFixMerged(f)),
    [selectedFixes],
  )

  // Merge runs sequentially: GitHub write calls are far more sensitive to
  // secondary-rate-limits than the read-only dispatch fan-out, and a serial
  // loop lets us surface honest "3 / 8 merged…" progress as each PR lands.
  const mergeSelected = useCallback(async () => {
    if (selectedMergeable.length === 0) return
    setBulkBusy(true)
    let ok = 0
    let failed = 0
    for (let i = 0; i < selectedMergeable.length; i++) {
      const fix = selectedMergeable[i]
      setBulkProgress(`Merging ${i + 1} / ${selectedMergeable.length}…`)
      const result = await mergeFixAttempt(fix.id, 'squash')
      if (result.ok) {
        ok += 1
        setSelectedIds((prev) => {
          const next = new Set(prev)
          next.delete(fix.id)
          return next
        })
      } else {
        failed += 1
      }
    }
    setBulkBusy(false)
    setBulkProgress(null)
    if (failed === 0) {
      toast.push({ tone: 'success', message: `Merged ${ok} ${pluralize(ok, 'PR', 'PRs')} · linked reports marked Fixed` })
    } else {
      toast.push({ tone: 'warning', message: `Merged ${ok} \u00b7 ${failed} could not merge (check CI / branch protection)` })
    }
    void loadFixes()
  }, [selectedMergeable, loadFixes, toast])

  const retrySelected = useCallback(async (agent: RetryAgent) => {
    if (selectedFailed.length === 0) return
    setBulkBusy(true)
    setBulkProgress(`Re-dispatching ${selectedFailed.length}…`)
    const optimisticIds = selectedFailed.map((f) => ({ reportId: f.report_id, id: pushOptimistic(f.report_id) }))
    const results = await Promise.allSettled(
      optimisticIds.map(({ reportId }) =>
        apiFetch('/v1/admin/fixes/dispatch', {
          method: 'POST',
          body: retryDispatchBody(reportId, activeProjectId, agent),
        }),
      ),
    )
    results.forEach((r, idx) => {
      const { id, reportId } = optimisticIds[idx]
      const okRes = r.status === 'fulfilled' && (r.value as { ok: boolean }).ok
      const msg = r.status === 'fulfilled' ? (r.value as { error?: { message?: string } }).error?.message : 'Request failed'
      if (okRes) trackSelf('fix_dispatched', { report_id: reportId, agent: agent === 'auto' ? 'default' : agent })
      settleOptimistic(id, okRes ? 'ok' : 'error', msg)
    })
    const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as { ok: boolean }).ok).length
    const failed = results.length - ok
    setBulkBusy(false)
    setBulkProgress(null)
    clearSelection()
    if (failed === 0) {
      toast.push({ tone: 'success', message: `Re-dispatched ${ok} ${pluralize(ok, 'fix', 'fixes')}` })
    } else {
      toast.push({ tone: 'warning', message: `Re-dispatched ${ok} \u00b7 ${failed} failed` })
    }
    void loadFixes()
  }, [selectedFailed, activeProjectId, pushOptimistic, settleOptimistic, clearSelection, loadFixes, toast])

  // Publish page context so Ask Mushi and command palette can react
  // to the current bucket + counts (e.g. "Retry all failed fixes" only
  // makes sense when `failedFixes.length > 0`).
  usePublishPageContext({
    route: '/fixes',
    title: projectName ? `Fixes · ${projectName}` : 'Fixes',
    summary: loading
      ? 'Loading fix pipeline…'
      : `${pluralizeWithCount(fixes.length, 'fix', 'fixes')} · ${bucketCounts.inflight} in flight · ${bucketCounts.failed} failed`,
    filters: {
      bucket: statusBucket,
    },
    selection: expanded
      ? { kind: 'fix', id: expanded, label: (() => { const f = fixes.find((x) => x.id === expanded); return f ? fixReportLabel(f) : 'Fix' })() }
      : undefined,
    questions: [
      bucketCounts.failed > 0
        ? `Why did the ${pluralizeWithCount(bucketCounts.failed, 'failed fix', 'failed fixes')} fail?`
        : 'Is the auto-fix pipeline healthy right now?',
      bucketCounts.inflight > 0
        ? `What is taking the longest among the ${bucketCounts.inflight} in-flight fixes?`
        : 'Which report should I dispatch next?',
      'Which fixes are waiting on a human review?',
    ],
    actions: [
      // Retry re-dispatches retry candidates only (one per still-unfixed
      // report), so the label counts those, not the wider "Failed / skipped" bucket.
      ...(failedFixes.length > 0
        ? [{
            id: 'retry-all-failed',
            label: `Retry ${pluralizeWithCount(failedFixes.length, 'unfixed report', 'unfixed reports')}`,
            hint: 'Re-dispatches each still-unfixed report whose last attempt failed',
            run: () => setRetryRequest({ kind: 'all', agent: commonRetryAgent(failedFixes.map((f) => f.agent)) }),
          }]
        : []),
      ...(statusBucket !== 'all'
        ? [{
            id: 'show-all-fixes',
            label: 'Show all fixes',
            hint: 'Clear the current bucket filter',
            run: () => setStatusBucket('all'),
          }]
        : []),
      {
        id: 'focus-failed',
        label: 'Focus failed bucket',
        hint: 'Filter the table to fixes that need attention',
        run: () => setStatusBucket('failed'),
      },
    ],
    mentionables: fixes.slice(0, 10).map((f) => ({
      kind: 'fix' as const,
      id: f.id,
      label: `Fix on ${fixReportLabel(f)}`,
      sublabel: `status: ${f.status ?? 'unknown'}`,
    })),
  })

  // Merge optimistic rows with server rows — server wins if the same
  // report_id + status appears in both, keeping the list non-duplicative
  // once the real dispatch record lands via realtime.
  const mergedDispatches = useMemo(() => {
    if (optimisticDispatches.length === 0) return dispatches
    const realReportIds = new Set(dispatches.map((d) => d.report_id))
    const keptOptimistic = optimisticDispatches.filter((d) => !realReportIds.has(d.report_id))
    return [...keptOptimistic, ...dispatches]
  }, [dispatches, optimisticDispatches])

  const inFlightReportIds = useMemo(() => {
    const ids = new Set<string>()
    for (const f of fixes) {
      const s = f.status?.toLowerCase()
      if (s === 'queued' || s === 'running' || s === 'dispatched') ids.add(f.report_id)
    }
    for (const d of mergedDispatches) {
      const s = d.status?.toLowerCase()
      if (s === 'queued' || s === 'running') ids.add(d.report_id)
    }
    return ids
  }, [fixes, mergedDispatches])

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: copy?.tabLabels?.overview ?? 'Overview' },
      {
        id: 'pipeline' as const,
        label: copy?.tabLabels?.pipeline ?? 'Pipeline',
        count:
          fixesStats.inflightDispatches + fixesStats.inProgress > 0
            ? fixesStats.inflightDispatches + fixesStats.inProgress
            : undefined,
      },
      {
        id: 'attempts' as const,
        label: copy?.tabLabels?.attempts ?? 'Attempts',
        count: fixesStats.failed > 0 ? fixesStats.failed : fixes.length > 0 ? fixes.length : undefined,
      },
    ],
    [copy?.tabLabels, fixesStats, fixes.length],
  )

  const reloadAll = useCallback(() => {
    reloadStats()
    void loadFixes()
  }, [reloadStats, loadFixes])

  if (loading) return <TableSkeleton rows={6} columns={5} showFilters label="Loading fixes" />
  if (error) return <ErrorAlert message="Failed to load fix attempts." onRetry={loadFixes} />

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-fixes">
      <PageHeaderBar
        title={copy?.title ?? 'Fix drafts & PRs'}
        projectScope={projectName}

        helpTitle={copy?.help?.title ?? 'About drafted fixes'}
        helpWhatIsIt={copy?.help?.whatIsIt ?? 'When Mushi finds a reproducible bug, it drafts a fix on a branch and opens a pull request for you to review before merge.'}
        helpUseCases={copy?.help?.useCases ?? [
          'Track each draft PR from report to merge',
          'See model used, token spend, and trace link per attempt',
          'Spot failure patterns before retrying',
        ]}
        helpHowToUse={copy?.help?.howToUse ?? 'Summary for posture. Pipeline shows runs in flight. Attempts lists every draft PR.'}
      >
        <FreshnessPill at={lastFetchedAt ?? statsFetchedAt} isValidating={isValidating || statsValidating} channel={channelState} />
        <span className="inline-flex items-center rounded-sm border border-edge-subtle bg-surface-overlay/40 px-2 py-0.5 font-mono text-2xs tabular-nums text-fg-muted">
          {fixesTotal != null && fixesTotal > fixes.length
            ? `${fixes.length} of ${pluralizeWithCount(fixesTotal, 'attempt')}`
            : pluralizeWithCount(fixes.length, 'attempt')}
        </span>
        {failedFixes.length > 0 && (
          <Btn
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRetryRequest({ kind: 'all', agent: commonRetryAgent(failedFixes.map((f) => f.agent)) })}
            loading={retryingAll}
            title={`Re-dispatch ${pluralizeWithCount(failedFixes.length, 'report')} still unfixed after a failed attempt. Reports fixed by a later PR are never retried.`}
          >
            {retryingAll ? 'Retrying\u2026' : `Retry ${failedFixes.length} unfixed`}
          </Btn>
        )}
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <FixesStatusBanner
                stats={fixesStats}
                onTab={setActiveTab}
                onRefresh={reloadAll}
                refreshing={isValidating || statsValidating}
                plainBanner={ux.plainBanner}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: !ux.hideFixesSnapshot,
            children: (
              <FixesSnapshotStrip
                stats={fixesStats}
                statsFetchedAt={statsFetchedAt}
                statsValidating={statsValidating}
                description={activeTabMeta.description}
                sectionTitle={copy?.sections?.snapshot ?? 'FIXES SNAPSHOT'}
                statLabels={copy?.statLabels}
                hideLinks={ux.hideSnapshotLinks}
                compact={ux.isQuickstart}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.guide,
            show: activeTab === 'overview',
            children: (
              <FixesPipelineGuide
                topPriority={fixesStats.topPriority}
                stats={fixesStats}
              />
            ),
          },
        ]}
      />

      {!ux.hideTabs && (
      <SegmentedControl<FixesTabId>
        ariaLabel="Fix sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
        size="sm"
      />
      )}

      {activeTab === 'overview' && (
        <>
          {codebaseStats && (!codebaseStats.codebase_index_enabled || codebaseStats.indexed_files === 0) && (
            <HelpBanner
              tone="warn"
              role="status"
              data-testid="fixes-codebase-unindexed-banner"
              icon={<span aria-hidden="true">⚠</span>}
            >
              <strong className="font-semibold">Auto-fix will produce stub PRs</strong> —{' '}
              {codebaseStats.codebase_index_enabled
                ? 'your codebase index is empty, so the LLM has nothing to read.'
                : 'codebase indexing is off, so the LLM has nothing to read.'}{' '}
              <Link to="/integrations/config" className="underline hover:no-underline">Enable it now →</Link>
            </HelpBanner>
          )}

          {summary && (ux.isAdvanced || ux.hideFixesSnapshot) && (
            <FixSummaryRow summary={summary} successRate={successRate} />
          )}

          <FixRecommendation fixes={fixes} dispatches={mergedDispatches} />
        </>
      )}

      {activeTab === 'pipeline' && (
        <>
          {!ux.hideFailureCategories && (
            <FixesFailedSummary
              fixes={fixes}
              projectId={activeProjectId}
              onReviewCategory={reviewFailedCause}
            />
          )}
          <InflightDispatches dispatches={mergedDispatches} />
        </>
      )}

      {activeTab === 'attempts' && (
        fixes.length === 0 ? (
        <SetupNudge
          requires={['github_connected', 'first_report_received', 'byok_anthropic']}
          emptyTitle="No fix attempts yet"
          emptyDescription="Open a classified report and click “Dispatch fix” to start the auto-fix loop. Mushi opens a draft PR you review and merge — nothing ships without you."
          emptyIcon={<HeroFixWrench />}
          blockedIcon={<HeroFixWrench accent="text-fg-faint" />}
          emptyHints={[
            'Each dispatch creates one branch + one draft PR per attempt.',
            'The judge scores every attempt before it appears in green here.',
          ]}
        />
      ) : (
        <>
          <SegmentedControl<StatusBucket>
            ariaLabel="Filter fixes by status"
            value={statusBucket}
            options={STATUS_BUCKETS.map((b) => ({ id: b.id, label: b.label, count: bucketCounts[b.id] }))}
            onChange={setStatusBucket}
          />
          {(() => {
            const activeFilters: ActiveFilter[] = statusBucket !== 'all'
              ? [{
                  key: 'status',
                  label: 'Status',
                  value: STATUS_BUCKETS.find((b) => b.id === statusBucket)?.label ?? statusBucket,
                  onClear: () => setStatusBucket('all'),
                  tone: 'info' as const,
                }]
              : []
            if (causeFilter && statusBucket === 'failed') {
              activeFilters.push({
                key: 'cause',
                label: 'Cause',
                value: fixCauseLabel(causeFilter),
                onClear: clearCause,
                tone: 'info' as const,
              })
            }
            return (
              <ActiveFiltersRail
                filters={activeFilters}
                onClearAll={() => setStatusBucket('all')}
                ariaLabel="Active fix filters"
              />
            )
          })()}
          {visibleFixes.length === 0 ? (
            <EmptySectionMessage
              text="No fixes in this state right now."
              hint="Try another filter or dispatch a fix from Reports."
            />
          ) : (
            <>
              <FixBulkActionBar
                visibleCount={visibleFixes.length}
                filterLabel={activeBucketLabel}
                allVisibleSelected={allVisibleSelected}
                someVisibleSelected={someVisibleSelected}
                onToggleSelectAll={toggleSelectAllVisible}
                selectedCount={selectedIds.size}
                mergeableCount={selectedMergeable.length}
                mergedCount={selectedMerged.length}
                failedCount={selectedFailed.length}
                busy={bulkBusy}
                progressLabel={bulkProgress}
                onMergeSelected={() => setBulkMergeConfirm(true)}
                onRetrySelected={() =>
                  setRetryRequest({ kind: 'selected', agent: commonRetryAgent(selectedFailed.map((f) => f.agent)) })
                }
                onClear={clearSelection}
              />
              <FixesTable
                fixes={visibleFixes}
                expandedId={expanded}
                timelines={timelines}
                baseBranches={baseBranches}
                traceUrlFor={(traceId) => platform.traceUrl(traceId)}
                inFlightReportIds={inFlightReportIds}
                inventoryActions={inventoryActions}
                onToggle={(fixId) => setExpanded(expanded === fixId ? null : fixId)}
                onRetry={requestRetryOne}
                onRefreshed={loadFixes}
                selectedIds={selectedIds}
                onSelectFix={toggleSelectFix}
                compactTable={ux.compactTable}
                hideTableChrome={ux.hideTableChrome}
              />
              {fixesTotal != null && fixesTotal > fixes.length ? (
                <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-2xs text-fg-muted">
                  <span>
                    Showing the latest {fixes.length} of {pluralizeWithCount(fixesTotal, 'attempt')}. Filter counts cover the loaded ones.
                  </span>
                  <Btn size="sm" variant="ghost" onClick={() => void loadOlderFixes()} loading={loadingOlder}>
                    Load {Math.min(FIXES_PAGE_SIZE, fixesTotal - fixes.length)} older
                  </Btn>
                </div>
              ) : null}
            </>
          )}
        </>
      )
      )}

      {retryRequest ? (() => {
        const count =
          retryRequest.kind === 'one' ? 1 : retryRequest.kind === 'all' ? failedFixes.length : selectedFailed.length
        const busy = retryRequest.kind === 'all' ? retryingAll : retryRequest.kind === 'selected' ? bulkBusy : false
        if (count === 0) return null
        const title =
          retryRequest.kind === 'one'
            ? 'Retry this fix?'
            : retryRequest.kind === 'all'
              ? `Retry ${pluralizeWithCount(count, 'unfixed report')}?`
              : `Retry ${count} ${pluralize(count, 'fix', 'fixes')}?`
        return (
          <ConfirmDialog
            title={title}
            body="Each retry runs a coding agent again and spends LLM tokens. Failed attempts stay in history on this page."
            confirmLabel={count === 1 ? 'Retry' : `Retry ${count}`}
            cancelLabel="Cancel"
            tone="danger"
            loading={busy}
            onConfirm={() => {
              const req = retryRequest
              setRetryRequest(null)
              if (req.kind === 'one') void retryOne(req.reportId, req.agent)
              else if (req.kind === 'all') void retryAllFailed(req.agent)
              else void retrySelected(req.agent)
            }}
            onCancel={() => {
              if (!busy) setRetryRequest(null)
            }}
          >
            <label className="flex flex-col gap-1 text-2xs text-fg-secondary">
              <span className="font-medium">Run it with</span>
              <select
                value={retryRequest.agent}
                onChange={(e) => setRetryRequest({ ...retryRequest, agent: e.target.value as RetryAgent })}
                className="input text-xs"
                aria-label="Agent for the retry"
              >
                {RETRY_AGENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </ConfirmDialog>
        )
      })() : null}

      {bulkMergeConfirm && selectedMergeable.length > 0 ? (
        <ConfirmDialog
          title={`Merge ${selectedMergeable.length} ${pluralize(selectedMergeable.length, 'PR', 'PRs')}?`}
          body={`Each PR is squash-merged into your default branch via GitHub, the linked report is marked Fixed, the reporter is notified, and your connected integrations run. PRs with failing CI or branch protection may be rejected — they stay open for you to review. ${selectedFixes.length > selectedMergeable.length ? `(${selectedFixes.length - selectedMergeable.length} of your selected fixes have no mergeable PR and will be skipped.)` : ''}`}
          confirmLabel={`Merge ${selectedMergeable.length}`}
          cancelLabel="Cancel"
          tone="danger"
          loading={bulkBusy}
          onConfirm={() => {
            setBulkMergeConfirm(false)
            void mergeSelected()
          }}
          onCancel={() => {
            if (!bulkBusy) setBulkMergeConfirm(false)
          }}
        />
      ) : null}
    </div>
  )
}

