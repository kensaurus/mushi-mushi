import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { reportPermalink } from '../lib/reportUrl'
import { usePageData } from '../lib/usePageData'
import { useRealtimeReload } from '../lib/realtime'
import { useStagedRealtime } from '../lib/useStagedRealtime'
import { StagedChangesBanner } from '../components/StagedChangesBanner'
import { usePublishPageContext } from '../lib/pageContext'
import { apiFetch } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useUndoableBulk } from '../lib/useUndoableBulk'
import { useHotkeys } from '../lib/useHotkeys'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import {
  PageHeader,
  PageHelp,
  EmptyState,
  ErrorAlert,
  RecommendedAction,
  Tooltip,
  Kbd,
  Btn,
  FreshnessPill,
  Section,
  StatCard,
  SegmentedControl,
  Badge,
  Card,
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { BulkBar } from '../components/reports/BulkBar'
import { usePageCopy } from '../lib/copy'
import { useReportsUx, resolveQuickReportsTab } from '../lib/reportsModeUx'
import { HeroSearch } from '../components/illustrations/HeroIllustrations'
import { HelpOverlay } from '../components/reports/HelpOverlay'
import { ReportsFilterBar, type ContextChip } from '../components/reports/ReportsFilterBar'
import { ReportsQuickFilters } from '../components/reports/ReportsQuickFilters'
import { ReportPreviewDrawer } from '../components/reports/ReportPreviewDrawer'
import { SavedViewsRow } from '../components/SavedViewsRow'
import { ReportsKpiStrip } from '../components/reports/ReportsKpiStrip'
import { ReportsTable } from '../components/reports/ReportsTable'
import { PAGE_SIZE, type ReportRow, type SortDir, type SortField } from '../components/reports/types'
import { pluralize, pluralizeWithCount } from '../lib/format'
import { DogfoodNarrativeBanner } from '../components/DogfoodNarrativeBanner'
import { SdkConnectivityEmptyState } from '../components/SdkHealthSummary'
import { ReportsStatusBanner } from '../components/reports/ReportsStatusBanner'
import { EMPTY_REPORTS_STATS, type ReportsStats, type ReportsTabId } from '../components/reports/ReportsStatsTypes'
import {
  critical14dDetail,
  critical14dTooltip,
  dismissed14dDetail,
  dismissed14dTooltip,
  total14dDetail,
  total14dTooltip,
  untriagedDetail,
  untriagedTooltip,
} from '../lib/statTooltips/reports'
import { reportsLinks } from '../lib/statCardLinks'
import { PageHero } from '../components/PageHero'
import type { PlatformResponse } from '../components/integrations/types'

const REPORTS_TABS: Array<{ id: ReportsTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Triage posture, top priority, and keyboard shortcuts before you open the queue.',
  },
  {
    id: 'queue',
    label: 'Queue',
    description: 'Sortable triage table — filter, bulk actions, dispatch fixes, dismiss noise.',
  },
  {
    id: 'severity',
    label: 'Severity',
    description: '14-day severity tiles with sparklines — click a tile to filter the queue.',
  },
]

