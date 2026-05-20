/**
 * FILE: apps/admin/src/pages/AuditPage.tsx
 * PURPOSE: Append-only audit console — URL tabs, health banner, KPI strip,
 *          filterable log table, and actor/action breakdown.
 */

import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import { usePageCopy } from '../lib/copy'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { SetupNudge } from '../components/SetupNudge'
import { AuditStatusBanner } from '../components/audit/AuditStatusBanner'
import { EMPTY_AUDIT_STATS, type AuditStats, type AuditTabId } from '../components/audit/types'
import { useToast } from '../lib/toast'
import {
  PageHeader,
  PageHelp,
  Card,
  Badge,
  Btn,
  FilterSelect,
  Input,
  SelectField,
  ErrorAlert,
  EmptyState,
  LogBlock,
  CodeValue,
  Section,
  StatCard,
  SegmentedControl,
} from '../components/ui'
import { ActiveFiltersRail, type ActiveFilter } from '../components/ActiveFiltersRail'
import { DataTable, type ColumnDef } from '../components/DataTable'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { HeroSearch } from '../components/illustrations/HeroIllustrations'
import { PageActionBar } from '../components/PageActionBar'
import { PageHero } from '../components/PageHero'
import { useNextBestAction } from '../lib/useNextBestAction'

