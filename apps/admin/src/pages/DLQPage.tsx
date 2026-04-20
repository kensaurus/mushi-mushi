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
  PageHeader,
  PageHelp,
  Btn,
  FilterSelect,
  EmptyState,
  ErrorAlert,
  RecommendedAction,
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { useToast } from '../lib/toast'
import { QueueKpiRow } from '../components/dlq/QueueKpiRow'
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

  return (
    <div className="space-y-3">
      <PageHeader
        title="Processing Queue"
        description="Inflight, failed, and dead-letter jobs from the worker pipeline. Retry or quarantine here."
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
          <Btn size="sm" onClick={retryAll}>
            Retry page ({items.length})
          </Btn>
        )}
        <Btn
          size="sm"
          variant="ghost"
          onClick={flushCircuitBreakerQueue}
          disabled={flushingQueued}
          title="Replays reports parked because the circuit breaker tripped (rate limits, LLM outages)."
        >
          {flushingQueued ? 'Flushing…' : 'Flush queued'}
        </Btn>
        <Btn
          size="sm"
          variant="primary"
          onClick={recoverStranded}
          disabled={flushing}
          loading={flushing}
          leadingIcon={<RefreshIcon />}
          title="Re-fires fast-filter for any report stuck older than 5 minutes plus pending queue items past their SLA."
        >
          {flushing ? 'Recovering…' : 'Recover stranded'}
        </Btn>
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

      {summary && <QueueKpiRow summary={summary} throughput={throughput} />}

      <QueueThroughputChart throughput={throughput} />

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
              <QueueItemCard
                key={item.id}
                item={item}
                retrying={!!retrying[item.id]}
                onRetry={() => retryItem(item.id)}
              />
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
