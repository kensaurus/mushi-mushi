import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { PageHeader, Card, Badge, Btn, FilterSelect, Loading, ErrorAlert } from '../components/ui'

interface AuditEntry {
  id: string
  action: string
  actor_email: string
  actor_type: string
  resource_type: string
  resource_id: string
  metadata: Record<string, unknown>
  created_at: string
}

const ACTION_OPTIONS = ['', 'report.created', 'report.classified', 'report.triaged', 'settings.updated', 'fix.attempted']

export function AuditPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(false)
    const params = filter ? `?action=${filter}` : ''
    apiFetch<{ logs: AuditEntry[] }>(`/v1/admin/audit${params}`)
      .then((d) => {
        if (d.ok && d.data) setLogs(d.data.logs)
        else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [filter, retryKey])

  const exportCsv = () => {
    const headers = ['Time', 'Action', 'Actor', 'Type', 'Resource', 'Resource ID']
    const rows = logs.map((l) => [l.created_at, l.action, l.actor_email, l.actor_type, l.resource_type, l.resource_id])
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'audit-log.csv'
    a.click()
  }

  return (
    <div className="space-y-3">
      <PageHeader title="Audit Log">
        <FilterSelect
          label="Action"
          value={filter}
          options={ACTION_OPTIONS}
          onChange={(e) => setFilter(e.currentTarget.value)}
        />
        <Btn variant="ghost" size="sm" onClick={exportCsv}>Export CSV</Btn>
      </PageHeader>

      {loading ? <Loading /> : error ? <ErrorAlert message="Failed to load audit logs." onRetry={() => setRetryKey(k => k + 1)} /> : (
        <div className="space-y-0.5">
          {logs.map((entry) => (
            <Card key={entry.id} className="flex items-center gap-3 px-3 py-1.5">
              <span className="text-2xs text-fg-faint tabular-nums font-mono w-40 shrink-0">
                {new Date(entry.created_at).toLocaleString()}
              </span>
              <Badge className="bg-surface-overlay text-fg-secondary font-mono">{entry.action}</Badge>
              <span className="text-xs text-fg-muted">{entry.actor_email ?? entry.actor_type}</span>
              <span className="text-2xs text-fg-faint ml-auto font-mono">
                {entry.resource_type}{entry.resource_id ? `:${entry.resource_id.slice(0, 8)}` : ''}
              </span>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
