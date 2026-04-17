import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { PIPELINE_STATUS } from '../lib/tokens'
import { PageHeader, PageHelp, Card, Badge, EmptyState, Loading, ErrorAlert } from '../components/ui'

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

interface DispatchJob {
  id: string
  project_id: string
  report_id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  pr_url?: string
  error?: string
  created_at: string
  started_at?: string
  finished_at?: string
}

const DISPATCH_STATUS: Record<DispatchJob['status'], string> = {
  queued: 'bg-surface-overlay text-fg-muted',
  running: 'bg-info-subtle text-info',
  completed: 'bg-ok-subtle text-ok',
  failed: 'bg-danger-subtle text-danger',
  cancelled: 'bg-surface-overlay text-fg-faint',
}

export function FixesPage() {
  const [fixes, setFixes] = useState<FixAttempt[]>([])
  const [dispatches, setDispatches] = useState<DispatchJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  function loadFixes() {
    setLoading(true)
    setError(false)
    Promise.all([
      apiFetch<{ fixes: FixAttempt[] }>('/v1/admin/fixes'),
      apiFetch<{ dispatches: DispatchJob[] }>('/v1/admin/fixes/dispatches'),
    ])
      .then(([fixRes, dispRes]) => {
        if (fixRes.ok && fixRes.data) setFixes(fixRes.data.fixes)
        else setError(true)
        if (dispRes.ok && dispRes.data) setDispatches(dispRes.data.dispatches)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadFixes()
    const t = setInterval(loadFixes, 5000)
    return () => clearInterval(t)
  }, [])

  if (loading) return <Loading text="Loading fixes..." />
  if (error) return <ErrorAlert message="Failed to load fix attempts." onRetry={loadFixes} />

  return (
    <div className="space-y-3">
      <PageHeader title="Auto-Fix Pipeline">
        <span className="text-2xs text-fg-faint font-mono">{fixes.length} attempts</span>
      </PageHeader>

      <PageHelp
        title="About the Auto-Fix Pipeline"
        whatIsIt="When a bug report is high-confidence and reproducible, an agent (Claude, Cursor, etc.) attempts a code fix on a feature branch and opens a pull request for review."
        useCases={[
          'Track which bugs are being auto-resolved versus needing human input',
          'Audit which agent and model produced each fix attempt',
          'Inspect failures to understand which bug categories are still beyond automation',
        ]}
        howToUse="Dispatch a fix from any classified report. Each card shows status, branch, lines/files changed, and a PR link. Review the PR before merging — passing the review check does not skip human approval."
      />

      {dispatches.filter(d => d.status === 'queued' || d.status === 'running').length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">In-flight dispatches</h3>
          {dispatches.filter(d => d.status === 'queued' || d.status === 'running').map(d => (
            <Card key={d.id} className="p-3 space-y-1">
              <div className="flex justify-between items-center">
                <Badge className={DISPATCH_STATUS[d.status]}>{d.status}</Badge>
                <span className="text-2xs font-mono text-fg-faint">
                  Report {d.report_id.slice(0, 8)}…
                </span>
              </div>
              <p className="text-2xs text-fg-muted">
                Queued {new Date(d.created_at).toLocaleTimeString()}
                {d.started_at && ` · started ${new Date(d.started_at).toLocaleTimeString()}`}
              </p>
            </Card>
          ))}
        </div>
      )}

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
