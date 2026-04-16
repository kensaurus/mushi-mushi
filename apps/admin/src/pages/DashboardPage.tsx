import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { SEVERITY, CATEGORY_LABELS } from '../lib/tokens'
import { PageHeader, StatCard, Card, Badge, EmptyState, Loading, ErrorAlert } from '../components/ui'

interface Stats {
  total: number
  byStatus: Record<string, number>
  byCategory: Record<string, number>
  bySeverity: Record<string, number>
}

export function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  function loadStats() {
    setLoading(true)
    setError(false)
    apiFetch<Stats>('/v1/admin/stats').then((res) => {
      if (res.ok && res.data) setStats(res.data)
      else setError(true)
    }).catch(() => setError(true)).finally(() => setLoading(false))
  }

  useEffect(() => { loadStats() }, [])

  if (loading) return <Loading text="Loading dashboard..." />
  if (error) return <ErrorAlert message="Failed to load dashboard stats." onRetry={loadStats} />

  if (!stats || stats.total === 0) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <EmptyState
          title="No reports yet"
          description="Reports will appear here once users start submitting feedback through the SDK."
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Dashboard">
        <Link to="/reports" className="text-xs text-brand hover:text-brand-hover transition-colors">
          View all reports &rarr;
        </Link>
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-5">
        <StatCard label="Total Reports" value={stats.total} />
        <StatCard label="New" value={stats.byStatus['new'] ?? 0} accent="text-warn" />
        <StatCard label="Classified" value={stats.byStatus['classified'] ?? 0} accent="text-ok" />
        <StatCard label="Dismissed" value={stats.byStatus['dismissed'] ?? 0} accent="text-fg-muted" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="p-3">
          <h3 className="text-xs font-medium text-fg-muted mb-2.5 uppercase tracking-wider">By Category</h3>
          <div className="space-y-1.5">
            {Object.entries(stats.byCategory).map(([cat, count]) => (
              <div key={cat} className="flex items-center justify-between">
                <span className="text-xs text-fg-secondary">{CATEGORY_LABELS[cat] ?? cat}</span>
                <span className="text-xs font-mono tabular-nums text-fg-muted">{count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-3">
          <h3 className="text-xs font-medium text-fg-muted mb-2.5 uppercase tracking-wider">By Severity</h3>
          <div className="space-y-1.5">
            {['critical', 'high', 'medium', 'low'].some((sev) => (stats.bySeverity[sev] ?? 0) > 0) ? (
              ['critical', 'high', 'medium', 'low'].map((sev) => {
                const count = stats.bySeverity[sev] ?? 0
                if (count === 0) return null
                return (
                  <div key={sev} className="flex items-center justify-between">
                    <Badge className={SEVERITY[sev]}>{sev}</Badge>
                    <span className="text-xs font-mono tabular-nums text-fg-muted">{count}</span>
                  </div>
                )
              })
            ) : (
              <p className="text-2xs text-fg-faint">No severity data — triage reports to assign severity levels.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
