import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import { apiFetch } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useHotkeys } from '../lib/useHotkeys'
import { SEVERITY, STATUS, FILTER_OPTIONS, statusLabel, severityLabel } from '../lib/tokens'
import {
  PageHeader,
  PageHelp,
  Badge,
  FilterSelect,
  EmptyState,
  Loading,
  ErrorAlert,
  RecommendedAction,
  Btn,
  Tooltip,
  Kbd,
} from '../components/ui'

interface ReportRow {
  id: string
  project_id: string
  description: string
  category: string
  severity: string | null
  summary: string | null
  status: string
  created_at: string
  user_category: string
  confidence: number | null
  component: string | null
}

type SortField = 'created_at' | 'severity' | 'confidence' | 'status' | 'component'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 50

function severityLabelShort(s: string | null): string {
  if (!s) return '—'
  return severityLabel(s)
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  const sec = Math.round(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()

  const status = searchParams.get('status') ?? ''
  const category = searchParams.get('category') ?? ''
  const severity = searchParams.get('severity') ?? ''
  const component = searchParams.get('component') ?? ''
  const reporter = searchParams.get('reporter') ?? ''
  const sort = (searchParams.get('sort') as SortField | null) ?? 'created_at'
  const dir = (searchParams.get('dir') as SortDir | null) ?? 'desc'
  const page = Math.max(0, Number(searchParams.get('page') ?? '0') || 0)
  const q = searchParams.get('q') ?? ''

  const [searchInput, setSearchInput] = useState(q)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  // Debounce the URL update so typing doesn't re-fire fetches per keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchInput === q) return
      const next = new URLSearchParams(searchParams)
      if (searchInput) next.set('q', searchInput); else next.delete('q')
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

  const { data, loading, error, reload } = usePageData<{ reports: ReportRow[]; total: number }>(
    `/v1/admin/reports?${queryString}`,
    { deps: [queryString] },
  )

  const reports = data?.reports ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState(0)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  // Reset selection + cursor whenever the visible page changes.
  useEffect(() => {
    setSelected(new Set())
    setCursor(0)
  }, [queryString])

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
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

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value); else next.delete(key)
    next.delete('page')
    setSearchParams(next)
  }

  const setSort = (field: SortField) => {
    const next = new URLSearchParams(searchParams)
    if (field === sort) {
      next.set('dir', dir === 'asc' ? 'desc' : 'asc')
    } else {
      next.set('sort', field)
      next.set('dir', field === 'created_at' ? 'desc' : 'desc')
    }
    next.delete('page')
    setSearchParams(next)
  }

  const setPage = (p: number) => {
    const next = new URLSearchParams(searchParams)
    if (p === 0) next.delete('page'); else next.set('page', String(p))
    setSearchParams(next)
  }

  const runBulk = async (action: 'set_status' | 'set_severity' | 'dismiss', value?: string) => {
    if (selected.size === 0) return
    setBulkBusy(true)
    const ids = [...selected]
    const res = await apiFetch<{ updated: number }>(`/v1/admin/reports/bulk`, {
      method: 'POST',
      body: JSON.stringify({ ids, action, value }),
    })
    setBulkBusy(false)
    if (!res.ok) {
      toast.error('Bulk action failed', res.error?.message ?? 'Unknown error')
      return
    }
    const verb =
      action === 'dismiss' ? 'Dismissed'
        : action === 'set_status' ? `Status → ${value}`
          : `Severity → ${value}`
    toast.success(`${verb}`, `${res.data?.updated ?? ids.length} report${ids.length === 1 ? '' : 's'} updated`)
    clearSelection()
    reload()
  }

  const openCursor = useCallback(() => {
    const r = reports[cursor]
    if (r) navigate(`/reports/${r.id}`)
  }, [cursor, reports, navigate])

  const moveCursor = useCallback((delta: number) => {
    setCursor((c) => {
      const next = Math.max(0, Math.min(reports.length - 1, c + delta))
      // Scroll the focused row into view if it falls off-screen.
      requestAnimationFrame(() => {
        document.querySelector(`[data-row-index="${next}"]`)?.scrollIntoView({ block: 'nearest' })
      })
      return next
    })
  }, [reports.length])

  useHotkeys(
    [
      { key: 'j', description: 'Next report', handler: () => moveCursor(1) },
      { key: 'k', description: 'Previous report', handler: () => moveCursor(-1) },
      { key: 'x', description: 'Toggle selection', handler: () => { const r = reports[cursor]; if (r) toggleSelect(r.id) } },
      { key: 'Enter', description: 'Open report', handler: openCursor },
      { key: 'Escape', description: 'Clear selection / close help', allowInInputs: true, handler: () => { setShowHelp(false); clearSelection(); (document.activeElement as HTMLElement | null)?.blur?.() } },
      { key: '/', description: 'Focus search', handler: (e) => { e.preventDefault(); searchInputRef.current?.focus() } },
      { key: '?', description: 'Show shortcuts', handler: () => setShowHelp((v) => !v) },
      { key: 'a', description: 'Select all on page', handler: toggleSelectAll },
      { key: ']', description: 'Next page', handler: () => { if (page < totalPages - 1) setPage(page + 1) } },
      { key: '[', description: 'Previous page', handler: () => { if (page > 0) setPage(page - 1) } },
    ],
    !loading,
  )

  const contextChips: Array<{ key: string; label: string; value: string }> = []
  if (component) contextChips.push({ key: 'component', label: 'Component', value: component })
  if (reporter) contextChips.push({ key: 'reporter', label: 'Reporter', value: `${reporter.slice(0, 12)}…` })

  const hasFilters = Boolean(status || category || severity || component || reporter || q)
  const queuedCount = reports.filter((r) => r.status === 'queued' || r.status === 'new').length
  const criticalQueuedCount = reports.filter((r) => (r.status === 'queued' || r.status === 'new') && r.severity === 'critical').length

  const recommendation = (() => {
    if (loading || error) return null
    if (total === 0 && !hasFilters) {
      return {
        title: 'No reports yet',
        description: 'Install the SDK in your app and trigger a test report to see the pipeline come alive.',
        cta: { label: 'Open setup wizard', to: '/onboarding' },
        tone: 'info' as const,
      }
    }
    if (criticalQueuedCount > 0) {
      return {
        title: `${criticalQueuedCount} critical ${criticalQueuedCount === 1 ? 'report' : 'reports'} need triage`,
        description: 'High-severity reports are still pending. Open them to confirm classification and dispatch a fix.',
        cta: {
          label: 'Show critical untriaged',
          onClick: () => {
            const next = new URLSearchParams(searchParams)
            next.set('status', 'new'); next.set('severity', 'critical'); next.delete('page')
            setSearchParams(next)
          },
        },
        tone: 'urgent' as const,
      }
    }
    if (queuedCount > 0 && !status) {
      return {
        title: `${queuedCount} ${queuedCount === 1 ? 'report is' : 'reports are'} waiting for triage`,
        description: 'Filter to the new bucket to confirm classification and decide who fixes them.',
        cta: { label: 'Filter to untriaged', onClick: () => setFilter('status', 'new') },
        tone: 'info' as const,
      }
    }
    return null
  })()

  return (
    <div>
      <PageHeader title="Reports">
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

      <PageHelp
        title="About Reports"
        whatIsIt="The triage inbox for every bug report submitted via the SDK. The LLM pipeline auto-classifies category, severity, component, and confidence — you confirm or override and dispatch fixes."
        useCases={[
          'Triage incoming reports — sort by severity, filter by status',
          'Bulk-dismiss noise or escalate a batch of regressions in one click',
          'Drill into a single report for the original payload, screenshots, and pipeline timeline',
        ]}
        howToUse="Use j/k to move, x to select, Enter to open, / to search, ? for the full cheat sheet. Click a column header to sort. Select rows to reveal bulk actions."
      />

      {recommendation && (
        <RecommendedAction
          title={recommendation.title}
          description={recommendation.description}
          cta={recommendation.cta}
          tone={recommendation.tone}
        />
      )}

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search summary or description… (/)"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label="Search reports"
          className="w-64 bg-surface-raised border border-edge-subtle rounded-sm px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand/40"
        />
        <FilterSelect label="Status" value={status} options={FILTER_OPTIONS.statuses} onChange={(e) => setFilter('status', e.currentTarget.value)} />
        <FilterSelect label="Category" value={category} options={FILTER_OPTIONS.categories} onChange={(e) => setFilter('category', e.currentTarget.value)} />
        <FilterSelect label="Severity" value={severity} options={FILTER_OPTIONS.severities} onChange={(e) => setFilter('severity', e.currentTarget.value)} />
        {contextChips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilter(chip.key, '')}
            className="inline-flex items-center gap-1.5 rounded-sm border border-accent/30 bg-accent-muted/30 px-2 py-1 text-2xs text-accent hover:bg-accent-muted/50 motion-safe:transition-colors"
            title={`Clear ${chip.label} filter`}
          >
            <span className="font-medium">{chip.label}:</span>
            <span className="font-mono">{chip.value}</span>
            <span aria-hidden="true" className="text-fg-faint">×</span>
          </button>
        ))}
        {hasFilters && (
          <button
            type="button"
            onClick={() => { setSearchInput(''); setSearchParams({}) }}
            className="text-2xs text-fg-faint hover:text-fg-muted underline"
          >
            Clear all
          </button>
        )}
      </div>

      <BulkBar
        count={selected.size}
        busy={bulkBusy}
        onClear={clearSelection}
        onSetStatus={(v) => runBulk('set_status', v)}
        onSetSeverity={(v) => runBulk('set_severity', v)}
        onDismiss={() => runBulk('dismiss')}
      />

      {loading ? (
        <Loading text="Loading reports..." />
      ) : error ? (
        <ErrorAlert message={`Failed to load reports: ${error}`} onRetry={reload} />
      ) : reports.length === 0 ? (
        <EmptyState title="No reports match the selected filters." />
      ) : (
        <div className="border border-edge-subtle rounded-md overflow-hidden bg-surface-raised/30">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Bug reports">
              <thead className="bg-surface-raised text-2xs uppercase tracking-wider text-fg-faint sticky top-0 z-10">
                <tr>
                  <th scope="col" className="w-8 px-2 py-2 text-left">
                    <input
                      type="checkbox"
                      aria-label={allSelected ? 'Deselect all on page' : 'Select all on page'}
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected }}
                      onChange={toggleSelectAll}
                      className="h-3.5 w-3.5 accent-brand"
                    />
                  </th>
                  <SortHeader label="Summary" field="component" current={sort} dir={dir} onSort={setSort} className="text-left" />
                  <SortHeader label="Status" field="status" current={sort} dir={dir} onSort={setSort} className="text-left w-28" />
                  <SortHeader label="Severity" field="severity" current={sort} dir={dir} onSort={setSort} className="text-left w-24" />
                  <SortHeader label="Conf." field="confidence" current={sort} dir={dir} onSort={setSort} className="text-right w-16" />
                  <SortHeader label="Created" field="created_at" current={sort} dir={dir} onSort={setSort} className="text-right w-24" />
                  <th scope="col" className="w-28 px-2 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r, i) => (
                  <ReportRowView
                    key={r.id}
                    row={r}
                    index={i}
                    isSelected={selected.has(r.id)}
                    isCursor={i === cursor}
                    onToggleSelect={() => toggleSelect(r.id)}
                    onFocus={() => setCursor(i)}
                    onCopyLink={() => {
                      const url = `${window.location.origin}/reports/${r.id}`
                      navigator.clipboard.writeText(url).then(
                        () => toast.success('Link copied'),
                        () => toast.error('Could not copy link'),
                      )
                    }}
                    onDismiss={async () => {
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
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-edge-subtle text-2xs text-fg-muted">
            <span>
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <Btn variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                <Kbd>[</Kbd> Prev
              </Btn>
              <span className="font-mono px-2">
                {page + 1} / {totalPages}
              </span>
              <Btn variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
                Next <Kbd>]</Kbd>
              </Btn>
            </div>
          </div>
        </div>
      )}

      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  )
}

