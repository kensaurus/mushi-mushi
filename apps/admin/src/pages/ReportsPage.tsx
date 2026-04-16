import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { SEVERITY, STATUS, FILTER_OPTIONS } from '../lib/tokens'
import { PageHeader, PageHelp, Badge, Card, FilterSelect, EmptyState, Loading, ErrorAlert } from '../components/ui'

interface ReportRow {
  id: string
  project_id: string
  description: string
  category: string
  severity: string | null
  summary: string | null
  status: string
  created_at: string
  user_category: string
  confidence: number | null
  component: string | null
}

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [reports, setReports] = useState<ReportRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  const status = searchParams.get('status') ?? ''
  const category = searchParams.get('category') ?? ''
  const severity = searchParams.get('severity') ?? ''

  useEffect(() => {
    setLoading(true)
    setError(false)
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (category) params.set('category', category)
    if (severity) params.set('severity', severity)

    apiFetch<{ reports: ReportRow[]; total: number }>(`/v1/admin/reports?${params}`)
      .then((res) => {
        if (res.ok && res.data) {
          setReports(res.data.reports)
          setTotal(res.data.total)
        } else {
          setError(true)
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [status, category, severity, retryKey])

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next)
  }

  return (
    <div>
      <PageHeader title="Reports">
        <span className="text-xs text-fg-muted font-mono tabular-nums">{total} total</span>
      </PageHeader>

      <PageHelp
        title="About Reports"
        whatIsIt="The full inbox of bug reports submitted from your apps, games, or websites. Each report is auto-classified by the LLM pipeline with a category, severity, component, and confidence score."
        useCases={[
          'Triage incoming bugs by status, category, or severity',
          'Drill into a specific report to see the original payload, attachments, and pipeline history',
          'Confirm or override the LLM classification (which feeds back into fine-tuning)',
        ]}
        howToUse="Use the filters above to narrow the list. Click any row to open the report detail view with full pipeline context and actions."
      />

      <div className="flex gap-2 mb-3 flex-wrap">
        <FilterSelect label="Status" value={status} options={FILTER_OPTIONS.statuses} onChange={(e) => setFilter('status', e.currentTarget.value)} />
        <FilterSelect label="Category" value={category} options={FILTER_OPTIONS.categories} onChange={(e) => setFilter('category', e.currentTarget.value)} />
        <FilterSelect label="Severity" value={severity} options={FILTER_OPTIONS.severities} onChange={(e) => setFilter('severity', e.currentTarget.value)} />
      </div>

      {loading ? (
        <Loading text="Loading reports..." />
      ) : error ? (
        <ErrorAlert message="Failed to load reports." onRetry={() => setRetryKey(k => k + 1)} />
      ) : reports.length === 0 ? (
        <EmptyState title="No reports match the selected filters." />
      ) : (
        <div className="space-y-1">
          {reports.map((report) => (
            <Link
              key={report.id}
              to={`/reports/${report.id}`}
              className="block"
            >
              <Card interactive className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-fg-secondary truncate">
                      {report.summary ?? report.description}
                    </p>
                    {report.component && (
                      <p className="text-2xs text-fg-faint mt-px font-mono">{report.component}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Badge className={STATUS[report.status] ?? 'text-fg-muted border border-edge'}>{report.status}</Badge>
                    {report.severity && (
                      <Badge className={SEVERITY[report.severity] ?? ''}>{report.severity}</Badge>
                    )}
                    <span className="text-2xs text-fg-faint tabular-nums font-mono ml-1">
                      {new Date(report.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