function resolveReportsTab(value: string | null): ReportsTabId {
  if (value === 'overview' || value === 'severity') return value
  return 'queue'
}

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const undoable = useUndoableBulk()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const copy = usePageCopy('/reports')
  const ux = useReportsUx()

  const tabParam = searchParams.get('tab')
  const activeTab = resolveReportsTab(tabParam)
  const activeTabMeta = REPORTS_TABS.find((t) => t.id === activeTab) ?? REPORTS_TABS[1]

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<ReportsStats>('/v1/admin/reports/stats')
  const stats = statsData ?? EMPTY_REPORTS_STATS

  const platformPath = activeProjectId ? '/v1/admin/integrations/platform' : null
  const platformQuery = usePageData<PlatformResponse>(platformPath, { deps: [activeProjectId] })
  const platformCfg = platformQuery.data?.platform
  const cursorEnabled = Boolean(platformCfg?.cursor_cloud?.cursor_api_key_ref)
  const claudeEnabled = Boolean(platformCfg?.claude_code_agent?.claude_api_key_ref)

  const setActiveTab = useCallback(
    (id: ReportsTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'queue') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    if (!ux.isQuickstart || statsLoading) return
    const quickTab = resolveQuickReportsTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsLoading, stats, activeTab, setActiveTab])

  const status = searchParams.get('status') ?? ''
  const category = searchParams.get('category') ?? ''
  const severity = searchParams.get('severity') ?? ''
  const platform = searchParams.get('platform') ?? ''
  const sdkPackage = searchParams.get('sdkPackage') ?? ''
  const component = searchParams.get('component') ?? ''
  const reporter = searchParams.get('reporter') ?? ''
  const sort = (searchParams.get('sort') as SortField | null) ?? 'created_at'
  const dir = (searchParams.get('dir') as SortDir | null) ?? 'desc'
  const page = Math.max(0, Number(searchParams.get('page') ?? '0') || 0)
  const q = searchParams.get('q') ?? ''
  // Group-by-fingerprint defaults ON (matches the audit "P0: collapse
  // duplicates"). Users can opt out with `?group=none` in the URL.
  const groupCollapse = (searchParams.get('group') ?? 'fingerprint') === 'fingerprint'
  const expandedGroups = useMemo(() => {
    const raw = searchParams.get('expand') ?? ''
    return new Set(raw.split(',').filter(Boolean))
  }, [searchParams])

  const [searchInput, setSearchInput] = useState(q)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  // Debounce the URL update so typing doesn't re-fire fetches per keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchInput === q) return
      const next = new URLSearchParams(searchParams)
      if (searchInput) next.set('q', searchInput)
      else next.delete('q')
      next.delete('page')
      setSearchParams(next, { replace: true })
    }, 300)
    return () => clearTimeout(id)
  }, [searchInput, q, searchParams, setSearchParams])

  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    if (status) p.set('status', status)
    if (category) p.set('category', category)
    if (severity) p.set('severity', severity)
    if (platform) p.set('platform', platform)
    if (sdkPackage) p.set('sdkPackage', sdkPackage)
    if (component) p.set('component', component)
    if (reporter) p.set('reporter', reporter)
    if (q) p.set('q', q)
    p.set('sort', sort)
    p.set('dir', dir)
    p.set('limit', String(PAGE_SIZE))
    p.set('offset', String(page * PAGE_SIZE))
    return p.toString()
  }, [status, category, severity, platform, sdkPackage, component, reporter, q, sort, dir, page])

  const { data, loading, error, isValidating, lastFetchedAt, reload } = usePageData<{ reports: ReportRow[]; total: number }>(
    `/v1/admin/reports?${queryString}`,
    { deps: [queryString] },
  )

  const reports = data?.reports ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const reloadAll = useCallback(() => {
    reloadStats()
    reload()
  }, [reloadStats, reload])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState(0)

  // Queue-engagement tracking. The HotkeysModal documents `[`/`]` as
  // "only paginates while the queue has focus", but the queue cursor is
  // a state index — no DOM element actually receives focus on j/k — so
  // we synthesise the same semantic with a ref.
  //
  // `queueEngagedRef.current === true` means the user's most recent
  // intentional action targeted the queue (a queue keyboard shortcut
  // fired, or they clicked into the queue container). It flips back to
  // false on any click outside `[data-mushi-reports-queue]` or when the
  // page unmounts. While engaged, `[` paginates and preempts the global
  // sidebar-collapse binding; while not engaged, `[` falls through to
  // the global handler and collapses the sidebar exactly as on every
  // other page. This honours the docstring promise without forcing a
  // visible focus ring on every list row.
  const queueEngagedRef = useRef(false)
  const markQueueEngaged = useCallback(() => {
    queueEngagedRef.current = true
  }, [])
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null
      queueEngagedRef.current = Boolean(
        target?.closest('[data-mushi-reports-queue]'),
      )
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      queueEngagedRef.current = false
    }
  }, [])

  // Wave T.3.6: stage realtime INSERTs on `reports` when the triager is
  // mid-review (has selection / cursor below top / scrolled down). Auto-
  // apply when the triager is clearly idle at the top. `fix_attempts` is
  // a separate, eager reload because those updates touch rows the user
  // is already looking at — there's no scroll-position cost to applying
  // them.
  const reportsStaged = useStagedRealtime({
    tables: ['reports'],
    onApply: reloadAll,
    shouldAutoApply: () =>
      selected.size === 0 &&
      cursor === 0 &&
      (typeof window === 'undefined' || window.scrollY < 10),
  })
  const { channelState: fixChannelState } = useRealtimeReload(['fix_attempts'], reloadAll)
  // Prefer the reports channel state for the freshness pill — if that drops
  // the UI is stale even if fix_attempts is still live.
  const channelState =
    reportsStaged.channelState === 'dropped' || fixChannelState === 'dropped'
      ? 'dropped'
      : reportsStaged.channelState === 'live' || fixChannelState === 'live'
        ? 'live'
        : 'idle'
  const [bulkBusy, setBulkBusy] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [dispatching, setDispatching] = useState<Set<string>>(new Set())

  // Reset selection + cursor whenever the visible page changes.
  useEffect(() => {
    setSelected(new Set())
    setCursor(0)
  }, [queryString])

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allSelected = reports.length > 0 && reports.every((r) => selected.has(r.id))
  const someSelected = !allSelected && reports.some((r) => selected.has(r.id))

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      if (reports.every((r) => prev.has(r.id))) return new Set()
      const next = new Set(prev)
      for (const r of reports) next.add(r.id)
      return next
    })
  }, [reports])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const setFilter = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams)
      if (value) next.set(key, value)
      else next.delete(key)
      next.delete('page')
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  const setSort = useCallback(
    (field: SortField) => {
      const next = new URLSearchParams(searchParams)
      if (field === sort) {
        next.set('dir', dir === 'asc' ? 'desc' : 'asc')
      } else {
        next.set('sort', field)
        // created_at defaults to newest-first; everything else (status, severity,
        // component, confidence) defaults to ascending so the lowest/earliest
        // value sorts to the top on first click.
        next.set('dir', field === 'created_at' ? 'desc' : 'asc')
      }
      next.delete('page')
      setSearchParams(next)
    },
    [searchParams, setSearchParams, sort, dir],
  )

  const setPage = useCallback(
    (p: number) => {
      const next = new URLSearchParams(searchParams)
      if (p === 0) next.delete('page')
      else next.set('page', String(p))
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  // Toggle a group's expand state and persist into the URL so the back-button
  // restores any open groups. Empty list = clean URL.
  const toggleGroup = useCallback(
    (groupId: string) => {
      const next = new URLSearchParams(searchParams)
      const current = new Set((next.get('expand') ?? '').split(',').filter(Boolean))
      if (current.has(groupId)) current.delete(groupId)
      else current.add(groupId)
      if (current.size === 0) next.delete('expand')
      else next.set('expand', [...current].join(','))
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const runBulk = useCallback(
    async (action: 'set_status' | 'set_severity' | 'dismiss', value?: string) => {
      if (selected.size === 0) return
      setBulkBusy(true)
      const ids = [...selected]
      const res = await apiFetch<{ updated: number; mutation_id: string | null }>(
        `/v1/admin/reports/bulk`,
        {
          method: 'POST',
          body: JSON.stringify({ ids, action, value }),
        },
      )
      setBulkBusy(false)
      if (!res.ok) {
        toast.error('Bulk action failed', res.error?.message ?? 'Unknown error')
        return
      }
      const verb =
        action === 'dismiss'
          ? 'Dismissed'
          : action === 'set_status'
            ? `Status → ${value}`
            : `Severity → ${value}`
      const updated = res.data?.updated ?? ids.length
      undoable.announce(
        {
          mutationId: res.data?.mutation_id ?? null,
          affected: updated,
        },
        {
          successTitle: verb,
          successDescription: `${pluralizeWithCount(updated, 'report')} updated`,
          onReload: reload,
        },
      )
      clearSelection()
      reload()
    },
    [selected, toast, clearSelection, reload, undoable],
  )

  const openCursor = useCallback(() => {
    const r = reports[cursor]
    if (r) navigate(`/reports/${r.id}`)
  }, [cursor, reports, navigate])

  // Publish page context so Ask Mushi, the hotkeys modal, and command
  // palette all see the user's current filters, the number of matches,
  // and the focused/previewed report. Recomputed on every render so
  // closures over `reports` / `cursor` stay fresh; the registry dedupes
  // via a JSON key in `usePublishPageContext`.
  const previewId = searchParams.get('preview') ?? ''
  const focusedReport = reports[cursor] ?? null
  const selection = previewId
    ? {
        kind: 'report',
        id: previewId,
        label: reports.find((r) => r.id === previewId)?.description?.slice(0, 80) ?? previewId.slice(0, 8),
      }
    : focusedReport
      ? {
          kind: 'report',
          id: focusedReport.id,
          label: focusedReport.description?.slice(0, 80) ?? focusedReport.id.slice(0, 8),
        }
      : undefined

  // Count critical reports on screen so `useFaviconBadge` can paint a
  // red dot when there's unresolved severity=critical work. Inline here
  // because `criticalQueuedCount` further down is filtered by status.
  const criticalOnPage = reports.filter((r) => r.severity === 'critical').length

  usePublishPageContext({
    route: '/reports',
    title: projectName ? `Reports · ${projectName}` : 'Reports',
    summary: loading
      ? 'Loading reports…'
      : total === 0
        ? 'No reports match the current filters'
        : `${pluralizeWithCount(total, 'report')}${criticalOnPage > 0 ? ` · ${criticalOnPage} critical` : ''}${selected.size > 0 ? ` · ${selected.size} selected` : ''}`,
    criticalCount: criticalOnPage,
    filters: {
      status: status || 'all',
      severity: severity || 'all',
      category: category || 'all',
      component: component || undefined,
      reporter: reporter || undefined,
      search: q || undefined,
      group: groupCollapse ? 'fingerprint' : 'none',
    },
    selection,
    actions: [
      {
        id: 'reports:triage-next',
        label: 'Triage next new report',
        hint: 'Jumps to the oldest unresolved new-status report',
        shortcut: 'g n',
        run: () => {
          const next = reports.find((r) => r.status === 'new')
          if (next) navigate(`/reports/${next.id}`)
          else toast.info('No new reports to triage', 'Switch status filter to "new" to find them')
        },
      },
      {
        id: 'reports:clear-filters',
        label: 'Clear all filters',
        hint: 'Reset status / severity / category / search',
        run: () => setSearchParams(new URLSearchParams(), { replace: true }),
      },
      {
        id: 'reports:select-all',
        label: allSelected ? 'Clear selection' : 'Select all on this page',
        shortcut: 'A',
        run: toggleSelectAll,
      },
    ],
    questions: [
      status === 'new'
        ? 'Which of these new reports should I dispatch first?'
        : severity === 'critical'
          ? 'Summarize the critical bugs in this view'
          : 'What is the oldest unresolved report here?',
      'Are any of these reports likely duplicates?',
      selection
        ? `Explain the focused report (${selection.id.slice(0, 8)}) and why it matters`
        : 'How should I prioritise what is on screen?',
    ],
    mentionables: reports.slice(0, 12).map((r) => ({
      kind: 'report' as const,
      id: r.id,
      label: r.description?.slice(0, 60) ?? r.id.slice(0, 8),
      sublabel: `${r.status ?? 'unknown'} · ${r.severity ?? 'unscored'}`,
    })),
  })

  const moveCursor = useCallback(
    (delta: number) => {
      setCursor((c) => {
        const next = Math.max(0, Math.min(reports.length - 1, c + delta))
        // Scroll the focused row into view if it falls off-screen.
        requestAnimationFrame(() => {
          document
            .querySelector(`[data-row-index="${next}"]`)
            ?.scrollIntoView({ block: 'nearest' })
        })
        return next
      })
    },
    [reports.length],
  )

  useHotkeys(
    [
      {
        key: 'j',
        description: 'Next report',
        handler: () => {
          markQueueEngaged()
          moveCursor(1)
        },
      },
      {
        key: 'k',
        description: 'Previous report',
        handler: () => {
          markQueueEngaged()
          moveCursor(-1)
        },
      },
      {
        key: 'x',
        description: 'Toggle selection',
        handler: () => {
          markQueueEngaged()
          const r = reports[cursor]
          if (r) toggleSelect(r.id)
        },
      },
      {
        key: 'Enter',
        description: 'Open report',
        handler: () => {
          markQueueEngaged()
          openCursor()
        },
      },
      {
        key: ' ',
        description: 'Preview report (keeps list scroll)',
        handler: (e) => {
          e.preventDefault()
          markQueueEngaged()
          const r = reports[cursor]
          if (!r) return
          const next = new URLSearchParams(searchParams)
          if (next.get('preview') === r.id) next.delete('preview')
          else next.set('preview', r.id)
          setSearchParams(next)
        },
      },
      {
        key: 'Escape',
        description: 'Clear selection / close help',
        allowInInputs: true,
        handler: () => {
          setShowHelp(false)
          clearSelection()
          queueEngagedRef.current = false
          ;(document.activeElement as HTMLElement | null)?.blur?.()
        },
      },
      {
        key: '/',
        description: 'Focus search',
        handler: (e) => {
          e.preventDefault()
          markQueueEngaged()
          searchInputRef.current?.focus()
        },
      },
      { key: '?', description: 'Show shortcuts', handler: () => setShowHelp((v) => !v) },
      {
        key: 'a',
        description: 'Select all on page',
        handler: () => {
          markQueueEngaged()
          toggleSelectAll()
        },
      },
      // `[` and `]` collide with the global sidebar-collapse binding in
      // `Layout.tsx`. We honour the HotkeysModal docstring ("only paginates
      // while the queue has focus") by gating both on `queueEngagedRef`.
      // When engaged we paginate AND call `e.stopImmediatePropagation()`
      // so the global `[` doesn't also fire — the page hook is registered
      // with `capture: true` below so its listener runs *before* the
      // bubble-phase global one. When NOT engaged we no-op without
      // stopping propagation, so the global `[` keeps collapsing the
      // sidebar exactly as on every other page. We do this in the
      // handler (not via the binding's `preempt` flag) because the
      // suppress-or-fall-through choice is per-keystroke, not static.
      {
        key: ']',
        description: 'Next page (queue)',
        handler: (e) => {
          if (!queueEngagedRef.current) return
          if (page < totalPages - 1) {
            e.stopImmediatePropagation()
            setPage(page + 1)
          }
        },
      },
      {
        key: '[',
        description: 'Previous page (queue)',
        handler: (e) => {
          if (!queueEngagedRef.current) return
          if (page > 0) {
            e.stopImmediatePropagation()
            setPage(page - 1)
          }
        },
      },
    ],
    { enabled: !loading, capture: true },
  )

  const contextChips: ContextChip[] = []
  if (component) contextChips.push({ key: 'component', label: 'Component', value: component })
  if (reporter)
    contextChips.push({ key: 'reporter', label: 'Reporter', value: `${reporter.slice(0, 12)}…` })

  const hasFilters = Boolean(status || category || severity || platform || sdkPackage || component || reporter || q)
  const queuedCount = reports.filter((r) => r.status === 'queued' || r.status === 'new').length
  const criticalQueuedCount = reports.filter(
    (r) => (r.status === 'queued' || r.status === 'new') && r.severity === 'critical',
  ).length

  const recommendation = (() => {
    if (loading || error) return null
    if (total === 0 && !hasFilters) {
      return {
        title: 'No reports yet',
        description:
          'Install the SDK in your app and trigger a test report to see the pipeline come alive.',
        cta: { label: 'Open setup wizard', to: '/onboarding' },
        tone: 'info' as const,
      }
    }
    if (criticalQueuedCount > 0) {
      return {
        title: `${pluralizeWithCount(criticalQueuedCount, 'critical report')} ${pluralize(criticalQueuedCount, 'needs', 'need')} triage`,
        description:
          'High-severity reports are still pending. Open them to confirm classification and dispatch a fix.',
        cta: {
          label: 'Show critical untriaged',
          onClick: () => {
            const next = new URLSearchParams(searchParams)
            next.set('status', 'new')
            next.set('severity', 'critical')
            next.delete('page')
            setSearchParams(next)
          },
        },
        tone: 'urgent' as const,
      }
    }
    if (queuedCount > 0 && !status) {
      return {
        title: `${pluralizeWithCount(queuedCount, 'report')} ${pluralize(queuedCount, 'is', 'are')} waiting for triage`,
        description:
          'Filter to the new bucket to confirm classification and decide who fixes them.',
        cta: { label: 'Filter to untriaged', onClick: () => setFilter('status', 'new') },
        tone: 'info' as const,
      }
    }
    return null
  })()

  const handleOpen = useCallback(
    (r: ReportRow) => {
      navigate(`/reports/${r.id}`)
    },
    [navigate],
  )

  const handleCopyLink = useCallback(
    (r: ReportRow) => {
      const url = reportPermalink(r.id)
      navigator.clipboard.writeText(url).then(
        () => toast.success('Link copied'),
        () => toast.error('Could not copy link'),
      )
    },
    [toast],
  )

  const handleDismiss = useCallback(
    async (r: ReportRow) => {
      const res = await apiFetch<{ updated: number; mutation_id: string | null }>(
        '/v1/admin/reports/bulk',
        {
          method: 'POST',
          body: JSON.stringify({ ids: [r.id], action: 'dismiss' }),
        },
      )
      if (!res.ok) {
        toast.error('Dismiss failed', res.error?.message)
        return
      }
      undoable.announce(
        {
          mutationId: res.data?.mutation_id ?? null,
          affected: res.data?.updated ?? 1,
        },
        {
          successTitle: 'Dismissed',
          successDescription: '1 report updated',
          onReload: reload,
        },
      )
      setSelected(new Set())
    },
    [undoable, reload, toast],
  )

  const dispatchReport = useCallback(
    async (r: ReportRow, agentOverride?: string) => {
      setDispatching(prev => new Set(prev).add(r.id))
      const res = await apiFetch<{ dispatchId: string }>(`/v1/admin/fixes/dispatch`, {
        method: 'POST',
        body: JSON.stringify({
          reportId: r.id,
          projectId: r.project_id,
          ...(agentOverride ? { agentOverride } : {}),
        }),
      })
      setDispatching(prev => {
        const next = new Set(prev)
        next.delete(r.id)
        return next
      })
      if (!res.ok) {
        toast.error('Dispatch failed', res.error?.message ?? 'Could not queue fix attempt')
        return
      }
      const label = agentOverride === 'claude_code_agent'
        ? 'Claude Code Agent dispatched'
        : agentOverride === 'cursor_cloud'
          ? 'Cursor agent dispatched'
          : 'Fix dispatched'
      toast.success(label, 'Track progress on the Fixes page')
      reload()
    },
    [toast, reload],
  )

  const handleDispatchFix = useCallback((r: ReportRow) => dispatchReport(r), [dispatchReport])
  const handleDispatchCursor = useCallback(
    (r: ReportRow) => dispatchReport(r, 'cursor_cloud'),
    [dispatchReport],
  )
  const handleDispatchClaude = useCallback(
    (r: ReportRow) => dispatchReport(r, 'claude_code_agent'),
    [dispatchReport],
  )

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : !stats.hasIngest
        ? 'warn'
        : stats.topPriority === 'critical'
          ? 'danger'
          : stats.topPriority === 'backlog'
            ? 'warn'
            : stats.topPriority === 'untriaged'
              ? 'info'
              : 'ok'

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: copy?.tabLabels?.overview ?? 'Overview' },
      {
        id: 'queue' as const,
        label: copy?.tabLabels?.queue ?? 'Queue',
        count: stats.newUntriaged > 0 ? stats.newUntriaged : undefined,
      },
      {
        id: 'severity' as const,
        label: copy?.tabLabels?.severity ?? 'Severity',
        count: stats.critical14d > 0 ? stats.critical14d : undefined,
      },
    ],
    [stats, copy?.tabLabels],
  )

  const handleSeverityFilter = useCallback(
    (sev: string) => {
      setFilter('severity', sev)
      setActiveTab('queue')
    },
    [setFilter, setActiveTab],
  )

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading reports">
        <div className="h-8 w-48 rounded bg-surface-raised" />
        <div className="h-16 rounded bg-surface-raised/60" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded bg-surface-raised/40" />
          ))}
        </div>
      </div>
    )
  }
  if (statsError) {
    return <ErrorAlert message={`Failed to load reports stats: ${statsError}`} onRetry={reloadAll} />
  }

  const queuePanel = (
    <>
      <ReportsQuickFilters status={status} severity={severity} onSetFilter={setFilter} />

      {!ux.hideSavedViews && (
      <SavedViewsRow
        scope="reports"
        currentQuery={searchParams.toString()}
        onApply={(q) => {
          const next = new URLSearchParams(q)
          setSearchParams(next)
          setSearchInput(next.get('q') ?? '')
        }}
      />
      )}

      <ReportsFilterBar
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        searchInputRef={searchInputRef}
        status={status}
        category={category}
        severity={severity}
        platform={platform}
        sdkPackage={sdkPackage}
        contextChips={contextChips}
        hasFilters={hasFilters}
        onSetFilter={setFilter}
        onClearAll={() => {
          setSearchInput('')
          setSearchParams({})
        }}
      />

      <BulkBar
        count={selected.size}
        busy={bulkBusy}
        onClear={clearSelection}
        onSetStatus={(v) => runBulk('set_status', v)}
        onSetSeverity={(v) => runBulk('set_severity', v)}
        onDismiss={() => runBulk('dismiss')}
      />

      <StagedChangesBanner
        count={reportsStaged.stagedCount}
        onApply={reportsStaged.apply}
        onDiscard={reportsStaged.discard}
        noun="new report"
      />

      {loading ? (
        <TableSkeleton rows={8} columns={6} showFilters={false} label="Loading reports" />
      ) : error ? (
        <ErrorAlert message={`Failed to load reports: ${error}`} onRetry={reloadAll} />
      ) : reports.length === 0 && hasFilters ? (
        <EmptyState
          icon={<HeroSearch accent="text-fg-faint" />}
          title="No reports match the selected filters."
          description="Try clearing a filter or widening the time window in the search bar."
          action={
            hasFilters ? (
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearchInput('')
                  setSearchParams({})
                }}
              >
                Clear all filters
              </Btn>
            ) : undefined
          }
        />
      ) : reports.length === 0 ? (
        setup.activeProject ? (
          <SdkConnectivityEmptyState
            projectId={setup.activeProject.project_id}
            projectName={setup.activeProject.project_name}
            lastReportAt={stats.lastReportAt}
            diagnostic={setup.getStep('sdk_installed')?.diagnostic ?? null}
            adminHost={setup.data?.admin_endpoint_host ?? null}
            onTestReportSent={() => {
              setup.reload()
              reloadAll()
            }}
          />
        ) : (
          <EmptyState
            icon={<HeroSearch accent="text-fg-faint" />}
            title="No reports yet"
            description="Install the SDK and send a test report from Setup to populate the triage queue."
          />
        )
      ) : (
        <div data-mushi-reports-queue>
          <ReportsTable
            reports={reports}
            total={total}
            page={page}
            totalPages={totalPages}
            sort={sort}
            dir={dir}
            selected={selected}
            cursor={cursor}
            allSelected={allSelected}
            someSelected={someSelected}
            dispatching={dispatching}
            groupCollapse={groupCollapse}
            expandedGroups={expandedGroups}
            onToggleGroup={toggleGroup}
            onToggleSelectAll={toggleSelectAll}
            onToggleSelect={toggleSelect}
            onSetSort={setSort}
            onSetCursor={setCursor}
            onSetPage={setPage}
            onOpen={handleOpen}
            onCopyLink={handleCopyLink}
            onDismiss={handleDismiss}
            onDispatchFix={handleDispatchFix}
            onDispatchCursor={handleDispatchCursor}
            onDispatchClaude={handleDispatchClaude}
            cursorEnabled={cursorEnabled}
            claudeEnabled={claudeEnabled}
          />
        </div>
      )}
    </>
  )

  return (
    <div className="space-y-4" data-testid="mushi-page-reports" data-reports-root>
      <PageHelp
        title={copy?.help?.title ?? 'About Reports'}
        whatIsIt={
          copy?.help?.whatIsIt ??
          'The triage inbox for every bug report submitted via the SDK. The LLM pipeline auto-classifies category, severity, component, and confidence — you confirm or override and dispatch fixes.'
        }
        useCases={
          copy?.help?.useCases ?? [
            'Triage incoming reports — sort by severity, filter by status',
            'Bulk-dismiss noise or escalate a batch of regressions in one click',
            'Drill into a single report for the original payload, screenshots, and pipeline timeline',
          ]
        }
        howToUse={
          copy?.help?.howToUse ??
          'Overview for posture. Queue for j/k navigation, bulk actions, and dispatch. Severity for 14d sparklines — click a tile to filter the queue.'
        }
      />

      <PageHeader
        title={copy?.title ?? 'Reports'}
        projectScope={stats.projectName ?? projectName ?? undefined}
        description={
          copy?.description ??
          (stats.newUntriaged > 0
            ? `${stats.newUntriaged} awaiting triage — Queue tab for bulk actions`
            : 'User-felt friction reports — Overview for posture, Queue to triage, Severity for 14d trends')
        }
      >
        <Badge
          className={
            bannerSeverity === 'ok'
              ? 'bg-ok-muted text-ok'
              : bannerSeverity === 'danger'
                ? 'bg-danger/10 text-danger'
                : bannerSeverity === 'warn'
                  ? 'bg-warn/10 text-warn'
                  : bannerSeverity === 'info'
                    ? 'bg-info/10 text-info'
                    : 'bg-surface-overlay text-fg-muted'
          }
        >
          {!stats.hasAnyProject
            ? 'START'
            : !stats.hasIngest
              ? 'WAITING'
              : stats.critical14d > 0 && stats.newUntriaged > 0
                ? `${stats.critical14d} CRIT`
                : stats.newUntriaged > 0
                  ? `${stats.newUntriaged} NEW`
                  : stats.openBacklog > 0
                    ? `${stats.openBacklog} STALE`
                    : 'CURRENT'}
        </Badge>
        <FreshnessPill
          at={statsFetchedAt ?? lastFetchedAt}
          isValidating={statsValidating || isValidating}
          channel={channelState}
        />
        {activeTab === 'queue' && (
          <span className="text-xs text-fg-muted font-mono tabular-nums">
            {total} total{total > PAGE_SIZE ? ` · page ${page + 1}/${totalPages}` : ''}
          </span>
        )}
        {!ux.hideKeyboardShortcuts && (
        <Tooltip content="Show keyboard shortcuts (?)">
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="inline-flex items-center gap-1 text-2xs text-fg-faint hover:text-fg-muted px-1.5 py-0.5 rounded-sm border border-edge-subtle"
            aria-label="Show keyboard shortcuts"
          >
            <Kbd>?</Kbd>
          </button>
        </Tooltip>
        )}
        <Btn size="sm" variant="ghost" onClick={reloadAll} loading={statsValidating || isValidating}>
          Refresh
        </Btn>
      </PageHeader>

      {!ux.hideOverviewChrome && <DogfoodNarrativeBanner />}

      <ReportsStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onRefresh={reloadAll}
        refreshing={statsValidating || isValidating}
        plainBanner={ux.plainBanner}
      />

      {!ux.hideTabs && (
      <SegmentedControl
        value={activeTab}
        onChange={setActiveTab}
        options={tabOptions}
        ariaLabel="Reports sections"
        size="sm"
      />
      )}

      {!ux.hideReportsSnapshot && (
      <Section title={copy?.sections?.snapshot ?? 'TRIAGE SNAPSHOT'} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
        <p className="mb-3 text-2xs text-fg-muted">{activeTabMeta.description}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label={copy?.statLabels?.total14d ?? '14d total'}
            value={stats.total14d}
            accent={stats.total14d > 0 ? 'text-fg' : undefined}
            tooltip={total14dTooltip(stats)}
            detail={total14dDetail(stats)}
            to={reportsLinks.total14d}
          />
          <StatCard
            label={copy?.statLabels?.untriaged ?? 'Untriaged'}
            value={stats.newUntriaged}
            accent={stats.newUntriaged > 0 ? 'text-info' : 'text-ok'}
            tooltip={untriagedTooltip(stats)}
            detail={untriagedDetail(stats)}
            to={reportsLinks.untriaged}
          />
          <StatCard
            label={copy?.statLabels?.critical ?? 'Critical 14d'}
            value={stats.critical14d}
            accent={stats.critical14d > 0 ? 'text-danger' : undefined}
            tooltip={critical14dTooltip(stats)}
            detail={critical14dDetail(stats)}
            to={reportsLinks.critical14d}
          />
          <StatCard
            label={copy?.statLabels?.dismissed ?? 'Dismissed 14d'}
            value={stats.dismissed14d}
            accent={stats.dismissed14d > 0 ? 'text-fg-muted' : undefined}
            tooltip={dismissed14dTooltip(stats)}
            detail={dismissed14dDetail()}
            to={reportsLinks.dismissed14d}
          />
        </div>
      </Section>
      )}

      {activeTab === 'overview' && (
        <>
          {!ux.hideOverviewChrome && (
          <>
          <PageHero
            scope="reports"
            title="Reports"
            kicker="Plan"
            decide={{
              label: stats.topPriorityLabel ?? 'Triage queue',
              metric:
                stats.hasIngest
                  ? `${stats.newUntriaged} untriaged · ${stats.critical14d} critical (14d)`
                  : undefined,
              summary:
                stats.topPriority === 'waiting_ingest'
                  ? 'Brand banner means SDK ingest is not live — send a test report from Setup before triaging.'
                  : stats.topPriority === 'critical'
                    ? 'Red banner — critical reports still need confirmation before dispatch.'
                    : stats.topPriority === 'backlog'
                      ? 'Amber banner — some reports waited over an hour without triage.'
                      : 'Green banner — queue is current. Severity tab shows 14-day momentum.',
              severity:
                stats.topPriority === 'critical'
                  ? 'crit'
                  : stats.topPriority === 'backlog' || stats.topPriority === 'waiting_ingest'
                    ? 'info'
                    : stats.topPriority === 'untriaged'
                      ? 'info'
                      : 'ok',
            }}
            verify={{
              label: 'Live ingest',
              detail: stats.lastReportAt
                ? 'Counts reload on report webhooks — Refresh if you just sent a test report.'
                : 'No reports ingested yet — verify SDK heartbeat on Setup.',
            }}
          />

          {stats.topPriorityTo && stats.topPriority !== 'clear' && stats.topPriority !== 'waiting_ingest' ? (
            <Card
              className={`p-4 ${
                stats.topPriority === 'critical'
                  ? 'border-danger/30 bg-danger/5'
                  : stats.topPriority === 'backlog'
                    ? 'border-warn/30 bg-warn/5'
                    : 'border-info/30 bg-info/5'
              }`}
            >
              <p className="text-3xs font-semibold uppercase tracking-wider text-fg-muted">Top priority</p>
              <p className="mt-1 text-sm font-medium text-fg">{stats.topPriorityLabel}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to={stats.topPriorityTo}>
                  <Btn size="sm" variant="primary">
                    Open queue →
                  </Btn>
                </Link>
                <Btn size="sm" variant="ghost" onClick={() => setActiveTab('severity')}>
                  Severity trends
                </Btn>
              </div>
            </Card>
          ) : null}
          </>
          )}

          {recommendation && (
            <RecommendedAction
              title={recommendation.title}
              description={recommendation.description}
              cta={recommendation.cta}
              tone={recommendation.tone}
            />
          )}

          <div className="flex flex-wrap gap-2">
            <Btn size="sm" variant="primary" onClick={() => setActiveTab('queue')}>
              Open triage queue →
            </Btn>
            {!stats.hasIngest ? (
              <Link to="/onboarding?tab=verify">
                <Btn size="sm" variant="ghost">
                  Send test report
                </Btn>
              </Link>
            ) : null}
          </div>
        </>
      )}

      {activeTab === 'queue' && queuePanel}

      {activeTab === 'severity' && (
        <>
          <ReportsKpiStrip activeSeverity={severity} onFilter={handleSeverityFilter} />
          <Card className="border-brand/20 bg-brand/5 p-4">
            <p className="text-sm font-medium text-fg">Click a severity tile to filter the queue</p>
            <p className="mt-1 text-2xs text-fg-muted">
              Sparklines show 14-day momentum. Critical + high tiles turn red/amber when counts are non-zero.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn size="sm" variant="primary" onClick={() => setActiveTab('queue')}>
                Open queue →
              </Btn>
              {stats.critical14d > 0 ? (
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const next = new URLSearchParams(searchParams)
                    next.set('status', 'new')
                    next.set('severity', 'critical')
                    next.delete('page')
                    next.delete('tab')
                    setSearchParams(next)
                  }}
                >
                  Critical untriaged
                </Btn>
              ) : null}
            </div>
          </Card>
        </>
      )}

      <ReportPreviewDrawer
        previewId={searchParams.get('preview')}
        onClose={() => {
          const next = new URLSearchParams(searchParams)
          next.delete('preview')
          setSearchParams(next)
        }}
      />

      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  )
}
