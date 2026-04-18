/**
 * FILE: apps/admin/src/pages/DLQPage.tsx
 * PURPOSE: Queue + DLQ page. Shows backlog by stage, 14d throughput,
 *          paginated items, and per-item retry with toast feedback.
 *          Replaces the previous "useless" view that only listed dead
 *          letters with no context.
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { PIPELINE_STATUS, pipelineStatusLabel } from '../lib/tokens'
import {
  PageHeader,
  PageHelp,
  Card,
  Badge,
  Btn,
  FilterSelect,
  EmptyState,
  Loading,
  ErrorAlert,
  RelativeTime,
  RecommendedAction,
} from '../components/ui'
import { KpiRow, KpiTile, BarSparkline, type Tone } from '../components/charts'
import { useToast } from '../lib/toast'

interface QueueItem {
  id: string
  report_id: string
  project_id: string
  stage: string
  status: string
  attempts: number
  max_attempts: number
  last_error: string | null
  created_at: string
  completed_at: string | null
  reports?: { description: string; user_category: string; created_at: string }
}

interface QueueSummary {
  byStatus: Record<string, number>
  byStage: Record<string, Record<string, number>>
  stages: string[]
}

interface ThroughputDay {
  day: string
  created: number
  completed: number
  failed: number
}

const STATUS_OPTIONS = [
  'dead_letter',
  'failed',
  'pending',
  'running',
  'completed',
] as const

type StatusFilter = (typeof STATUS_OPTIONS)[number]

export function DLQPage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(25)
  const [summary, setSummary] = useState<QueueSummary | null>(null)
  const [throughput, setThroughput] = useState<ThroughputDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retrying, setRetrying] = useState<Record<string, boolean>>({})
  // Start with `dead_letter` so urgent failures lead. Once the summary loads
  // we fall back to the first non-empty status (in priority order) so a
  // healthy pipeline lands the user on the populated `completed` lane
  // instead of an empty page.
  const [filter, setFilter] = useState<StatusFilter>('dead_letter')
  const [filterTouched, setFilterTouched] = useState(false)
  const [stage, setStage] = useState<string>('')
  const toast = useToast()

  const loadAll = useCallback(async () => {
    setError(false)
    const params = new URLSearchParams({
      status: filter,
      page: String(page),
      pageSize: String(pageSize),
    })
    if (stage) params.set('stage', stage)
    const [itemsRes, sumRes, throughRes] = await Promise.all([
      apiFetch<{ items: QueueItem[]; total: number }>(`/v1/admin/queue?${params}`),
      apiFetch<QueueSummary>('/v1/admin/queue/summary'),
      apiFetch<{ days: ThroughputDay[] }>('/v1/admin/queue/throughput'),
    ])
    if (itemsRes.ok && itemsRes.data) {
      setItems(itemsRes.data.items)
      setTotal(itemsRes.data.total)
    } else {
      setError(true)
    }
    if (sumRes.ok && sumRes.data) setSummary(sumRes.data)
    if (throughRes.ok && throughRes.data) setThroughput(throughRes.data.days)
    setLoading(false)
  }, [filter, page, pageSize, stage])

  useEffect(() => {
    setLoading(true)
    loadAll()
  }, [loadAll])

  // Reset to page 1 whenever the filter or stage changes so the user
  // doesn't see "page 4 of nothing" after switching status.
  useEffect(() => {
    setPage(1)
  }, [filter, stage])

  // First time the summary loads, if the default `dead_letter` lane is empty,
  // pivot to the first non-empty status in priority order so a healthy
  // pipeline doesn't show an empty page.
  useEffect(() => {
    if (!summary || filterTouched) return
    if ((summary.byStatus.dead_letter ?? 0) > 0) return
    const priority: StatusFilter[] = ['failed', 'pending', 'running', 'completed']
    const next = priority.find((s) => (summary.byStatus[s] ?? 0) > 0)
    if (next) setFilter(next)
  }, [summary, filterTouched])

  const onFilterChange = (next: StatusFilter) => {
    setFilterTouched(true)
    setFilter(next)
  }

  async function retryItem(id: string) {
    setRetrying((r) => ({ ...r, [id]: true }))
    const res = await apiFetch(`/v1/admin/queue/${id}/retry`, { method: 'POST' })
    setRetrying((r) => ({ ...r, [id]: false }))
    if (res.ok) {
      toast.push({ tone: 'success', message: 'Retry scheduled' })
      await loadAll()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Retry failed' })
    }
  }

  async function retryAll() {
    if (items.length === 0) return
    const results = await Promise.allSettled(
      items.map((item) =>
        apiFetch(`/v1/admin/queue/${item.id}/retry`, { method: 'POST' }),
      ),
    )
    const ok = results.filter(
      (r) => r.status === 'fulfilled' && (r.value as { ok: boolean }).ok,
    ).length
    const failed = results.length - ok
    if (failed === 0) {
      toast.push({ tone: 'success', message: `Retried ${ok} jobs` })
    } else {
      toast.push({
        tone: 'warning',
        message: `Retried ${ok} · ${failed} failed`,
      })
    }
    await loadAll()
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-3">
      <PageHeader title="Processing Queue">
        <FilterSelect
          label="Status"
          value={filter}
          options={STATUS_OPTIONS as unknown as string[]}
          onChange={(e) => onFilterChange(e.currentTarget.value as StatusFilter)}
        />
        {summary && summary.stages.length > 0 && (
          <FilterSelect
            label="Stage"
            value={stage}
            options={summary.stages}
            onChange={(e) => setStage(e.currentTarget.value)}
          />
        )}
        {items.length > 0 && (
          <Btn size="sm" onClick={retryAll}>
            Retry page ({items.length})
          </Btn>
        )}
      </PageHeader>

      <PageHelp
        title="About the Processing Queue"
        whatIsIt="Every report passes through fast-filter, classify, and (optionally) judge + fix stages. This page is the operator view of that pipeline — backlog by status, throughput trend, and any item stuck in dead letter."
        useCases={[
          'Spot a stuck stage at a glance via the Backlog by status row',
          'Recover from transient outages (LLM rate limits, network blips) with bulk retry',
          'Audit pipeline health over the last 14 days via the throughput chart',
        ]}
        howToUse="Switch status to find what's failing. Use the stage filter to scope. Retry individual items, or use Retry page after fixing the root cause."
      />

      {summary && (
        <KpiRow cols={5}>
          <KpiTile
            label="Pending"
            value={summary.byStatus.pending ?? 0}
            accent={(summary.byStatus.pending ?? 0) > 0 ? 'info' : 'muted'}
            sublabel="waiting for worker"
          />
          <KpiTile
            label="Running"
            value={summary.byStatus.running ?? 0}
            accent={(summary.byStatus.running ?? 0) > 0 ? 'brand' : 'muted'}
            sublabel="in flight now"
          />
          <KpiTile
            label="Completed"
            value={summary.byStatus.completed ?? 0}
            accent={'ok' as Tone}
            sublabel="all-time success"
          />
          <KpiTile
            label="Failed"
            value={summary.byStatus.failed ?? 0}
            accent={(summary.byStatus.failed ?? 0) > 0 ? 'warn' : 'muted'}
            sublabel="still inside retry budget"
          />
          <KpiTile
            label="Dead letter"
            value={summary.byStatus.dead_letter ?? 0}
            accent={(summary.byStatus.dead_letter ?? 0) > 0 ? 'danger' : 'muted'}
            sublabel="exhausted retries"
          />
        </KpiRow>
      )}

      {throughput.length > 0 && throughput.some((d) => d.created > 0) && (
        <Card elevated className="p-3">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="text-2xs uppercase tracking-wider text-fg-muted">
              Daily throughput · last 14d
            </h3>
            <span className="text-2xs font-mono text-fg-faint">
              {throughput[0]?.day} → {throughput[throughput.length - 1]?.day}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-3xs text-fg-faint mb-1">Created</div>
              <BarSparkline
                values={throughput.map((d) => d.created)}
                accent="bg-info/70"
                height={28}
              />
            </div>
            <div>
              <div className="text-3xs text-fg-faint mb-1">Completed</div>
              <BarSparkline
                values={throughput.map((d) => d.completed)}
                accent="bg-ok/70"
                height={28}
              />
            </div>
            <div>
              <div className="text-3xs text-fg-faint mb-1">Failed / DLQ</div>
              <BarSparkline
                values={throughput.map((d) => d.failed)}
                accent="bg-danger/70"
                height={28}
              />
            </div>
          </div>
        </Card>
      )}

      {summary && summary.stages.length > 0 && (
        <Card elevated className="p-3">
          <h3 className="text-2xs uppercase tracking-wider text-fg-muted mb-1.5">
            Backlog by stage
          </h3>
          <div className="space-y-1.5">
            {summary.stages.map((s) => {
              const breakdown = summary.byStage[s] ?? {}
              const totalForStage = Object.values(breakdown).reduce(
                (a, b) => a + b,
                0,
              )
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStage(s === stage ? '' : s)}
                  className={`w-full grid grid-cols-[8rem_1fr_5rem] items-center gap-3 px-2 py-1.5 rounded-sm text-left transition-colors ${
                    stage === s
                      ? 'bg-brand/10 ring-1 ring-brand/40'
                      : 'hover:bg-surface-overlay'
                  }`}
                >
                  <span className="text-xs font-mono text-fg-secondary">{s}</span>
                  <div className="flex h-2 rounded-sm overflow-hidden bg-edge-subtle">
                    {(['pending', 'running', 'completed', 'failed', 'dead_letter'] as const).map(
                      (st) => {
                        const v = breakdown[st] ?? 0
                        if (v === 0) return null
                        const cls =
                          st === 'completed'
                            ? 'bg-ok'
                            : st === 'failed'
                              ? 'bg-warn'
                              : st === 'dead_letter'
                                ? 'bg-danger'
                                : st === 'running'
                                  ? 'bg-brand'
                                  : 'bg-info'
                        return (
                          <div
                            key={st}
                            className={cls}
                            style={{ width: `${(v / totalForStage) * 100}%` }}
                            title={`${st}: ${v}`}
                          />
                        )
                      },
                    )}
                  </div>
                  <span className="text-2xs font-mono text-fg-muted text-right">
                    {totalForStage}
                  </span>
                </button>
              )
            })}
          </div>
        </Card>
      )}

      {!loading &&
        !error &&
        items.length > 0 &&
        (() => {
          const isDeadLetter = filter === 'dead_letter'
          const stages = Array.from(new Set(items.map((i) => i.stage)))
          const stageHint = stages.length === 1 ? ` All in the ${stages[0]} stage.` : ''
          if (filter !== 'dead_letter' && filter !== 'failed') return null
          return (
            <RecommendedAction
              tone={isDeadLetter ? 'urgent' : 'info'}
              title={
                isDeadLetter
                  ? `${total} ${total === 1 ? 'job has' : 'jobs have'} given up after all retries`
                  : `${total} ${total === 1 ? 'job is' : 'jobs are'} retrying — investigate before they exhaust`
              }
              description={`Inspect the last error to understand the root cause, fix it, then retry in bulk.${stageHint}`}
              cta={{ label: `Retry page (${items.length})`, onClick: retryAll }}
            />
          )
        })()}

      {loading ? (
        <Loading text="Loading queue..." />
      ) : error ? (
        <ErrorAlert message="Failed to load queue items." onRetry={loadAll} />
      ) : items.length === 0 ? (
        <EmptyState
          title={`No items in ${filter.replace(/_/g, ' ')} queue`}
          description={
            filter === 'completed'
              ? 'Once jobs finish they move out of view; pick another status to see backlog.'
              : 'Nothing here means the pipeline is healthy — change the status filter to inspect other lanes.'
          }
        />
      ) : (
        <>
          <div className="space-y-1.5">
            {items.map((item) => (
              <Card key={item.id} className="p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        className={
                          PIPELINE_STATUS[item.status] ??
                          'bg-surface-overlay text-fg-muted'
                        }
                      >
                        {item.stage} · {pipelineStatusLabel(item.status)}
                      </Badge>
                      <span className="text-2xs text-fg-muted font-mono">
                        {item.attempts}/{item.max_attempts} attempts
                      </span>
                    </div>
                    <Link
                      to={`/reports/${item.report_id}`}
                      className="text-xs text-fg-secondary hover:text-fg truncate block"
                    >
                      {item.reports?.description?.slice(0, 150) ?? item.report_id}
                    </Link>
                    {item.last_error && (
                      <pre className="mt-1.5 max-h-16 overflow-auto rounded-sm bg-danger-muted/30 p-1.5 text-2xs text-danger font-mono">
                        {item.last_error}
                      </pre>
                    )}
                    <p className="mt-1 text-2xs text-fg-muted">
                      Created <RelativeTime value={item.created_at} />
                      {item.completed_at && (
                        <>
                          {' '}· last attempt{' '}
                          <RelativeTime value={item.completed_at} />
                        </>
                      )}
                    </p>
                  </div>
                  <Btn
                    variant="ghost"
                    size="sm"
                    onClick={() => retryItem(item.id)}
                    disabled={retrying[item.id]}
                    className="ml-3 flex-shrink-0"
                  >
                    {retrying[item.id] ? 'Retrying…' : 'Retry'}
                  </Btn>
                </div>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-2xs text-fg-muted">
              <span className="font-mono">
                Page {page} of {totalPages} · {total} total
              </span>
              <div className="flex gap-1">
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ← Prev
                </Btn>
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next →
                </Btn>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
