/**
 * FILE: apps/admin/src/pages/AuditPage.tsx
 * PURPOSE: Append-only audit console — URL tabs, health banner, KPI strip,
 *          filterable log table, and actor/action breakdown.
 */

import { useCallback, useMemo, useState } from 'react'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { Link, useSearchParams } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import { usePageCopy } from '../lib/copy'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { NextStep } from '../components/NextStep'
import { AuditStatusBanner, isAuditStatusBannerCritical } from '../components/audit/AuditStatusBanner'
import { AuditSnapshotStrip } from '../components/audit/AuditSnapshotStrip'
import { AuditReadout } from '../components/audit/AuditReadout'
import {
  EMPTY_AUDIT_STATS,
  parseAuditOutcome,
  topActionLabel,
  type AuditOutcome,
  type AuditStats,
  type AuditTabId,
} from '../components/audit/types'
import { PageLoadError } from '../components/PageLoadError'
import { agentActorsDetail, humanActorsDetail, systemActorsDetail } from '../lib/statTooltips/audit'
import { auditLinks } from '../lib/statCardLinks'
import { useToast } from '../lib/toast'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { PageHeaderBar } from '../components/PageHeaderBar'
import {
  Card,
  Badge,
  Btn,
  Input,
  SelectField,
  EmptyState,
  LogBlock,
  CodeValue,
  SegmentedControl,
} from '../components/ui'
import {
  ActionPill,
  ActionPillRow,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import { ActiveFiltersRail, type ActiveFilter } from '../components/ActiveFiltersRail'
import { DataTable, type ColumnDef } from '../components/DataTable'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { HeroSearch } from '../components/illustrations/HeroIllustrations'
import { CHIP_TONE } from '../lib/chipTone'
import { BarCell } from '../components/signal/BarCell'
import {
  AUDIT_OVERVIEW_ROWS,
  auditActorLabel,
  auditCountTone,
  auditPagerVisible,
  groupAuditRuns,
  type AuditGroup,
} from '../lib/auditView'

interface AuditEntry {
  id: string
  project_id: string
  actor_id: string | null
  actor_email: string | null
  /** Member name / email the server looked up from actor_id (display only). */
  actor_name?: string | null
  actor_display_email?: string | null
  action: string
  resource_type: string
  resource_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface AuditResponse {
  logs: AuditEntry[]
  count: number
}

const ACTION_OPTIONS = [
  '',
  'report.created',
  'report.classified',
  'report.triaged',
  'report.dismissed',
  'fix.dispatched',
  'fix.applied',
  'fix.failed',
  'settings.updated',
  'integration.connected',
  'integration.disconnected',
  'compliance.dsar.filed',
  'compliance.dsar.fulfilled',
  'project.created',
  'project.deleted',
  'api_key.minted',
  'api_key.revoked',
  'plugin.installed',
  'plugin.uninstalled',
]

const RESOURCE_OPTIONS = [
  '',
  'report',
  'fix',
  'settings',
  'integration',
  'project',
  'api_key',
  'plugin',
  'dsar',
  'fine_tuning',
  'prompt',
]

const SINCE_OPTIONS = [
  { value: '', label: 'All time' },
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
]

const ACTOR_TYPE_OPTIONS = [
  { value: '', label: 'Any actor' },
  { value: 'human', label: 'Human' },
  { value: 'agent', label: 'Agent (LLM)' },
  { value: 'system', label: 'System (cron / webhook)' },
]

const AUDIT_TABS: Array<{ id: AuditTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Posture summary, KPI snapshot strip, and the live event log.',
  },
  {
    id: 'log',
    label: 'Log',
    description: 'Filter by action, actor, resource, or time — expand rows for metadata JSON.',
  },
  {
    id: 'breakdown',
    label: 'Breakdown',
    description: '24h actor mix and 7-day top actions across your owned projects.',
  },
]

const PAGE_SIZE = 50

function isAuditTab(value: string | null): value is AuditTabId {
  return AUDIT_TABS.some((t) => t.id === value)
}

function sinceToIso(since: string): string | null {
  if (!since) return null
  const now = Date.now()
  const map: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  }
  const ms = map[since]
  if (!ms) return null
  return new Date(now - ms).toISOString()
}

