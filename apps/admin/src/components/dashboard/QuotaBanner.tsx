/**
 * FILE: apps/admin/src/components/dashboard/QuotaBanner.tsx
 * PURPOSE: Compact quota strip surfaced above the dashboard KPIs. Highlights
 *          any project approaching or over its free-tier monthly report
 *          quota so admins can upgrade before ingest gets HTTP 402'd. Free
 *          projects under 50% usage are hidden to keep the dashboard quiet.
 */

import { Link } from 'react-router-dom'
import { Card, Badge } from '../ui'
import { usePageData } from '../../lib/usePageData'

interface QuotaProject {
  project_id: string
  project_name: string
  plan: string
  usage: { reports: number }
  limit_reports: number | null
  over_quota: boolean
}

interface QuotaResponse {
  projects: QuotaProject[]
  free_limit_reports_per_month: number
}

export function QuotaBanner() {
  const { data, loading, error } = usePageData<QuotaResponse>('/v1/admin/billing')
  if (loading || error || !data) return null

  const visible = data.projects
    .filter((p) => {
      if (p.limit_reports == null) return false
      const pct = (p.usage.reports / Math.max(1, p.limit_reports)) * 100
      return pct >= 50
    })
    .sort((a, b) => {
      const pa = a.usage.reports / Math.max(1, a.limit_reports ?? 1)
      const pb = b.usage.reports / Math.max(1, b.limit_reports ?? 1)
      return pb - pa
    })

  if (visible.length === 0) return null

  return (
    <div className="space-y-1.5 mb-4" role="status" aria-label="Project quota status">
      {visible.map((p) => {
        const limit = p.limit_reports!
        const pct = Math.min(100, Math.round((p.usage.reports / Math.max(1, limit)) * 100))
        const tone = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'ok'
        const bar = tone === 'danger' ? 'bg-danger' : tone === 'warn' ? 'bg-warn' : 'bg-ok'
        const border =
          tone === 'danger'
            ? 'border-danger/40'
            : tone === 'warn'
              ? 'border-warn/40'
              : 'border-edge-subtle'
        return (
          <Card key={p.project_id} className={`p-2 border ${border}`}>
            <div className="flex items-center justify-between gap-2 text-2xs">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-fg-secondary truncate">{p.project_name}</span>
                  {p.over_quota ? (
                    <Badge className="bg-danger-subtle text-danger">Over quota</Badge>
                  ) : pct >= 80 ? (
                    <Badge className="bg-warn/10 text-warn">{pct}% of free quota</Badge>
                  ) : (
                    <Badge className="bg-surface-overlay text-fg-muted">{pct}% of free quota</Badge>
                  )}
                </div>
                <div
                  className="h-1 bg-surface-overlay rounded-sm overflow-hidden mt-1"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className={`h-full ${bar}`} style={{ width: `${Math.max(2, pct)}%` }} />
                </div>
                <p className="text-3xs text-fg-faint mt-0.5 font-mono">
                  {p.usage.reports.toLocaleString()} / {limit.toLocaleString()} reports this month
                </p>
              </div>
              <Link to="/billing" className="text-2xs text-brand hover:text-brand-hover shrink-0">
                Manage →
              </Link>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
