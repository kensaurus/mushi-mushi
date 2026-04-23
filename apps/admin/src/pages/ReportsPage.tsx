import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { BulkBar } from '../components/reports/BulkBar'
import { usePageCopy } from '../lib/copy'
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

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const undoable = useUndoableBulk()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const copy = usePageCopy('/reports')

  const status = searchParams.get('status') ?? ''
  const category = searchParams.get('category') ?? ''
  const severity = searchParams.get('severity') ?? ''
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
    if (component) p.set('component', component)
    if (reporter) p.set('reporter', reporter)
    if (q) p.set('q', q)
    p.set('sort', sort)
    p.set('dir', dir)
    p.set('limit', String(PAGE_SIZE))
    p.set('offset', String(page * PAGE_SIZE))
    return p.toString()
  }, [status, category, severity, component, reporter, q, sort, dir, page])

  const { data, loading, error, isValidating, lastFetchedAt, reload } = usePageData<{ reports: ReportRow[]; total: number }>(
    `/v1/admin/reports?${queryString}`,
    { deps: [queryString] },
  )

  const reports = data?.reports ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState(0)

  // Wave T.3.6: stage realtime INSERTs on `reports` when the triager is
  // mid-review (has selection / cursor below top / scrolled down). Auto-
  // apply when the triager is clearly idle at the top. `fix_attempts` is
  // a separate, eager reload because those updates touch rows the user
  // is already looking at — there's no scroll-position cost to applying
  // them.
  const reportsStaged = useStagedRealtime({
    tables: ['reports'],
    onApply: reload,
    shouldAutoApply: () =>
      selected.size === 0 &&
      cursor === 0 &&
      (typeof window === 'undefined' || window.scrollY < 10),
  })
  const { channelState: fixChannelState } = useRealtimeReload(['fix_attempts'], reload)
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
      { key: 'j', description: 'Next report', handler: () => moveCursor(1) },
      { key: 'k', description: 'Previous report', handler: () => moveCursor(-1) },
      {
        key: 'x',
        description: 'Toggle selection',
        handler: () => {
          const r = reports[cursor]
          if (r) toggleSelect(r.id)
        },
      },
      { key: 'Enter', description: 'Open report', handler: openCursor },
      {
        key: ' ',
        description: 'Preview report (keeps list scroll)',
        handler: (e) => {
          e.preventDefault()
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
          ;(document.activeElement as HTMLElement | null)?.blur?.()
        },
      },
      {
        key: '/',
        description: 'Focus search',
        handler: (e) => {
          e.preventDefault()
          searchInputRef.current?.focus()
        },
      },
      { key: '?', description: 'Show shortcuts', handler: () => setShowHelp((v) => !v) },
      { key: 'a', description: 'Select all on page', handler: toggleSelectAll },
      {
        key: ']',
        description: 'Next page',
        handler: () => {
          if (page < totalPages - 1) setPage(page + 1)
        },
      },
      {
        key: '[',
        description: 'Previous page',
        handler: () => {
          if (page > 0) setPage(page - 1)
        },
      },
    ],
    !loading,
  )

  const contextChips: ContextChip[] = []
  if (component) contextChips.push({ key: 'component', label: 'Component', value: component })
  if (reporter)
    contextChips.push({ key: 'reporter', label: 'Reporter', value: `${reporter.slice(0, 12)}…` })

  const hasFilters = Boolean(status || category || severity || component || reporter || q)
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
      const url = `${window.location.origin}/reports/${r.id}`
      navigator.clipboard.writeText(url).then(
        () => toast.success('Link copied'),
        () => toast.error('Could not copy link'),
      )
    },
    [toast],
  )

  const handleDismiss = useCallback(
    async (r: ReportRow) => {
      const res = await apiFetch(`/v1/admin/reports/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'dismissed' }),
      })
      if (res.ok) {
        toast.success('Report dismissed')
        reload()
      } else {
        toast.error('Dismiss failed', res.error?.message)
      }
    },
    [toast, reload],
  )

  const handleDispatchFix = useCallback(
    async (r: ReportRow) => {
      // Inline dispatch — fire-and-forget POST and immediately link the user
      // to /fixes for the dispatch monitor. Subscribing to SSE per-row would
      // be wasteful when the user can already babysit one job at a time on
      // the Fixes page; here we just queue the work and confirm it landed.
      setDispatching(prev => new Set(prev).add(r.id))
      const res = await apiFetch<{ dispatchId: string }>(`/v1/admin/fixes/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ reportId: r.id, projectId: r.project_id }),
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
      toast.success('Fix dispatched', 'Track progress on the Fixes page')
      reload()
    },
    [toast, reload],
  )

  return (
    <div>
      <PageHeader
        title={copy?.title ?? 'Reports'}
        projectScope={projectName}
        description={copy?.description ?? 'User-felt friction reports awaiting triage. Sort by severity, dispatch fixes, or dismiss noise.'}
      >
        <FreshnessPill at={lastFetchedAt} isValidating={isValidating} channel={channelState} />
        <span className="text-xs text-fg-muted font-mono tabular-nums">
          {total} total{total > PAGE_SIZE ? ` · page ${page + 1}/${totalPages}` : ''}
        </span>
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
      </PageHeader>

      <DogfoodNarrativeBanner />

      <PageHelp
        title={copy?.help?.title ?? 'About Reports'}
        whatIsIt={copy?.help?.whatIsIt ?? 'The triage inbox for every bug report submitted via the SDK. The LLM pipeline auto-classifies category, severity, component, and confidence — you confirm or override and dispatch fixes.'}
        useCases={copy?.help?.useCases ?? [
          'Triage incoming reports — sort by severity, filter by status',
          'Bulk-dismiss noise or escalate a batch of regressions in one click',
          'Drill into a single report for the original payload, screenshots, and pipeline timeline',
        ]}
        howToUse={copy?.help?.howToUse ?? 'Use j/k to move, x to select, Enter to open, / to search, ? for the full cheat sheet. Click a column header to sort. Select rows to reveal bulk actions.'}
      />

      <ReportsKpiStrip
        activeSeverity={severity}
        onFilter={(sev) => setFilter('severity', sev)}
      />

      {recommendation && (
        <RecommendedAction
          title={recommendation.title}
          description={recommendation.description}
          cta={recommendation.cta}
          tone={recommendation.tone}
        />
      )}

      <ReportsQuickFilters status={status} severity={severity} onSetFilter={setFilter} />

      <SavedViewsRow
        scope="reports"
        currentQuery={searchParams.toString()}
        onApply={(q) => {
          const next = new URLSearchParams(q)
          setSearchParams(next)
          setSearchInput(next.get('q') ?? '')
        }}
      />

      <ReportsFilterBar
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        searchInputRef={searchInputRef}
        status={status}
        category={category}
        severity={severity}
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
        <ErrorAlert message={`Failed to load reports: ${error}`} onRetry={reload} />
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
        // RecommendedAction above already shows "No reports yet" — don't
        // double-paint a contradictory empty state. .
        null
      ) : (
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
        />
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
