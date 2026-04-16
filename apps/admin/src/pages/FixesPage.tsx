import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { PIPELINE_STATUS } from '../lib/tokens'
import { PageHeader, Card, Badge, EmptyState, Loading, ErrorAlert } from '../components/ui'

interface FixAttempt {
  id: string
  report_id: string
  agent: string
  status: string
  branch?: string
  pr_url?: string
  files_changed?: string[]
  lines_changed?: number
  summary?: string
  review_passed?: boolean
  error?: string
  started_at: string
  completed_at?: string
}

export function FixesPage() {
  const [fixes, setFixes] = useState<FixAttempt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  function loadFixes() {
    setLoading(true)
    setError(false)
    apiFetch<{ fixes: FixAttempt[] }>('/v1/admin/fixes')
      .then(res => {
        if (res.ok && res.data) setFixes(res.data.fixes)
        else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadFixes() }, [])

  if (loading) return <Loading text="Loading fixes..." />
  if (error) return <ErrorAlert message="Failed to load fix attempts." onRetry={loadFixes} />

  return (
    <div className="space-y-3">
      <PageHeader title="Auto-Fix Pipeline">
        <span className="text-2xs text-fg-faint font-mono">{fixes.length} attempts</span>
      </PageHeader>

      {fixes.length === 0 ? (
        <EmptyState
          title="No fix attempts yet"
          description="Fix attempts appear here when agents generate code fixes."
        />
      ) : (
        <div className="space-y-1.5">
          {fixes.map(fix => (
            <Card key={fix.id} className="p-3 space-y-1.5">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                  <Badge className={PIPELINE_STATUS[fix.status] ?? 'bg-surface-overlay text-fg-muted'}>
                    {fix.status}
                  </Badge>
                  <span className="text-2xs text-fg-faint">via {fix.agent}</span>
                </div>
                <span className="text-2xs text-fg-faint tabular-nums font-mono">
                  {new Date(fix.started_at).toLocaleDateString()}
                </span>
              </div>

              {fix.summary && <p className="text-xs text-fg-secondary">{fix.summary}</p>}

              <div className="flex gap-3 text-2xs text-fg-muted font-mono">
                <span>Report: {fix.report_id.slice(0, 8)}…</span>
                {fix.branch && <span>Branch: {fix.branch}</span>}
                {fix.lines_changed != null && <span>{fix.lines_changed} lines</span>}
                {fix.files_changed && <span>{fix.files_changed.length} files</span>}
              </div>

              {fix.pr_url && (
                <a
                  href={fix.pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent hover:text-accent-hover underline"
                >
                  View PR
                </a>
              )}

              {fix.error && (
                <p className="text-2xs text-danger">{fix.error}</p>
              )}

              {fix.review_passed !== undefined && (
                <span className={`text-2xs ${fix.review_passed ? 'text-ok' : 'text-danger'}`}>
                  Review: {fix.review_passed ? 'Passed' : 'Failed'}
                </span>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
