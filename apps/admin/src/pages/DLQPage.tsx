import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/supabase'
import { PIPELINE_STATUS } from '../lib/tokens'
import { PageHeader, PageHelp, Card, Badge, Btn, FilterSelect, EmptyState, Loading, ErrorAlert } from '../components/ui'

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

export function DLQPage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState<'dead_letter' | 'failed'>('dead_letter')

  useEffect(() => { loadQueue() }, [filter])

  async function loadQueue() {
    setLoading(true)
    setError(false)
    const res = await apiFetch<{ items: QueueItem[]; total: number }>(`/v1/admin/queue?status=${filter}`)
    if (res.ok && res.data) setItems(res.data.items)
    else setError(true)
    setLoading(false)
  }

  async function retryItem(id: string) {
    await apiFetch(`/v1/admin/queue/${id}/retry`, { method: 'POST' })
    await loadQueue()
  }

  async function retryAll() {
    await Promise.allSettled(
      items.map(item => apiFetch(`/v1/admin/queue/${item.id}/retry`, { method: 'POST' }))
    )
    await loadQueue()
  }

  return (
    <div className="space-y-3">
      <PageHeader title="Dead Letter Queue">
        <FilterSelect
          label="Status"
          value={filter}
          options={['dead_letter', 'failed']}
          onChange={(e) => setFilter(e.currentTarget.value as 'dead_letter' | 'failed')}
        />
        {items.length > 0 && (
          <Btn size="sm" onClick={retryAll}>Retry All ({items.length})</Btn>
        )}
      </PageHeader>

      <PageHelp
        title="About the Dead Letter Queue"
        whatIsIt="Pipeline jobs that failed all their retry attempts land here. Each item shows the stage that failed (classify, judge, fix, etc.), the last error, and the attempt count."
        useCases={[
          'Recover from transient outages (LLM rate limits, network blips) by retrying in bulk',
          'Identify systematic failures — a stage that fails repeatedly usually means a bug or bad config',
          'Avoid silent data loss when reports get stuck mid-pipeline',
        ]}
        howToUse="Switch between failed (still inside retry budget) and dead_letter (exhausted). Use Retry All after fixing a root cause; otherwise inspect the error and patch the upstream stage first."
      />

      {loading ? (
        <Loading text="Loading queue..." />
      ) : error ? (
        <ErrorAlert message="Failed to load queue items." onRetry={loadQueue} />
      ) : items.length === 0 ? (
        <EmptyState title={`No items in ${filter === 'dead_letter' ? 'dead letter' : 'failed'} queue`} />
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <Card key={item.id} className="p-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={PIPELINE_STATUS[item.status] ?? 'bg-surface-overlay text-fg-muted'}>
                      {item.stage} · {item.status}
                    </Badge>
                    <span className="text-2xs text-fg-faint font-mono">
                      {item.attempts}/{item.max_attempts} attempts
                    </span>
                  </div>
                  <p className="text-xs text-fg-secondary truncate">
                    {item.reports?.description?.slice(0, 150) ?? item.report_id}
                  </p>
                  {item.last_error && (
                    <pre className="mt-1.5 max-h-16 overflow-auto rounded-sm bg-danger-muted/30 p-1.5 text-2xs text-danger font-mono">
                      {item.last_error}
                    </pre>
                  )}
                  <p className="mt-1 text-2xs text-fg-faint">
                    Created {new Date(item.created_at).toLocaleString()}
                    {item.completed_at && ` · Last attempt ${new Date(item.completed_at).toLocaleString()}`}
                  </p>
                </div>
                <Btn variant="ghost" size="sm" onClick={() => retryItem(item.id)} className="ml-3 flex-shrink-0">
                  Retry
                </Btn>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
