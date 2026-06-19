/**
 * FILE: apps/admin/src/pages/DLQPage.tsx
 * PURPOSE: Queue + DLQ page. Page-level orchestration only — data loading,
 *          filter routing, retry/flush/recover actions. Visual pieces live in
 *          components/dlq/* so each (KPIs, throughput chart, stage breakdown,
 *          item card) can be reasoned about in isolation.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import {
  Btn,
  FilterSelect,
  EmptyState,
  ErrorAlert,
  RecommendedAction,
  Card,
} from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { useToast } from '../lib/toast'
import { usePageData } from '../lib/usePageData'
import { QueueKpiRow } from '../components/dlq/QueueKpiRow'
import { QueueStatusBanner } from '../components/dlq/QueueStatusBanner'
import { EMPTY_QUEUE_STATS, type QueueStats } from '../components/dlq/QueueStatsTypes'
import { QueueThroughputChart } from '../components/dlq/QueueThroughputChart'
import { QueueStageBreakdown } from '../components/dlq/QueueStageBreakdown'
import { QueueItemCard } from '../components/dlq/QueueItemCard'
import {
  STATUS_OPTIONS,
  type QueueItem,
  type QueueSummary,
  type StatusFilter,
  type ThroughputDay,
} from '../components/dlq/types'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'

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
  const [flushing, setFlushing] = useState(false)
  const [flushingQueued, setFlushingQueued] = useState(false)
  // Start with `dead_letter` so urgent failures lead. Once the summary loads
  // we fall back to the first non-empty status (in priority order) so a
  // healthy pipeline lands the user on the populated `completed` lane
  // instead of an empty page.
  const [filter, setFilter] = useState<StatusFilter>('dead_letter')
  const [filterTouched, setFilterTouched] = useState(false)
  const [stage, setStage] = useState<string>('')
  const toast = useToast()
  const {
    data: queueStats,
    reload: reloadQueueStats,
  } = usePageData<QueueStats>('/v1/admin/queue/stats')
  const stats = queueStats ?? EMPTY_QUEUE_STATS

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
    reloadQueueStats()
    setLoading(false)
  }, [filter, page, pageSize, stage, reloadQueueStats])

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

  async function flushCircuitBreakerQueue() {
    setFlushingQueued(true)
    const res = await apiFetch<{ flushed: number; scanned: number }>(
      '/v1/admin/queue/flush-queued',
      { method: 'POST' },
    )
    setFlushingQueued(false)
    if (res.ok && res.data) {
      toast.push({
        tone: res.data.flushed > 0 ? 'success' : 'info',
        message:
          res.data.flushed > 0
            ? `Flushed ${res.data.flushed} circuit-breaker queued report${res.data.flushed === 1 ? '' : 's'}`
            : 'No reports were stuck behind the circuit breaker.',
      })
      await loadAll()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Flush failed' })
    }
  }

  async function recoverStranded() {
    setFlushing(true)
    const res = await apiFetch<{ reports: number; queue: number; reconciled: number }>(
      '/v1/admin/queue/recover',
      { method: 'POST' },
    )
    setFlushing(false)
    if (res.ok && res.data) {
      const total = res.data.reports + res.data.queue + res.data.reconciled
      toast.push({
        tone: total > 0 ? 'success' : 'info',
        message:
          total > 0
            ? `Recovered ${res.data.reports} report${res.data.reports === 1 ? '' : 's'} · retried ${res.data.queue} queue item${res.data.queue === 1 ? '' : 's'} · reconciled ${res.data.reconciled}`
            : 'Pipeline is healthy — nothing stranded.',
      })
      await loadAll()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Recovery failed' })
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
      toast.push({ tone: 'warning', message: `Retried ${ok} · ${failed} failed` })
    }
    await loadAll()
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const deadLetter = summary?.byStatus?.dead_letter ?? 0
  const failedCount = summary?.byStatus?.failed ?? 0

  return (
    <div className="space-y-5">
      <PageHeaderBar
        title="Processing Queue"
        description="Inflight, failed, and dead-letter jobs from the worker pipeline. Retry or quarantine here."
        helpTitle="About the Processing Queue"
        helpWhatIsIt="Every report passes through fast-filter, classify, and (optionally) judge + fix stages. This page is the operator view of that pipeline — backlog by status, throughput trend, and any item stuck in dead letter."
        helpUseCases={[
          'Spot a stuck stage at a glance via the Backlog by status row',
          'Recover from transient outages (LLM rate limits, network blips) with bulk retry',
          'Audit pipeline health over the last 14 days via the throughput chart',
        ]}
        helpHowToUse="Switch status to find what's failing. Use the stage filter to scope. Retry individual items, or use Retry page after fixing the root cause."
      >
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
          <Btn size="sm" variant="success" onClick={retryAll}>
            Retry page ({items.length})
          </Btn>
        )}
        <Btn
          size="sm"
          variant="ghost"
          onClick={flushCircuitBreakerQueue}
          disabled={flushingQueued}
          loading={flushingQueued}
          title="Replays reports parked because the circuit breaker tripped (rate limits, LLM outages)."
        >
          Flush queued
        </Btn>
        <Btn
          size="sm"
          variant="primary"
          onClick={recoverStranded}
          disabled={flushing}
          loading={flushing}
          leadingIcon={<RefreshIcon />}
          title="Re-fires fast-filter for any report stuck older than 5 minutes plus pending queue items past their SLA."
          data-dav-anchor="dlq:act"
        >
          Recover stranded
        </Btn>
      </PageHeaderBar>

      <QueueStatusBanner
        stats={stats}
        onRefresh={() => void loadAll()}
        refreshing={loading}
        onRecover={recoverStranded}
        onFlush={flushCircuitBreakerQueue}
        recovering={flushing}
        flushing={flushingQueued}
      />

      {(deadLetter > 0 || failedCount > 0) && (
        <Card
          className={`space-y-3 p-4 ${
            deadLetter > 0 ? 'border-danger/30 bg-danger/5' : 'border-warn/30 bg-warn/5'
          }`}
        >
          <SignalChip tone={deadLetter > 0 ? 'danger' : 'warn'}>
            Needs attention
          </SignalChip>
          <ContainedBlock tone="warn">
            <p className="text-xs font-medium leading-snug text-fg">
              {deadLetter > 0
                ? `${deadLetter} job${deadLetter === 1 ? '' : 's'} in dead-letter — manual retry after fixing the root cause.`
                : `${failedCount} job${failedCount === 1 ? '' : 's'} failing — investigate before retries exhaust.`}
            </p>
          </ContainedBlock>
          <ActionPillRow>
            <ActionPill
              onClick={() => {
                setFilter(deadLetter > 0 ? 'dead_letter' : 'failed')
                setPage(1)
              }}
              tone="brand"
            >
              Open {deadLetter > 0 ? 'dead-letter' : 'failed'} lane →
            </ActionPill>
            <ActionPill onClick={() => void recoverStranded()} tone="neutral">
              Recover stranded
            </ActionPill>
          </ActionPillRow>
        </Card>
      )}

      {summary && (
        <div className="space-y-1.5">
          {/* Plain-language reading guide. The five KPI tiles use technical
              terms (pending / running / completed / failed / dead letter)
              that map cleanly to the worker state machine but are opaque
              to operators who haven't read the queue runbook. The tooltip
              behind each tile already explains it ("hover for meaning"),
              but discovery via hover is silent — see NN/g #6 (Recognition
              over Recall). This sub-caption surfaces the mental model
              up-front: lanes flow left→right, the sparkline mirrors the
              same lane in the 14d throughput chart below, and dead-letter
              is the only lane that needs human action. */}
          <ContainedBlock tone="muted" label="How to read this row">
            <p className="text-2xs leading-relaxed text-fg-muted">
              Jobs move <span className="font-medium text-fg-secondary">left → right</span> through the worker
              (waiting → running → completed). Failed jobs are still inside the retry budget;{' '}
              <span className="font-medium text-warn">dead-letter</span> jobs gave up and need a manual look.
              Each sparkline shows the last 14 days for that lane — hover any tile for the full meaning.
            </p>
          </ContainedBlock>
          <div data-dav-anchor="dlq:decide">
            <QueueKpiRow summary={summary} throughput={throughput} />
          </div>
        </div>
      )}

      <div data-dav-anchor="dlq:verify">
        <QueueThroughputChart throughput={throughput} />
      </div>

      {summary && (
        <QueueStageBreakdown summary={summary} selectedStage={stage} onSelect={setStage} />
      )}

      {!loading &&
        !error &&
        items.length > 0 &&
        (filter === 'dead_letter' || filter === 'failed') &&
        (() => {
          const isDeadLetter = filter === 'dead_letter'
          const stages = Array.from(new Set(items.map((i) => i.stage)))
          const stageHint = stages.length === 1 ? ` All in the ${stages[0]} stage.` : ''
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
        <TableSkeleton rows={6} columns={4} showFilters label="Loading queue" />
      ) : error ? (
        <ErrorAlert message="Failed to load queue items." onRetry={loadAll} />
      ) : items.length === 0 ? (
        <div className="space-y-2">
          <EmptyState
            title={`No items in ${filter.replace(/_/g, ' ')} queue`}
            description={
              filter === 'completed'
                ? 'Once jobs finish they move out of view; pick another status to see backlog.'
                : 'Nothing here means the pipeline is healthy — change the status filter to inspect other lanes.'
            }
          />
          <EmptySectionMessage
            text="Switch status or stage filters to inspect other pipeline lanes."
            hint="Dead-letter is the only lane that requires operator action after retries exhaust."
          />
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {items.map((item) => (
              <QueueItemCard
                key={item.id}
                item={item}
                retrying={!!retrying[item.id]}
                onRetry={() => retryItem(item.id)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <ContainedBlock tone="muted" className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <SignalChip tone="neutral" className="font-mono">
                Page {page} of {totalPages} · {total} total
              </SignalChip>
              <ActionPillRow>
                <ActionPill
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  tone="neutral"
                  className={page <= 1 ? 'opacity-50 pointer-events-none' : ''}
                >
                  ← Prev
                </ActionPill>
                <ActionPill
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  tone="neutral"
                  className={page >= totalPages ? 'opacity-50 pointer-events-none' : ''}
                >
                  Next →
                </ActionPill>
              </ActionPillRow>
            </ContainedBlock>
          )}
        </>
      )}
    </div>
  )
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13 5.2" />
      <path d="M13 2v3h-3" />
      <path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9L3 10.8" />
      <path d="M3 14v-3h3" />
    </svg>
  )
}