interface SortHeaderProps {
  label: string
  field: SortField
  current: SortField
  dir: SortDir
  onSort: (f: SortField) => void
  className?: string
}

function SortHeader({ label, field, current, dir, onSort, className = '' }: SortHeaderProps) {
  const active = current === field
  const arrow = !active ? '' : dir === 'asc' ? '↑' : '↓'
  return (
    <th scope="col" className={`px-2 py-2 font-medium ${className}`}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:text-fg ${active ? 'text-fg' : 'text-fg-faint'}`}
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        {arrow && <span className="text-3xs font-mono">{arrow}</span>}
      </button>
    </th>
  )
}

interface ReportRowViewProps {
  row: ReportRow
  index: number
  isSelected: boolean
  isCursor: boolean
  onToggleSelect: () => void
  onFocus: () => void
  onCopyLink: () => void
  onDismiss: () => void
}

function ReportRowView({
  row, index, isSelected, isCursor, onToggleSelect, onFocus, onCopyLink, onDismiss,
}: ReportRowViewProps) {
  const navigate = useNavigate()
  const summary = row.summary ?? row.description
  const conf = row.confidence != null ? Math.round(row.confidence * 100) : null
  const baseRowCls = 'group border-t border-edge-subtle hover:bg-surface-overlay/60 motion-safe:transition-colors cursor-pointer'
  const cursorCls = isCursor ? 'bg-surface-overlay/40 outline outline-1 outline-brand/40' : ''
  const selectedCls = isSelected ? 'bg-brand/5' : ''
  return (
    <tr
      data-row-index={index}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, input, a')) return
        navigate(`/reports/${row.id}`)
      }}
      onMouseEnter={onFocus}
      className={`${baseRowCls} ${cursorCls} ${selectedCls}`}
    >
      <td className="px-2 py-2 align-top">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          aria-label={isSelected ? 'Deselect report' : 'Select report'}
          className="h-3.5 w-3.5 accent-brand"
        />
      </td>
      <td className="px-2 py-2 min-w-0">
        <div className="text-sm text-fg-secondary line-clamp-2 leading-snug">{summary}</div>
        {row.component && (
          <div className="text-2xs text-fg-faint mt-0.5 font-mono truncate">{row.component}</div>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <Badge className={STATUS[row.status] ?? 'text-fg-muted border border-edge'}>
          {statusLabel(row.status)}
        </Badge>
      </td>
      <td className="px-2 py-2 align-top">
        {row.severity ? (
          <Badge className={SEVERITY[row.severity] ?? ''}>{severityLabelShort(row.severity)}</Badge>
        ) : (
          <span className="text-2xs text-fg-faint">—</span>
        )}
      </td>
      <td className="px-2 py-2 text-right align-top">
        {conf != null ? (
          <span className="text-xs font-mono text-fg-muted">{conf}%</span>
        ) : (
          <span className="text-2xs text-fg-faint">—</span>
        )}
      </td>
      <td className="px-2 py-2 text-right align-top">
        <Tooltip content={new Date(row.created_at).toLocaleString()}>
          <span className="text-2xs text-fg-faint font-mono cursor-help">
            {formatRelative(row.created_at)}
          </span>
        </Tooltip>
      </td>
      <td className="px-2 py-2 text-right align-top">
        <div className="inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 motion-safe:transition-opacity">
          <Tooltip content="Copy share link">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCopyLink() }}
              className="p-1 text-fg-faint hover:text-fg-muted hover:bg-surface-overlay rounded-sm"
              aria-label="Copy link"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 7l4-4M13 7V3h-4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M7 9l-4 4M3 9v4h4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip content="Open in new tab">
            <a
              href={`/reports/${row.id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-1 text-fg-faint hover:text-fg-muted hover:bg-surface-overlay rounded-sm inline-flex"
              aria-label="Open in new tab"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M10 2h4v4M14 2L7 9M11 8v5H3V5h5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </Tooltip>
          <Tooltip content="Dismiss">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDismiss() }}
              className="p-1 text-fg-faint hover:text-danger hover:bg-danger-muted/20 rounded-sm"
              aria-label="Dismiss"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <line x1="4" y1="4" x2="12" y2="12" strokeLinecap="round" />
                <line x1="12" y1="4" x2="4" y2="12" strokeLinecap="round" />
              </svg>
            </button>
          </Tooltip>
        </div>
        <Link
          to={`/reports/${row.id}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-block text-2xs text-fg-muted hover:text-brand ml-1 group-hover:hidden"
        >
          Open →
        </Link>
      </td>
    </tr>
  )
}

interface BulkBarProps {
  count: number
  busy: boolean
  onClear: () => void
  onSetStatus: (v: string) => void
  onSetSeverity: (v: string) => void
  onDismiss: () => void
}

function BulkBar({ count, busy, onClear, onSetStatus, onSetSeverity, onDismiss }: BulkBarProps) {
  if (count === 0) return null
  return (
    <div
      className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-md border border-brand/40 bg-brand/10 px-3 py-2 backdrop-blur"
      role="region"
      aria-label="Bulk actions"
    >
      <span className="text-xs font-medium text-fg">
        {count} selected
      </span>
      <span className="text-2xs text-fg-muted">·</span>
      <BulkSelect label="Set status" disabled={busy} options={['new', 'classified', 'fixing', 'fixed', 'dismissed']} onPick={onSetStatus} />
      <BulkSelect label="Set severity" disabled={busy} options={['critical', 'high', 'medium', 'low']} onPick={onSetSeverity} />
      <Btn size="sm" variant="danger" onClick={onDismiss} disabled={busy}>
        Dismiss
      </Btn>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-2xs text-fg-muted hover:text-fg underline"
      >
        Clear selection (esc)
      </button>
    </div>
  )
}

function BulkSelect({ label, options, disabled, onPick }: { label: string; options: string[]; disabled?: boolean; onPick: (v: string) => void }) {
  return (
    <select
      defaultValue=""
      disabled={disabled}
      onChange={(e) => {
        const v = e.currentTarget.value
        if (!v) return
        onPick(v)
        e.currentTarget.value = ''
      }}
      className="bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1 text-xs text-fg-secondary focus:outline-none focus:ring-1 focus:ring-brand/40"
    >
      <option value="">{label}…</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  )
}

function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-edge rounded-md shadow-raised p-4 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-fg">Keyboard shortcuts</h3>
          <button type="button" onClick={onClose} className="text-fg-faint hover:text-fg text-xs px-1" aria-label="Close">✕</button>
        </div>
        <dl className="space-y-1.5 text-xs">
          <Row k="j / k" desc="Move cursor down / up" />
          <Row k="Enter" desc="Open focused report" />
          <Row k="x" desc="Toggle selection" />
          <Row k="a" desc="Select all on page" />
          <Row k="/" desc="Focus search" />
          <Row k="[ / ]" desc="Previous / next page" />
          <Row k="Esc" desc="Clear selection / close" />
          <Row k="?" desc="Toggle this help" />
        </dl>
      </div>
    </div>
  )
}

function Row({ k, desc }: { k: string; desc: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-fg-muted">{desc}</span>
      <span className="font-mono text-2xs text-fg">{k}</span>
    </div>
  )
}
