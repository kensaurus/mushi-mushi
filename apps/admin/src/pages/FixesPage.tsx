/**
 * FILE: apps/admin/src/pages/FixesPage.tsx
 * PURPOSE: V5.3 §2.10 + §2.18 — the auto-fix pipeline dashboard.
 *          Page-level orchestration only: data loading, polling, retry-all.
 *          Presentation lives in components/fixes/* so each piece (KPIs,
 *          recommendation banner, in-flight list, per-fix card) can evolve
 *          and be reasoned about in isolation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
import type { FixAttempt, DispatchJob, FixSummary } from '../components/fixes/types'
import { FixesStatusBanner } from '../components/fixes/FixesStatusBanner'
import { FixesPipelineGuide } from '../components/fixes/FixesPipelineGuide'
import { FixesSnapshotStrip } from '../components/fixes/FixesSnapshotStrip'
import { FixesFailedSummary } from '../components/fixes/FixesFailedSummary'
import { EMPTY_FIXES_STATS, type FixesStats, type FixesTabId } from '../components/fixes/FixesStatsTypes'
import { usePageCopy } from '../lib/copy'
import { useFixesUx, resolveQuickFixesTab } from '../lib/fixesModeUx'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
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
  { id: 'failed', label: 'Failed' },
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

function resolveFixesTab(value: string | null): FixesTabId {
  if (value === 'pipeline' || value === 'attempts') return value
  return 'overview'
}

function bucketize(fix: FixAttempt): StatusBucket {
  const status = fix.status?.toLowerCase()
  if (status === 'queued' || status === 'running') return 'inflight'
  if (status === 'failed') return 'failed'
  if (isFixMerged(fix)) return 'merged'
  // Open PRs (including CI-green) stay in pr_open — "Shipped" is merged-only.
  if (fix.pr_url) return 'pr_open'
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
  const activeTab = resolveFixesTab(tabParam)
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
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    if (!ux.isQuickstart || !activeProjectId || statsLoading) return
    const quickTab = resolveQuickFixesTab(fixesStats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, activeProjectId, statsLoading, fixesStats, activeTab, setActiveTab])
  const [fixes, setFixes] = useState<FixAttempt[]>([])
  const [codebaseStats, setCodebaseStats] = useState<CodebaseStats | null>(null)
  const [dispatches, setDispatches] = useState<DispatchJob[]>([])
  const [summary, setSummary] = useState<FixSummary | null>(null)
  const [timelines, setTimelines] = useState<Record<string, FixTimelineEvent[]>>({})
  const [inventoryActions, setInventoryActions] = useState<Record<string, InventoryActionNode | null>>({})
  const [loading, setLoading] = useState(true)
  const [isValidating, setIsValidating] = useState(true)
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [retryingAll, setRetryingAll] = useState(false)
  const [retryAllConfirm, setRetryAllConfirm] = useState(false)
  // Bulk selection on the Attempts tab. Set of fix_attempt ids.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<string | null>(null)
  const [bulkMergeConfirm, setBulkMergeConfirm] = useState(false)
  const [bulkRetryConfirm, setBulkRetryConfirm] = useState(false)
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
        apiFetch<{ fixes: FixAttempt[] }>('/v1/admin/fixes'),
        apiFetch<{ dispatches: DispatchJob[] }>('/v1/admin/fixes/dispatches'),
        apiFetch<FixSummary>('/v1/admin/fixes/summary'),
      ])
      if (cancelledRef.current) return
      if (fixRes.ok && fixRes.data) setFixes(fixRes.data.fixes)
      else setError(true)
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
    apiFetch<{ events: FixTimelineEvent[] }>(`/v1/admin/fixes/${expanded}/timeline`)
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.data) {
          setTimelines((prev) => ({ ...prev, [expanded]: res.data!.events }))
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

  const failedFixes = useMemo(() => fixes.filter((f) => f.status === 'failed'), [fixes])

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

  const visibleFixes = useMemo(() => {
    if (statusBucket === 'all') return fixes
    return fixes.filter((f) => bucketize(f) === statusBucket)
  }, [fixes, statusBucket])

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
    async (reportId: string) => {
      const optimisticId = pushOptimistic(reportId)
      const res = await apiFetch('/v1/admin/fixes/dispatch', {
        method: 'POST',
        body: JSON.stringify({ reportId, projectId: activeProjectId }),
      })
      if (res.ok) {
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

  const retryAllFailed = useCallback(async () => {
    if (failedFixes.length === 0) return
    setRetryingAll(true)
    const optimisticIds = failedFixes.map((f) => ({ reportId: f.report_id, id: pushOptimistic(f.report_id) }))
    const results = await Promise.allSettled(
      optimisticIds.map(({ reportId }) =>
        apiFetch('/v1/admin/fixes/dispatch', {
          method: 'POST',
          body: JSON.stringify({ reportId, projectId: activeProjectId }),
        }),
      ),
    )
    setRetryingAll(false)
    results.forEach((r, idx) => {
      const { id } = optimisticIds[idx]
      const ok = r.status === 'fulfilled' && (r.value as { ok: boolean }).ok
      const msg = r.status === 'fulfilled' ? (r.value as { error?: { message?: string } }).error?.message : 'Request failed'
      settleOptimistic(id, ok ? 'ok' : 'error', msg)
    })
    const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as { ok: boolean }).ok).length
    const failed = results.length - ok
    if (failed === 0) {
      toast.push({ tone: 'success', message: `Re-dispatched ${ok} failed ${pluralize(ok, 'fix', 'fixes')}` })
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
  const selectedFailed = useMemo(
    () => selectedFixes.filter((f) => f.status === 'failed'),
    [selectedFixes],
  )
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

  const retrySelected = useCallback(async () => {
    if (selectedFailed.length === 0) return
    setBulkBusy(true)
    setBulkProgress(`Re-dispatching ${selectedFailed.length}…`)
    const optimisticIds = selectedFailed.map((f) => ({ reportId: f.report_id, id: pushOptimistic(f.report_id) }))
    const results = await Promise.allSettled(
      optimisticIds.map(({ reportId }) =>
        apiFetch('/v1/admin/fixes/dispatch', {
          method: 'POST',
          body: JSON.stringify({ reportId, projectId: activeProjectId }),
        }),
      ),
    )
    results.forEach((r, idx) => {
      const { id } = optimisticIds[idx]
      const okRes = r.status === 'fulfilled' && (r.value as { ok: boolean }).ok
      const msg = r.status === 'fulfilled' ? (r.value as { error?: { message?: string } }).error?.message : 'Request failed'
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
      ? { kind: 'fix', id: expanded, label: fixes.find((f) => f.id === expanded)?.report_id ?? expanded.slice(0, 8) }
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
      ...(bucketCounts.failed > 0
        ? [{
            id: 'retry-all-failed',
            label: `Retry all ${pluralizeWithCount(bucketCounts.failed, 'failed fix', 'failed fixes')}`,
            hint: 'Re-dispatches every failed fix in the current view',
            run: () => { void retryAllFailed() },
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
      label: f.report_id ? `Fix on report ${f.report_id.slice(0, 8)}` : `Fix ${f.id.slice(0, 8)}`,
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
    <div className="space-y-3" data-testid="mushi-page-fixes">
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
          {pluralizeWithCount(fixes.length, 'attempt')}
        </span>
        {failedFixes.length > 0 && (
          <Btn
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRetryAllConfirm(true)}
            loading={retryingAll}
            title={`Re-dispatch every fix attempt currently in failed state (${pluralizeWithCount(failedFixes.length, 'job')}).`}
          >
            {retryingAll ? 'Retrying\u2026' : `Retry ${failedFixes.length} failed`}
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
              onReviewCategory={() => setStatusBucket('failed')}
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
                onRetrySelected={() => setBulkRetryConfirm(true)}
                onClear={clearSelection}
              />
              <FixesTable
                fixes={visibleFixes}
                expandedId={expanded}
                timelines={timelines}
                traceUrlFor={(traceId) => platform.traceUrl(traceId)}
                inFlightReportIds={inFlightReportIds}
                inventoryActions={inventoryActions}
                onToggle={(fixId) => setExpanded(expanded === fixId ? null : fixId)}
                onRetry={retryOne}
                onRefreshed={loadFixes}
                compactTable={ux.compactTable}
                hideTableChrome={ux.hideTableChrome}
              />
            </>
          )}
        </>
      )
      )}

      {retryAllConfirm && failedFixes.length > 0 ? (
        <ConfirmDialog
          title={`Retry ${failedFixes.length} failed ${pluralize(failedFixes.length, 'fix', 'fixes')}?`}
          body="Each retry runs the auto-fix agent again and spends LLM tokens. Failed attempts stay in history — you can review them on this page."
          confirmLabel="Retry all"
          cancelLabel="Cancel"
          tone="danger"
          loading={retryingAll}
          onConfirm={() => {
            setRetryAllConfirm(false)
            void retryAllFailed()
          }}
          onCancel={() => {
            if (!retryingAll) setRetryAllConfirm(false)
          }}
        />
      ) : null}

      {bulkRetryConfirm && selectedFailed.length > 0 ? (
        <ConfirmDialog
          title={`Retry ${selectedFailed.length} ${pluralize(selectedFailed.length, 'fix', 'fixes')}?`}
          body="Each retry runs the auto-fix agent again and spends LLM tokens. Failed attempts stay in history — you can review them on this page."
          confirmLabel={`Retry ${selectedFailed.length}`}
          cancelLabel="Cancel"
          tone="danger"
          loading={bulkBusy}
          onConfirm={() => {
            setBulkRetryConfirm(false)
            void retrySelected()
          }}
          onCancel={() => {
            if (!bulkBusy) setBulkRetryConfirm(false)
          }}
        />
      ) : null}

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

