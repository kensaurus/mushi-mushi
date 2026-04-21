/**
 * FILE: apps/admin/src/pages/AuditPage.tsx
 * PURPOSE: Append-only history of consequential actions. Filter by action +
 *          resource type + actor + date, search across action/resource fields,
 *          paginate, and expand any row to inspect the metadata payload.
 *          State is fully URL-synced so deep links are shareable.
 */

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
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
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { HeroSearch } from '../components/illustrations/HeroIllustrations'

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

const PAGE_SIZE = 50

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
  if (action.endsWith('.failed') || action.endsWith('.deleted') || action.endsWith('.revoked') || action.endsWith('.dismissed')) {
    return 'bg-danger/15 text-danger'
  }
  if (action.endsWith('.applied') || action.endsWith('.created') || action.endsWith('.minted') || action.endsWith('.installed') || action.endsWith('.fulfilled')) {
    return 'bg-ok/15 text-ok'
  }
  if (action.endsWith('.dispatched') || action.endsWith('.classified') || action.endsWith('.connected')) {
    return 'bg-brand/15 text-brand'
  }
  return 'bg-surface-overlay text-fg-secondary'
}

export function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()

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

  const { data, loading, error, reload } = usePageData<AuditResponse>(
    `/v1/admin/audit?${queryString}`,
    { deps: [queryString] },
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
    setSearchParams(new URLSearchParams(), { replace: true })
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

  return (
    <div className="space-y-3">
      <PageHeader
        title="Audit Log"
        description="Append-only history of every mutation made by the platform. Filter by actor, action, or resource."
      >
        <Btn variant="ghost" size="sm" onClick={exportCsv}>Export CSV ({logs.length})</Btn>
      </PageHeader>

      <PageHelp
        title="About the Audit Log"
        whatIsIt="An append-only history of consequential actions: who did what, to which resource, and when. Captures both human and agent actors. Entries are immutable once written."
        useCases={[
          'Investigate "who changed this setting" or "why was this report dismissed"',
          'Satisfy SOC 2 / ISO 27001 audit evidence requirements',
          'Detect suspicious activity from API keys or service accounts',
        ]}
        howToUse="Stack filters to narrow the view; expand any row to see the metadata payload. Export current results to CSV for offline analysis or compliance bundles."
      />

      <Card className="p-3 space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-2">
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
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </SelectField>
          <SelectField
            label="When"
            value={since}
            onChange={(e) => updateParam('since', e.currentTarget.value)}
          >
            {SINCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
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
          <div className="flex items-center justify-between pt-1 border-t border-edge-subtle">
            <span className="text-2xs text-fg-muted">
              {activeFilterCount} active filter{activeFilterCount === 1 ? '' : 's'} · {total.toLocaleString()} matching entries
            </span>
            <Btn variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Btn>
          </div>
        )}
      </Card>

      {loading ? (
        <TableSkeleton rows={10} columns={5} showFilters={false} label="Loading audit logs" />
      ) : error ? (
        <ErrorAlert message={`Failed to load audit logs: ${error}`} onRetry={reload} />
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
          <div className="space-y-0.5">
            {logs.map((entry) => {
              const isExpanded = expanded === entry.id
              const hasMeta = entry.metadata && Object.keys(entry.metadata).length > 0
              return (
                <Card key={entry.id} className="overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : entry.id)}
                    className="w-full flex items-center gap-3 px-3 py-1.5 text-left hover:bg-surface-overlay/50 motion-safe:transition-colors"
                    aria-expanded={isExpanded}
                  >
                    <span className="text-2xs text-fg-faint tabular-nums font-mono w-40 shrink-0">
                      {new Date(entry.created_at).toLocaleString()}
                    </span>
                    <Badge className={`${actionTone(entry.action)} font-mono shrink-0`}>{entry.action}</Badge>
                    <span className="text-xs text-fg-muted truncate flex-1 min-w-0">
                      {entry.actor_email ?? entry.actor_id ?? 'system'}
                    </span>
                    <span className="text-2xs text-fg-faint font-mono shrink-0">
                      {entry.resource_type}
                      {entry.resource_id ? `:${entry.resource_id.slice(0, 8)}` : ''}
                    </span>
                    {hasMeta && (
                      <span className="text-2xs text-fg-faint shrink-0 w-3 text-center" aria-hidden>
                        {isExpanded ? '▾' : '▸'}
                      </span>
                    )}
                  </button>
                  {isExpanded && hasMeta && (
                    <div className="border-t border-edge-subtle bg-surface-overlay/30 px-3 py-2">
                      <div className="text-2xs text-fg-muted uppercase tracking-wider mb-1">Metadata</div>
                      <pre className="text-2xs font-mono text-fg-secondary overflow-x-auto whitespace-pre-wrap break-all">
                        {JSON.stringify(entry.metadata, null, 2)}
                      </pre>
                      {entry.resource_id && (
                        <div className="text-2xs text-fg-faint mt-2">
                          Full resource ID: <span className="font-mono text-fg-secondary">{entry.resource_id}</span>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>

          <div className="flex items-center justify-between text-2xs text-fg-muted pt-1">
            <span>
              Showing {offset + 1}–{Math.min(offset + logs.length, total)} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <Btn
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => updateParam('page', String(page - 1))}
              >
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
      )}
    </div>
  )
}