interface AuditEntry {
  id: string
  project_id: string
  actor_id: string | null
  actor_email: string | null
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
    description: 'Posture summary, PageHero decide/act/verify, and the live event log.',
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

function actionTone(action: string): string {
  if (
    action.endsWith('.failed') ||
    action.endsWith('.deleted') ||
    action.endsWith('.revoked') ||
    action.endsWith('.dismissed')
  ) {
    return 'bg-danger/15 text-danger'
  }
  if (
    action.endsWith('.applied') ||
    action.endsWith('.created') ||
    action.endsWith('.minted') ||
    action.endsWith('.installed') ||
    action.endsWith('.fulfilled')
  ) {
    return 'bg-ok/15 text-ok'
  }
  if (action.endsWith('.dispatched') || action.endsWith('.classified') || action.endsWith('.connected')) {
    return 'bg-brand/15 text-brand'
  }
  return 'bg-surface-overlay text-fg-secondary'
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
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<AuditStats>(statsPath)
  const stats = statsData ?? EMPTY_AUDIT_STATS

  const action = searchParams.get('action') ?? ''
  const resourceType = searchParams.get('resource_type') ?? ''
  const actor = searchParams.get('actor') ?? ''
  const actorType = searchParams.get('actor_type') ?? ''
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
    const sinceIso = sinceToIso(since)
    if (sinceIso) params.set('since', sinceIso)
    if (q) params.set('q', q)
    params.set('limit', String(PAGE_SIZE))
    params.set('offset', String(offset))
    return params.toString()
  }, [action, resourceType, actor, actorType, since, q, offset])

  const {
    data,
    loading,
    error,
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
    (preset: { action?: string; since?: string; tab?: AuditTabId; actor_type?: string }) => {
      const next = new URLSearchParams(searchParams)
      if (preset.tab) next.set('tab', preset.tab)
      else next.delete('tab')
      if (preset.action) next.set('action', preset.action)
      else next.delete('action')
      if (preset.since) next.set('since', preset.since)
      else next.delete('since')
      if (preset.actor_type) next.set('actor_type', preset.actor_type)
      else next.delete('actor_type')
      next.delete('page')
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const logs = data?.logs ?? []
  const total = data?.count ?? 0
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  const [expanded, setExpanded] = useState<string | null>(null)
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
    for (const key of ['action', 'resource_type', 'actor', 'actor_type', 'since', 'q', 'page']) {
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

  const activeFilterCount = [action, resourceType, actor, actorType, since, q].filter(Boolean).length

  const columns = useMemo<ColumnDef<AuditEntry, unknown>[]>(
    () => [
      {
        id: 'time',
        header: 'Time',
        accessorFn: (e) => e.created_at,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-2xs text-fg-faint tabular-nums font-mono whitespace-nowrap">
            {new Date(row.original.created_at).toLocaleString()}
          </span>
        ),
      },
      {
        id: 'action',
        header: 'Action',
        enableSorting: true,
        accessorFn: (e) => e.action,
        cell: ({ row }) => (
          <Badge className={`${actionTone(row.original.action)} font-mono`}>{row.original.action}</Badge>
        ),
      },
      {
        id: 'actor',
        header: 'Actor',
        enableSorting: true,
        accessorFn: (e) => e.actor_email ?? e.actor_id ?? 'system',
        cell: ({ row }) => (
          <span className="truncate text-xs text-fg-muted block max-w-[14rem]">
            {row.original.actor_email ?? row.original.actor_id ?? 'system'}
          </span>
        ),
      },
      {
        id: 'resource',
        header: 'Resource',
        accessorFn: (e) => `${e.resource_type}${e.resource_id ? `:${e.resource_id}` : ''}`,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-2xs text-fg-faint font-mono whitespace-nowrap">
            {row.original.resource_type}
            {row.original.resource_id ? `:${row.original.resource_id.slice(0, 8)}` : ''}
          </span>
        ),
      },
      {
        id: 'expand',
        header: '',
        enableSorting: false,
        cell: ({ row }) => {
          const has = row.original.metadata && Object.keys(row.original.metadata).length > 0
          if (!has) return null
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
  const warnCount = stats.warnCount24h
  const auditAction = useNextBestAction({ scope: 'audit', failCount, warnCount })
  const auditSeverity: 'ok' | 'warn' | 'crit' | 'neutral' =
    failCount > 0 ? 'crit' : warnCount > 0 ? 'warn' : stats.totalEvents === 0 ? 'neutral' : 'ok'
  const lastLog = logs[0]

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
    <Card className="p-3 space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-2" data-dav-anchor="audit:decide">
        <FilterSelect
          label="Action"
          value={action}
          options={ACTION_OPTIONS}
          onChange={(e) => updateParam('action', e.currentTarget.value)}
        />
        <FilterSelect
          label="Resource"
          value={resourceType}
          options={RESOURCE_OPTIONS}
          onChange={(e) => updateParam('resource_type', e.currentTarget.value)}
        />
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
          <span className="text-2xs text-fg-muted whitespace-nowrap pt-0.5">{total.toLocaleString()} matching</span>
        </div>
      )}
    </Card>
  )

  const logTable = loading ? (
    <TableSkeleton rows={10} columns={5} showFilters={false} label="Loading audit logs" />
  ) : error ? (
    <ErrorAlert message={`Failed to load audit logs: ${error}`} onRetry={reloadAll} />
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
      <div data-dav-anchor="audit:verify">
        <DataTable<AuditEntry>
          data={logs}
          columns={columns}
          getRowId={(e) => e.id}
          density="compact"
          ariaLabel="Audit log entries"
          expandedIds={expandedIds}
          onRowClick={(entry) => {
            const hasMeta = entry.metadata && Object.keys(entry.metadata).length > 0
            if (!hasMeta) return
            setExpanded(expanded === entry.id ? null : entry.id)
          }}
          renderExpanded={(entry) => (
            <div className="space-y-2">
              <LogBlock value={JSON.stringify(entry.metadata ?? {}, null, 2)} label="Metadata" />
              {entry.resource_id && (
                <div className="text-2xs text-fg-faint space-y-1">
                  <span>Full resource ID</span>
                  <CodeValue value={entry.resource_id} tone="id" />
                </div>
              )}
            </div>
          )}
        />
      </div>
      <div className="flex items-center justify-between text-2xs text-fg-muted pt-1">
        <span>
          Showing {offset + 1}–{Math.min(offset + logs.length, total)} of {total.toLocaleString()}
        </span>
        <div className="flex items-center gap-1">
          <Btn variant="ghost" size="sm" disabled={page <= 1} onClick={() => updateParam('page', String(page - 1))}>
            ← Prev
          </Btn>
          <span className="px-2 tabular-nums">
            Page {page} / {totalPages}
          </span>
          <Btn
            variant="ghost"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => updateParam('page', String(page + 1))}
          >
            Next →
          </Btn>
        </div>
      </div>
    </>
  )

  if (!activeProjectId) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={copy?.title ?? 'Audit log'}
          description={
            copy?.description ??
            'Append-only history of every mutation — filter by actor, action, or resource.'
          }
        />
        <SetupNudge
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
    return <ErrorAlert message={`Failed to load audit stats: ${statsError}`} onRetry={reloadAll} />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy?.title ?? 'Audit log'}
        projectScope={stats.projectName ?? undefined}
        description={
          copy?.description ??
          'Append-only history of every mutation — filter by actor, action, or resource.'
        }
      >
        {stats.auditLogEntitlement ? (
          <Badge className="bg-ok-muted text-ok">Audit enabled</Badge>
        ) : (
          <Badge className="bg-warn/10 text-warn">{stats.planDisplayName} — upgrade for audit</Badge>
        )}
        <Btn variant="ghost" size="sm" onClick={exportCsv} data-dav-anchor="audit:act">
          Export CSV ({logs.length})
        </Btn>
      </PageHeader>

      <AuditStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onFilterFailures={() => applyPreset({ tab: 'log', action: 'fix.failed', since: '24h' })}
        onFilterWarns={() => applyPreset({ tab: 'log', action: 'api_key.revoked', since: '24h' })}
      />

      <SegmentedControl
        value={activeTab}
        onChange={setActiveTab}
        options={tabOptions}
        ariaLabel="Audit sections"
        size="sm"
      />

      <Section
        title="Audit snapshot"
        freshness={{ at: statsFetchedAt ?? lastFetchedAt, isValidating: statsValidating || isValidating }}
      >
        <p className="mb-3 text-2xs text-fg-muted">{activeTabMeta.description}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label="24h events"
            value={stats.events24h}
            accent={stats.events24h > 0 ? 'text-brand' : undefined}
            hint={`${stats.activeProjectEvents24h} on ${stats.projectName ?? 'project'}`}
          />
          <StatCard
            label="Failures"
            value={stats.failCount24h}
            accent={stats.failCount24h > 0 ? 'text-danger' : 'text-ok'}
            hint="fix.failed · integration.disconnected"
          />
          <StatCard
            label="Actor mix"
            value={`${stats.humanCount24h}/${stats.agentCount24h}/${stats.systemCount24h}`}
            accent={stats.agentCount24h > 0 ? 'text-info' : undefined}
            hint="Human / agent / system (24h)"
          />
          <StatCard
            label="All-time"
            value={stats.totalEvents.toLocaleString()}
            accent="text-brand"
            hint={stats.topAction7d ? `Top 7d: ${stats.topAction7d}` : 'No 7d activity'}
          />
        </div>
      </Section>

      {activeTab === 'overview' && (
        <>
          <PageHero
            scope="audit"
            title="Audit Log"
            kicker="Append-only evidence"
            decide={{
              label:
                failCount > 0
                  ? 'FAIL events present'
                  : warnCount > 0
                    ? 'WARN events present'
                    : stats.totalEvents === 0
                      ? 'No audit activity'
                      : 'Audit trail clean',
              metric: `${stats.events24h} / 24h`,
              summary:
                failCount > 0
                  ? `${failCount} FAIL event${failCount === 1 ? '' : 's'} in 24h — block next SOC 2 cycle without remediation.`
                  : warnCount > 0
                    ? `${warnCount} WARN event${warnCount === 1 ? '' : 's'} — technical debt on evidence, not blocking.`
                    : stats.totalEvents === 0
                      ? 'Audit stream empty — mutations will appear as your team uses the console.'
                      : 'Every mutation in scope is accounted for. Export evidence for your next review.',
              severity: auditSeverity,
              anchor: 'audit:decide',
              evidence: {
                kind: 'metric-breakdown',
                items: [
                  { label: '24h events', value: stats.events24h, tone: 'neutral' },
                  { label: 'FAIL (24h)', value: failCount, tone: failCount > 0 ? 'crit' : 'ok' },
                  { label: 'WARN (24h)', value: warnCount, tone: warnCount > 0 ? 'warn' : 'ok' },
                ],
              },
            }}
            act={auditAction}
            actAnchor="audit:act"
            actEvidence={
              auditAction
                ? {
                    kind: 'rule-trace',
                    why: auditAction.reason ?? auditAction.title,
                    threshold: failCount > 0 ? `${failCount} FAIL event${failCount === 1 ? '' : 's'}` : undefined,
                  }
                : undefined
            }
            verify={{
              label: lastLog ? `Last event · ${lastLog.action}` : stats.latestAction ? `Latest · ${stats.latestAction}` : 'Awaiting activity',
              detail: lastLog
                ? `${lastLog.actor_email ?? lastLog.actor_id ?? 'system'} · ${new Date(lastLog.created_at).toISOString().slice(0, 16).replace('T', ' ')}`
                : stats.latestActorEmail ?? '—',
              to: '/audit?tab=log',
              secondaryTo: '/compliance',
              secondaryLabel: 'Open compliance',
              anchor: 'audit:verify',
              evidence: lastLog
                ? {
                    kind: 'last-event',
                    at: lastLog.created_at,
                    by: lastLog.actor_email ?? lastLog.actor_id ?? 'system',
                    payloadSummary: lastLog.action,
                    status:
                      lastLog.action === 'fix.failed' || lastLog.action === 'integration.disconnected'
                        ? 'error'
                        : 'ok',
                  }
                : stats.latestEventAt
                  ? {
                      kind: 'last-event',
                      at: stats.latestEventAt,
                      by: stats.latestActorEmail ?? 'system',
                      payloadSummary: stats.latestAction ?? 'event',
                      status: 'ok',
                    }
                  : undefined,
            }}
          />

          <PageActionBar scope="audit" action={auditAction} />

          <PageHelp
            title={copy?.help?.title ?? 'About the Audit Log'}
            whatIsIt={
              copy?.help?.whatIsIt ??
              'An append-only history of consequential actions: who did what, to which resource, and when.'
            }
            useCases={
              copy?.help?.useCases ?? [
                'Investigate who changed a setting or rotated an API key',
                'Satisfy SOC 2 / ISO 27001 audit evidence requirements',
                'Detect suspicious activity from API keys or service accounts',
              ]
            }
            howToUse={
              copy?.help?.howToUse ??
              'Stack filters on the Log tab; expand any row for metadata JSON. Export CSV for compliance bundles.'
            }
          />

          {filterPanel}
          {logTable}
        </>
      )}

      {activeTab === 'log' && (
        <>
          <PageHelp
            title={copy?.help?.title ?? 'About the Audit Log'}
            whatIsIt={activeTabMeta.description}
            useCases={copy?.help?.useCases ?? []}
            howToUse={copy?.help?.howToUse ?? 'Expand rows with metadata to debug payloads.'}
          />
          {filterPanel}
          {logTable}
        </>
      )}

      {activeTab === 'breakdown' && (
        <Card className="p-5 space-y-4">
          <div className="text-xs font-medium uppercase tracking-wider">7-day action mix</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard
              label="Human actors"
              value={stats.humanCount24h}
              accent="text-ok"
              hint="Email + uuid in last 24h sample"
            />
            <StatCard
              label="Agent actors"
              value={stats.agentCount24h}
              accent={stats.agentCount24h > 0 ? 'text-info' : undefined}
              hint="LLM / agent_* ids in last 24h"
            />
            <StatCard
              label="System actors"
              value={stats.systemCount24h}
              accent={stats.systemCount24h > 0 ? 'text-warn' : undefined}
              hint="Cron / webhook / null actor"
            />
          </div>
          {stats.topAction7d ? (
            <div className="rounded border border-edge-subtle p-3 space-y-1">
              <p className="text-2xs text-fg-muted uppercase tracking-wider">Most frequent action (7d)</p>
              <Badge className={`${actionTone(stats.topAction7d)} font-mono`}>{stats.topAction7d}</Badge>
              <p className="text-2xs text-fg-muted">{stats.topAction7dCount} occurrences across owned projects</p>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => applyPreset({ tab: 'log', action: stats.topAction7d ?? '', since: '7d' })}
              >
                Filter log to this action
              </Btn>
            </div>
          ) : (
            <EmptyState title="No 7-day activity" description="Broaden the window on the Log tab or wait for the next mutation." />
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn size="sm" variant="ghost" onClick={() => applyPreset({ tab: 'log', since: '24h', action: 'fix.failed' })}>
              Failures (24h)
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => applyPreset({ tab: 'log', since: '24h', action: 'api_key.revoked' })}>
              Revoked keys (24h)
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => applyPreset({ tab: 'log', actor_type: 'system', since: '24h' })}>
              System events (24h)
            </Btn>
            <Link to="/compliance">
              <Btn size="sm" variant="ghost">Open compliance</Btn>
            </Link>
          </div>
        </Card>
      )}
    </div>
  )
}
