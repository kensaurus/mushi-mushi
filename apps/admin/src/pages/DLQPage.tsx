/**
 * FILE: apps/admin/src/pages/DLQPage.tsx
 * PURPOSE: Queue + DLQ page. Page-level orchestration only — data loading,
 *          filter routing, retry/flush/recover actions. Visual pieces live in
 *          components/dlq/* so each (KPIs, throughput chart, stage breakdown,
 *          item card) can be reasoned about in isolation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { apiFetch } from '../lib/supabase'
import { apiErrorText } from '../lib/apiErrorText'
import { useEntitlements } from '../lib/useEntitlements'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { isQueueItemRetryable, parseQueueLaneParam } from '../components/dlq/queueRetry'
import {
  Btn,
  FilterSelect,
  EmptyState,
  ErrorAlert,
  RecommendedAction,
} from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { useToast } from '../lib/toast'
import { usePageData } from '../lib/usePageData'
import { QueueKpiRow } from '../components/dlq/QueueKpiRow'
import { QueueStatusBanner } from '../components/dlq/QueueStatusBanner'
import { QueueReadout } from '../components/dlq/QueueReadout'
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
  // we fall back to the first non-empty unfinished lane; a healthy pipeline
  // shows the empty state rather than a list of finished jobs.
  // The lane lives in the URL (`?status=`), so banner, chart-menu and
  // cross-page links open the lane they name. Without one, the page picks
  // the first non-empty lane once the summary loads.
  const [searchParams, setSearchParams] = useSearchParams()
  const laneFromUrl = parseQueueLaneParam(searchParams)
  const [autoLane, setAutoLane] = useState<StatusFilter>('dead_letter')
  const filter: StatusFilter = laneFromUrl ?? autoLane
  const setFilter = useCallback(
    (next: StatusFilter) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          params.set('status', next)
          params.delete('filter')
          params.delete('tab')
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )
  const [confirmRetryPage, setConfirmRetryPage] = useState(false)
  const [retryingPage, setRetryingPage] = useState(false)
  const { canEditProject } = useEntitlements()
  const [stage, setStage] = useState<string>('')
  const toast = useToast()
  const {
    data: queueStats,
    reload: reloadQueueStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
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
  // pivot to the first non-empty unfinished lane. Completed is never picked:
  // finished jobs are not work, and an empty lane says the queue is healthy.
  useEffect(() => {
    if (!summary || laneFromUrl) return
    if ((summary.byStatus.dead_letter ?? 0) > 0) return
    const priority: StatusFilter[] = ['failed', 'pending', 'running']
    const next = priority.find((s) => (summary.byStatus[s] ?? 0) > 0)
    if (next) setAutoLane(next)
  }, [summary, laneFromUrl])

  const onFilterChange = (next: StatusFilter) => {
    setFilter(next)
  }

  // Only failed, dead-letter and stuck jobs can be retried (the API refuses
  // the rest). Bulk retry acts on exactly these.
  const retryableItems = useMemo(() => {
    const now = Date.now()
    return items.filter((item) => isQueueItemRetryable(item, now))
  }, [items])
  const retryableIds = useMemo(() => new Set(retryableItems.map((i) => i.id)), [retryableItems])

  async function retryItem(id: string) {
    setRetrying((r) => ({ ...r, [id]: true }))
    const res = await apiFetch(`/v1/admin/queue/${id}/retry`, { method: 'POST' })
    setRetrying((r) => ({ ...r, [id]: false }))
    if (res.ok) {
      toast.push({ tone: 'success', message: 'Retry scheduled' })
      await loadAll()
    } else {
      toast.push({ tone: 'error', message: apiErrorText(res.error, 'The job was not retried. Try again in a moment.') })
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
      toast.push({ tone: 'error', message: apiErrorText(res.error, 'Nothing was flushed. Try again in a moment.') })
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
      toast.push({ tone: 'error', message: apiErrorText(res.error, 'Recovery did not run. Try again in a moment.') })
    }
  }

  async function retryAll() {
    if (retryableItems.length === 0) return
    setRetryingPage(true)
    const results = await Promise.allSettled(
      retryableItems.map((item) =>
        apiFetch(`/v1/admin/queue/${item.id}/retry`, { method: 'POST' }),
      ),
    )
    setRetryingPage(false)
    setConfirmRetryPage(false)
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
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-dlq">
      <PageHeaderBar
        title="Processing jobs"

        helpTitle="About Processing jobs"
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
        {retryableItems.length > 0 && canEditProject && (
          <Btn size="sm" variant="success" onClick={() => setConfirmRetryPage(true)}>
            Retry page ({retryableItems.length})
          </Btn>
        )}
        {canEditProject ? (
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
        ) : null}
        {stats.recoverable > 0 && canEditProject ? (
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
          Recover stranded ({stats.recoverable})
        </Btn>
        ) : null}
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <QueueStatusBanner
                stats={stats}
                onRefresh={() => void loadAll()}
                refreshing={loading}
                onRecover={stats.recoverable > 0 && canEditProject ? recoverStranded : undefined}
                onFlush={canEditProject ? flushCircuitBreakerQueue : undefined}
                recovering={flushing}
                flushing={flushingQueued}
              />
            ),
          },
        ]}
      />

      <QueueReadout
        stats={stats}
        fetchedAt={statsFetchedAt}
        isValidating={statsValidating || loading}
      />

      {summary && (
        <div data-dav-anchor="dlq:decide">
          <QueueKpiRow stats={stats} throughput={throughput} />
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
              cta={
                retryableItems.length > 0 && canEditProject
                  ? { label: `Retry page (${retryableItems.length})`, onClick: () => setConfirmRetryPage(true) }
                  : undefined
              }
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
                : 'Nothing here means the pipeline is healthy — change the status filter to inspect other lanes. Dead-letter is the only lane that needs you after retries run out.'
            }
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
                canRetry={canEditProject && retryableIds.has(item.id)}
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

      {confirmRetryPage && (
        <RetryPageDialog
          count={retryableItems.length}
          lane={filter}
          loading={retryingPage}
          onConfirm={() => void retryAll()}
          onCancel={() => {
            if (!retryingPage) setConfirmRetryPage(false)
          }}
        />
      )}
    </div>
  )
}

function RetryPageDialog({
  count,
  lane,
  loading,
  onConfirm,
  onCancel,
}: {
  count: number
  lane: string
  loading: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <ConfirmDialog
      title={`Retry ${count} job${count === 1 ? '' : 's'}?`}
      body={`Each ${lane.replace(/_/g, ' ')} job on this page runs again from the start, which diagnoses its report again. Fix the cause of the failure first, or they will fail again.`}
      confirmLabel={`Retry ${count}`}
      cancelLabel="Cancel"
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
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