/**
 * Red only for a failure, amber only for the warning actions (revoked keys,
 * removed plugins, disconnected integrations); every other action is a
 * neutral record, not a status (round-2 review 2026-11-18).
 */
function actionTone(action: string): string {
  if (action.endsWith('.failed')) return CHIP_TONE.dangerSubtle
  if (
    action.endsWith('.deleted') ||
    action.endsWith('.revoked') ||
    action.endsWith('.uninstalled') ||
    action.endsWith('.disconnected')
  ) {
    return CHIP_TONE.warnSubtle
  }
  return 'bg-surface-overlay text-fg-secondary'
}

function auditResourceLabel(e: AuditEntry): string {
  return `${e.resource_type}${e.resource_id ? `:${e.resource_id.slice(0, 8)}` : ''}`
}

function isExpandable(g: AuditGroup<AuditEntry>): boolean {
  return g.entries.length > 1 || Boolean(g.first.metadata && Object.keys(g.first.metadata).length > 0)
}

/** Newest time; a run of several shows its span ("10/30 11:33 AM – 4:09 PM"). */
function AuditGroupTime({ group }: { group: AuditGroup<AuditEntry> }) {
  const newest = new Date(group.first.created_at)
  const oldest = new Date(group.entries[group.entries.length - 1].created_at)
  const text =
    group.entries.length > 1 && newest.toDateString() === oldest.toDateString()
      ? `${newest.toLocaleDateString()} ${oldest.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${newest.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : group.entries.length > 1
        ? `${oldest.toLocaleDateString()} – ${newest.toLocaleDateString()}`
        : newest.toLocaleString()
  return (
    <time dateTime={group.first.created_at} className="text-2xs text-fg-muted tabular-nums whitespace-nowrap">
      {text}
    </time>
  )
}

function AuditGroupAction({ group }: { group: AuditGroup<AuditEntry> }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Badge className={`${actionTone(group.first.action)} font-mono`}>{group.first.action}</Badge>
      {group.entries.length > 1 ? (
        <span className="text-2xs font-semibold text-fg-secondary tabular-nums" title={`${group.entries.length} identical changes in a row`}>
          ×{group.entries.length}
        </span>
      ) : null}
    </span>
  )
}

/** Each change in the run, newest first, with its metadata. */
function AuditGroupDetail({ group }: { group: AuditGroup<AuditEntry> }) {
  return (
    <div className="space-y-2">
      {group.entries.map((entry) => (
        <div key={entry.id} className="space-y-1">
          {group.entries.length > 1 ? (
            <div className="text-2xs text-fg-muted tabular-nums">{new Date(entry.created_at).toLocaleString()}</div>
          ) : null}
          {entry.metadata && Object.keys(entry.metadata).length > 0 ? (
            <LogBlock value={JSON.stringify(entry.metadata, null, 2)} label="Metadata" />
          ) : null}
        </div>
      ))}
      {group.first.resource_id ? (
        <div className="space-y-1">
          <div className="text-2xs text-fg-muted">Full resource ID</div>
          <CodeValue value={group.first.resource_id} tone="id" />
        </div>
      ) : null}
    </div>
  )
}

export function AuditPage() {
  const copy = usePageCopy('/audit')
  const activeProjectId = useActiveProjectId()
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()

  const tabParam = searchParams.get('tab')
  const activeTab: AuditTabId = isAuditTab(tabParam) ? tabParam : 'overview'
  const activeTabMeta = AUDIT_TABS.find((t) => t.id === activeTab) ?? AUDIT_TABS[0]

  const statsPath = activeProjectId ? '/v1/admin/audit/stats' : null
  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    errorCode: statsErrorCode,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<AuditStats>(statsPath)
  const stats = statsData ?? EMPTY_AUDIT_STATS

  const action = searchParams.get('action') ?? ''
  const resourceType = searchParams.get('resource_type') ?? ''
  const actor = searchParams.get('actor') ?? ''
  const actorType = searchParams.get('actor_type') ?? ''
  const outcome = parseAuditOutcome(searchParams.get('outcome'))
  const since = searchParams.get('since') ?? ''
  const q = searchParams.get('q') ?? ''
  const page = Math.max(Number(searchParams.get('page') ?? '1'), 1)
  const offset = (page - 1) * PAGE_SIZE

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    if (action) params.set('action', action)
    if (resourceType) params.set('resource_type', resourceType)
    if (actor) params.set('actor', actor)
    if (actorType) params.set('actor_type', actorType)
    if (outcome) params.set('outcome', outcome)
    const sinceIso = sinceToIso(since)
    if (sinceIso) params.set('since', sinceIso)
    if (q) params.set('q', q)
    params.set('limit', String(PAGE_SIZE))
    params.set('offset', String(offset))
    return params.toString()
  }, [action, resourceType, actor, actorType, outcome, since, q, offset])

  const {
    data,
    loading,
    error,
    errorCode,
    isValidating,
    lastFetchedAt,
    reload: reloadLogs,
  } = usePageData<AuditResponse>(activeProjectId ? `/v1/admin/audit?${queryString}` : null, {
    deps: [queryString, activeProjectId],
  })

  const reloadAll = useCallback(() => {
    reloadStats()
    reloadLogs()
  }, [reloadStats, reloadLogs])

  useRealtimeReload(['audit_logs'], reloadAll)

  const setActiveTab = useCallback(
    (id: AuditTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  const applyPreset = useCallback(
    (preset: { action?: string; outcome?: AuditOutcome; since?: string; tab?: AuditTabId; actor_type?: string }) => {
      const next = new URLSearchParams(searchParams)
      if (preset.tab) next.set('tab', preset.tab)
      else next.delete('tab')
      if (preset.action) next.set('action', preset.action)
      else next.delete('action')
      if (preset.since) next.set('since', preset.since)
      else next.delete('since')
      if (preset.actor_type) next.set('actor_type', preset.actor_type)
      else next.delete('actor_type')
      if (preset.outcome) next.set('outcome', preset.outcome)
      else next.delete('outcome')
      next.delete('page')
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const logs = data?.logs ?? []
  const total = data?.count ?? 0
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  // Consecutive identical rows collapse into one ("settings.updated ×4").
  const groups = useMemo(() => groupAuditRuns(logs), [logs])
  const [expanded, setExpanded] = useState<string | null>(null)
  // Phone: the six filters sit behind one "Filter" button (they took ~360px).
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [searchDraft, setSearchDraft] = useState(q)
  const [actorDraft, setActorDraft] = useState(actor)

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setSearchParams(next, { replace: true })
  }

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams)
    for (const key of ['action', 'resource_type', 'actor', 'actor_type', 'outcome', 'since', 'q', 'page']) {
      next.delete(key)
    }
    setSearchParams(next, { replace: true })
    setSearchDraft('')
    setActorDraft('')
  }

  const exportCsv = () => {
    if (logs.length === 0) {
      toast.warn('Nothing to export', 'No audit entries match the current filters.')
      return
    }
    const headers = ['Time', 'Action', 'Actor', 'Resource', 'Resource ID', 'Metadata']
    const rows = logs.map((l) => [
      l.created_at,
      l.action,
      l.actor_email ?? l.actor_id ?? 'system',
      l.resource_type,
      l.resource_id ?? '',
      JSON.stringify(l.metadata ?? {}),
    ])
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
    const csv = [headers, ...rows].map((r) => r.map((c) => escape(String(c))).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    toast.success(`Exported ${logs.length} entries`)
  }

  const activeFilterCount = [action, resourceType, actor, actorType, outcome, since, q].filter(Boolean).length

  const columns = useMemo<ColumnDef<AuditGroup<AuditEntry>, unknown>[]>(
    () => [
      {
        id: 'time',
        header: 'Time',
        accessorFn: (g) => g.first.created_at,
        enableSorting: true,
        cell: ({ row }) => <AuditGroupTime group={row.original} />,
      },
      {
        id: 'action',
        header: 'Action',
        enableSorting: true,
        accessorFn: (g) => g.first.action,
        cell: ({ row }) => <AuditGroupAction group={row.original} />,
      },
      {
        id: 'actor',
        header: 'Actor',
        enableSorting: true,
        accessorFn: (g) => auditActorLabel(g.first),
        // A name or email, never a raw id; the id stays in the tooltip.
        cell: ({ row }) => (
          <span className="truncate text-xs text-fg-muted block max-w-56" title={row.original.first.actor_id ?? undefined}>
            {auditActorLabel(row.original.first)}
          </span>
        ),
      },
      {
        id: 'resource',
        header: 'Resource',
        accessorFn: (g) => `${g.first.resource_type}${g.first.resource_id ? `:${g.first.resource_id}` : ''}`,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="font-mono text-2xs text-fg-secondary whitespace-nowrap">{auditResourceLabel(row.original.first)}</span>
        ),
      },
      {
        id: 'expand',
        header: '',
        enableSorting: false,
        cell: ({ row }) => {
          if (!isExpandable(row.original)) return null
          return (
            <span aria-hidden className="text-2xs text-fg-faint block text-center w-3">
              {expanded === row.original.id ? '▾' : '▸'}
            </span>
          )
        },
      },
    ],
    [expanded],
  )

  const expandedIds = useMemo(() => new Set(expanded ? [expanded] : []), [expanded])

  const failCount = stats.failCount24h

  const criticalCount =
    (stats.auditLogEntitlement ? 0 : 1) + stats.failCount24h + (stats.totalEvents === 0 && stats.auditLogEntitlement ? 0 : 0)

  usePublishPageContext({
    route: '/audit',
    title: `${activeTabMeta.label} · Audit log`,
    summary: loading
      ? 'Loading audit log…'
      : total === 0
        ? 'No events match these filters'
        : `${total} event${total === 1 ? '' : 's'}${failCount > 0 ? ` · ${failCount} failure${failCount === 1 ? '' : 's'}` : ''}`,
    filters: {
      tab: activeTab,
      action: action || 'all',
      resource_type: resourceType || 'all',
      actor: actor || undefined,
      actor_type: actorType || undefined,
      since: since || 'all-time',
      search: q || undefined,
      project_id: activeProjectId ?? undefined,
    },
    criticalCount,
  })

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: 'Overview' },
      {
        id: 'log' as const,
        label: 'Log',
        count: total > 0 ? total : stats.events24h > 0 ? stats.events24h : undefined,
      },
      {
        id: 'breakdown' as const,
        label: 'Breakdown',
        count: stats.failCount24h > 0 ? stats.failCount24h : undefined,
      },
    ],
    [total, stats.events24h, stats.failCount24h],
  )

  const filterPanel = (
    <div className="space-y-2">
    <Btn
      variant="ghost"
      size="sm"
      className="md:hidden"
      aria-expanded={filtersOpen}
      aria-controls="audit-filters"
      onClick={() => setFiltersOpen((v) => !v)}
    >
      {filtersOpen ? 'Hide filters' : activeFilterCount > 0 ? `Filter (${activeFilterCount})` : 'Filter'}
    </Btn>
    <Card id="audit-filters" className={`p-3 space-y-2 ${filtersOpen ? '' : 'hidden md:block'}`}>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-2 items-end" data-dav-anchor="audit:decide">
        <SelectField label="Action" value={action} onChange={(e) => updateParam('action', e.currentTarget.value)}>
          <option value="">All actions</option>
          {ACTION_OPTIONS.filter(Boolean).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Resource"
          value={resourceType}
          onChange={(e) => updateParam('resource_type', e.currentTarget.value)}
        >
          <option value="">All resources</option>
          {RESOURCE_OPTIONS.filter(Boolean).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Actor type"
          value={actorType}
          onChange={(e) => updateParam('actor_type', e.currentTarget.value)}
        >
          {ACTOR_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="When" value={since} onChange={(e) => updateParam('since', e.currentTarget.value)}>
          {SINCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        <Input
          label="Actor email"
          placeholder="ops@example.com"
          value={actorDraft}
          onChange={(e) => setActorDraft(e.target.value)}
          onBlur={() => updateParam('actor', actorDraft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') updateParam('actor', actorDraft)
          }}
        />
        <Input
          label="Search action / resource"
          placeholder="report.classified, fix, ..."
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          onBlur={() => updateParam('q', searchDraft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') updateParam('q', searchDraft)
          }}
        />
      </div>
      {activeFilterCount > 0 && (
        <div className="flex items-start justify-between gap-3 pt-1 border-t border-edge-subtle">
          <ActiveFiltersRail
            filters={(() => {
              const arr: ActiveFilter[] = []
              if (action)
                arr.push({
                  key: 'action',
                  label: 'Action',
                  value: action,
                  onClear: () => updateParam('action', ''),
                  tone: 'info',
                })
              if (outcome)
                arr.push({
                  key: 'outcome',
                  label: 'Outcome',
                  value:
                    outcome === 'failure'
                      ? `Failures (${(stats.failActions ?? []).join(', ') || 'failure actions'})`
                      : `Warnings (${(stats.warnActions ?? []).join(', ') || 'warning actions'})`,
                  onClear: () => updateParam('outcome', ''),
                  tone: outcome === 'failure' ? 'danger' : 'warn',
                })
              if (resourceType)
                arr.push({
                  key: 'resource_type',
                  label: 'Resource',
                  value: resourceType,
                  onClear: () => updateParam('resource_type', ''),
                })
              if (actorType)
                arr.push({
                  key: 'actor_type',
                  label: 'Actor type',
                  value: actorType,
                  onClear: () => updateParam('actor_type', ''),
                })
              if (since)
                arr.push({
                  key: 'since',
                  label: 'Window',
                  value: SINCE_OPTIONS.find((o) => o.value === since)?.label ?? since,
                  onClear: () => updateParam('since', ''),
                })
              if (actor)
                arr.push({
                  key: 'actor',
                  label: 'Actor',
                  value: actor,
                  onClear: () => {
                    setActorDraft('')
                    updateParam('actor', '')
                  },
                })
              if (q)
                arr.push({
                  key: 'q',
                  label: 'Search',
                  value: q,
                  onClear: () => {
                    setSearchDraft('')
                    updateParam('q', '')
                  },
                })
              return arr
            })()}
            onClearAll={clearFilters}
            ariaLabel="Active audit filters"
            className="flex-1"
          />
          <SignalChip tone="neutral">{total.toLocaleString()} matching</SignalChip>
        </div>
      )}
    </Card>
    </div>
  )

  // Overview: the newest few groups only; the Log tab has filters and the pager.
  const overviewOnly = activeTab === 'overview'
  const shownGroups = overviewOnly ? groups.slice(0, AUDIT_OVERVIEW_ROWS) : groups

  const logTable = loading ? (
    <TableSkeleton rows={10} columns={5} showFilters={false} label="Loading audit logs" />
  ) : error ? (
    <PageLoadError error={error} code={errorCode} resource="audit log" onRetry={reloadAll} />
  ) : logs.length === 0 ? (
    <EmptyState
      icon={<HeroSearch accent={activeFilterCount > 0 ? 'text-fg-faint' : 'text-info'} />}
      title={activeFilterCount > 0 ? 'No entries match these filters' : 'No audit entries yet'}
      description={
        activeFilterCount > 0
          ? 'Try widening the time window or clearing filters.'
          : 'Actions like report triage, settings changes, and key management will be logged here as they happen.'
      }
    />
  ) : (
    <>
      <div data-dav-anchor="audit:verify" className="hidden md:block">
        <DataTable<AuditGroup<AuditEntry>>
          data={shownGroups}
          columns={columns}
          getRowId={(g) => g.id}
          density="compact"
          ariaLabel="Audit log entries"
          expandedIds={expandedIds}
          onRowClick={(group) => {
            if (!isExpandable(group)) return
            setExpanded(expanded === group.id ? null : group.id)
          }}
          renderExpanded={(group) => <AuditGroupDetail group={group} />}
        />
      </div>
      {/* Phone: one stacked card per row, so Actor and Resource never hide behind a sideways scroll. */}
      <ul className="space-y-2 md:hidden" aria-label="Audit log entries" data-testid="audit-log-cards">
        {shownGroups.map((group) => {
          const open = expanded === group.id
          return (
            <li key={group.id} className="rounded-md border border-edge-subtle bg-surface-raised px-3 py-2 text-xs">
              <button
                type="button"
                className="flex w-full min-w-0 flex-col items-start gap-1 text-left"
                aria-expanded={isExpandable(group) ? open : undefined}
                onClick={() => {
                  if (isExpandable(group)) setExpanded(open ? null : group.id)
                }}
              >
                <span className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <AuditGroupAction group={group} />
                  <AuditGroupTime group={group} />
                </span>
                <span className="w-full truncate text-fg-muted">{auditActorLabel(group.first)}</span>
                <span className="w-full truncate font-mono text-2xs text-fg-secondary">{auditResourceLabel(group.first)}</span>
              </button>
              {open ? (
                <div className="mt-2">
                  <AuditGroupDetail group={group} />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      {overviewOnly ? (
        groups.length > AUDIT_OVERVIEW_ROWS || total > logs.length ? (
          <div>
            <Btn variant="ghost" size="sm" onClick={() => setActiveTab('log')}>
              Open the full log
            </Btn>
          </div>
        ) : null
      ) : auditPagerVisible(totalPages) ? (
        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <InlineProof>
            Showing {offset + 1}–{Math.min(offset + logs.length, total)} of {total.toLocaleString()}
          </InlineProof>
          <ActionPillRow>
            <ActionPill
              tone="neutral"
              {...(page > 1 ? { onClick: () => updateParam('page', String(page - 1)) } : {})}
              className={page <= 1 ? 'opacity-40' : undefined}
            >
              ← Prev
            </ActionPill>
            <SignalChip tone="neutral">
              Page {page} / {totalPages}
            </SignalChip>
            <ActionPill
              tone="neutral"
              {...(page < totalPages ? { onClick: () => updateParam('page', String(page + 1)) } : {})}
              className={page >= totalPages ? 'opacity-40' : undefined}
            >
              Next →
            </ActionPill>
          </ActionPillRow>
        </div>
      ) : null}
    </>
  )

  if (!activeProjectId) {
    return (
      <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-audit">
        <PageHeaderBar
          title={copy?.title ?? 'Audit log'}

          helpTitle={copy?.help?.title ?? 'About the Audit Log'}
          helpWhatIsIt={
            copy?.help?.whatIsIt ??
            'An append-only history of consequential actions: who did what, to which resource, and when.'
          }
          helpUseCases={
            copy?.help?.useCases ?? [
              'Investigate who changed a setting or rotated an API key',
              'Satisfy SOC 2 / ISO 27001 audit evidence requirements',
              'Detect suspicious activity from API keys or service accounts',
            ]
          }
          helpHowToUse={
            copy?.help?.howToUse ??
            'Stack filters on the Log tab; expand any row for metadata JSON. Export CSV for compliance bundles.'
          }
        />
        <NextStep
          variant="inline"
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="Audit entries are scoped to the active project — pick mushi-mushi (or your app) first."
        />
      </div>
    )
  }

  if (statsLoading && !statsData) {
    return <TableSkeleton rows={6} columns={5} showFilters={false} label="Loading audit console" />
  }
  if (statsError) {
    return <PageLoadError error={statsError} code={statsErrorCode} onRetry={reloadAll} />
  }

  return (
    <div className="space-y-4">
      <PageHeaderBar
        title={copy?.title ?? 'Audit log'}
        projectScope={stats.projectName ?? undefined}

        helpTitle={copy?.help?.title ?? 'About the Audit Log'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'An append-only history of consequential actions: who did what, to which resource, and when.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Investigate who changed a setting or rotated an API key',
            'Satisfy SOC 2 / ISO 27001 audit evidence requirements',
            'Detect suspicious activity from API keys or service accounts',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Stack filters on the Log tab; expand any row for metadata JSON. Export CSV for compliance bundles.'
        }
      >
        {stats.auditLogEntitlement ? (
          <Badge tone="okSubtle">Audit enabled</Badge>
        ) : (
          <Badge tone="warnSubtle">{stats.planDisplayName} — upgrade for audit</Badge>
        )}
        <Btn variant="primary" size="sm" onClick={exportCsv} disabled={logs.length === 0} data-dav-anchor="audit:act">
          Export CSV
        </Btn>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            show: isAuditStatusBannerCritical(stats),
            children: (
              <AuditStatusBanner
                stats={stats}
                onTab={setActiveTab}
                onFilterFailures={() => applyPreset({ tab: 'log', outcome: 'failure', since: '24h' })}
                onFilterWarns={() => applyPreset({ tab: 'log', outcome: 'warning', since: '24h' })}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            children: (
              <AuditSnapshotStrip
                stats={stats}
                statsFetchedAt={statsFetchedAt ?? lastFetchedAt}
                statsValidating={statsValidating || isValidating}
              />
            ),
          },
        ]}
      />

      <SegmentedControl
        value={activeTab}
        onChange={setActiveTab}
        options={tabOptions}
        ariaLabel="Audit sections"
        size="sm"
      />

      {activeTab === 'overview' && (
        <>
          {logTable}
          <AuditReadout
            stats={stats}
            fetchedAt={statsFetchedAt ?? lastFetchedAt}
            isValidating={statsValidating || isValidating}
          />
        </>
      )}

      {activeTab === 'log' && (
        <>
          {filterPanel}
          {logTable}
        </>
      )}

      {activeTab === 'breakdown' && (
        <Card className="p-4 space-y-4">
          {/* 24h, not 7-day: every count below is a *Count24h value. One list
              with bars, not three tiles in a card; a zero row reads dim. */}
          <section className="space-y-2" aria-labelledby="audit-actor-mix">
            <h3 id="audit-actor-mix" className="text-xs font-semibold">Who made changes (24h)</h3>
            <ul className="space-y-1.5">
              {[
                { key: 'human', label: 'People', value: stats.humanCount24h, detail: humanActorsDetail(), to: auditLinks.humanActors },
                { key: 'agent', label: 'Agents', value: stats.agentCount24h, detail: agentActorsDetail(), to: auditLinks.agentActors },
                { key: 'system', label: 'System', value: stats.systemCount24h, detail: systemActorsDetail(), to: auditLinks.systemActors },
              ].map((r) => {
                const max = Math.max(stats.humanCount24h, stats.agentCount24h, stats.systemCount24h)
                return (
                  <li key={r.key} className={`grid grid-cols-[5rem_auto_1fr] items-center gap-3 text-xs ${r.value === 0 ? 'text-fg-faint' : 'text-fg'}`}>
                    <Link to={r.to} className="font-medium underline decoration-edge underline-offset-4 hover:decoration-brand">{r.label}</Link>
                    <BarCell value={r.value} max={max} text={r.value.toLocaleString()} widthClass="w-24" />
                    <span className="min-w-0 truncate text-2xs text-fg-muted">{r.detail}</span>
                  </li>
                )
              })}
            </ul>
          </section>
          <section className="space-y-1.5 border-t border-edge-subtle pt-3" aria-labelledby="audit-top-action">
            <h3 id="audit-top-action" className="text-xs font-semibold">Most frequent action (7d)</h3>
            {stats.topAction7d ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge className={`${actionTone(stats.topAction7d)} font-mono`}>{stats.topAction7d}</Badge>
                <span className="text-fg-muted">{topActionLabel(stats)}</span>
                <ActionPill
                  tone="neutral"
                  onClick={() => applyPreset({ tab: 'log', action: stats.topAction7d ?? '', since: '7d' })}
                >
                  Filter log to this action
                </ActionPill>
              </div>
            ) : (
              <EmptySectionMessage
                text="No 7-day activity"
                hint="Broaden the window on the Log tab or wait for the next mutation."
              />
            )}
          </section>
          <ActionPillRow className="border-t border-edge-subtle pt-3">
            <ActionPill
              tone={auditCountTone('failure', stats.failCount24h)}
              onClick={() => applyPreset({ tab: 'log', since: '24h', outcome: 'failure' })}
            >
              Failures (24h): {stats.failCount24h.toLocaleString()}
            </ActionPill>
            <ActionPill
              tone={auditCountTone('warning', stats.warnCount24h)}
              onClick={() => applyPreset({ tab: 'log', since: '24h', outcome: 'warning' })}
            >
              Warnings (24h): {stats.warnCount24h.toLocaleString()}
            </ActionPill>
            <ActionPill tone="neutral" onClick={() => applyPreset({ tab: 'log', actor_type: 'system', since: '24h' })}>
              System events (24h)
            </ActionPill>
            <ActionPill to="/compliance" tone="neutral">
              Open compliance
            </ActionPill>
          </ActionPillRow>
        </Card>
      )}
    </div>
  )
}
