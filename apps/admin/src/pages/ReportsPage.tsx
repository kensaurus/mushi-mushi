import { Link, useSearchParams } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import { SEVERITY, STATUS, FILTER_OPTIONS, statusLabel, severityLabel } from '../lib/tokens'
import { PageHeader, PageHelp, Badge, Card, FilterSelect, EmptyState, Loading, ErrorAlert, RecommendedAction } from '../components/ui'

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

  const status = searchParams.get('status') ?? ''
  const category = searchParams.get('category') ?? ''
  const severity = searchParams.get('severity') ?? ''
  const component = searchParams.get('component') ?? ''
  const reporter = searchParams.get('reporter') ?? ''

  const queryString = (() => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (category) params.set('category', category)
    if (severity) params.set('severity', severity)
    if (component) params.set('component', component)
    if (reporter) params.set('reporter', reporter)
    return params.toString()
  })()

  const { data, loading, error, reload } = usePageData<{ reports: ReportRow[]; total: number }>(
    `/v1/admin/reports${queryString ? `?${queryString}` : ''}`,
    { deps: [queryString] },
  )

  const reports = data?.reports ?? []
  const total = data?.total ?? 0

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next)
  }

  const clearFilter = (key: string) => setFilter(key, '')

  const contextChips: Array<{ key: string; label: string; value: string }> = []
  if (component) contextChips.push({ key: 'component', label: 'Component', value: component })
  if (reporter) contextChips.push({ key: 'reporter', label: 'Reporter', value: `${reporter.slice(0, 12)}…` })

  const hasFilters = Boolean(status || category || severity || component || reporter)
  const queuedCount = reports.filter((r) => r.status === 'queued').length
  const criticalQueuedCount = reports.filter((r) => r.status === 'queued' && r.severity === 'critical').length

  const recommendation = (() => {
    if (loading || error) return null
    if (total === 0 && !hasFilters) {
      return {
        title: 'No reports yet',
        description: 'Install the SDK in your app and trigger a test report to see the pipeline come alive.',
        cta: { label: 'Open setup wizard', to: '/onboarding' },
        tone: 'info' as const,
      }
    }
    if (criticalQueuedCount > 0) {
      return {
        title: `${criticalQueuedCount} critical ${criticalQueuedCount === 1 ? 'report' : 'reports'} need triage`,
        description: 'High-severity reports are still queued. Open them to confirm classification and dispatch a fix.',
        cta: {
          label: 'Show critical queued',
          onClick: () => {
            const next = new URLSearchParams(searchParams)
            next.set('status', 'queued')
            next.set('severity', 'critical')
            setSearchParams(next)
          },
        },
        tone: 'urgent' as const,
      }
    }
    if (queuedCount > 0 && status !== 'queued') {
      return {
        title: `${queuedCount} ${queuedCount === 1 ? 'report is' : 'reports are'} waiting for triage`,
        description: 'Filter to the queued bucket to confirm classification and decide who fixes them.',
        cta: {
          label: 'Filter to queued',
          onClick: () => setFilter('status', 'queued'),
        },
        tone: 'info' as const,
      }
    }
    return null
  })()

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

      {recommendation && (
        <RecommendedAction
          title={recommendation.title}
          description={recommendation.description}
          cta={recommendation.cta}
          tone={recommendation.tone}
        />
      )}

      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <FilterSelect label="Status" value={status} options={FILTER_OPTIONS.statuses} onChange={(e) => setFilter('status', e.currentTarget.value)} />
        <FilterSelect label="Category" value={category} options={FILTER_OPTIONS.categories} onChange={(e) => setFilter('category', e.currentTarget.value)} />
        <FilterSelect label="Severity" value={severity} options={FILTER_OPTIONS.severities} onChange={(e) => setFilter('severity', e.currentTarget.value)} />
        {contextChips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => clearFilter(chip.key)}
            className="inline-flex items-center gap-1.5 rounded-sm border border-accent/30 bg-accent-muted/30 px-2 py-1 text-2xs text-accent hover:bg-accent-muted/50 motion-safe:transition-colors"
            title={`Clear ${chip.label} filter`}
          >
            <span className="font-medium">{chip.label}:</span>
            <span className="font-mono">{chip.value}</span>
            <span aria-hidden="true" className="text-fg-faint">×</span>
          </button>
        ))}
      </div>

      {loading ? (
        <Loading text="Loading reports..." />
      ) : error ? (
        <ErrorAlert message={`Failed to load reports: ${error}`} onRetry={reload} />
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
                    <Badge className={STATUS[report.status] ?? 'text-fg-muted border border-edge'}>{statusLabel(report.status)}</Badge>
                    {report.severity && (
                      <Badge className={SEVERITY[report.severity] ?? ''}>{severityLabel(report.severity)}</Badge>
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
