import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useSetupStatus } from '../lib/useSetupStatus'
import { SEVERITY, CATEGORY_LABELS } from '../lib/tokens'
import { PageHeader, PageHelp, Card, Badge, Btn, Loading, ErrorAlert } from '../components/ui'
import { ConnectionStatus } from '../components/ConnectionStatus'
import { SetupChecklist } from '../components/SetupChecklist'
import { useToast } from '../lib/toast'
import {
  KpiTile,
  SeverityStackedBars,
  LineSparkline,
  HealthPill,
  StatusPill,
  formatTokens,
  type KpiTileProps,
} from '../components/charts'

interface ReportDay {
  day: string
  total: number
  critical: number
  high: number
  medium: number
  low: number
  unscored: number
}

interface LlmDay {
  day: string
  calls: number
  tokens: number
  latencyMs: number
  failures: number
}

interface FixSummary {
  total: number
  completed: number
  failed: number
  inProgress: number
  openPrs: number
}

interface IntegrationStatus {
  kind: string
  lastStatus: string | null
  lastAt: string | null
  uptime: number | null
}

interface ActivityItem {
  kind: 'report' | 'fix'
  id: string
  label: string
  meta: string | null
  at: string
}

interface TriageItem {
  id: string
  summary: string
  severity: string | null
  category: string | null
  status: string | null
  created_at: string
}

interface DashboardData {
  empty: boolean
  projects?: Array<{ id: string; name: string }>
  window?: { days: string[]; since: string }
  counts?: {
    reports14d: number
    openBacklog: number
    fixesTotal: number
    openPrs: number
    llmCalls14d: number
    llmTokens14d: number
    llmFailures14d: number
  }
  reportsByDay?: ReportDay[]
  llmByDay?: LlmDay[]
  fixSummary?: FixSummary
  topComponents?: Array<{ component: string; count: number }>
  triageQueue?: TriageItem[]
  activity?: ActivityItem[]
  integrations?: IntegrationStatus[]
}

function GettingStartedEmpty() {
  const navigate = useNavigate()
  const toast = useToast()
  const setup = useSetupStatus()
  const [testStatus, setTestStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle')

  if (setup.loading) return <Loading text="Checking your account..." />

  // First-time visitors with no project at all are sent to the wizard. Once at
  // least one project + key exists, the dashboard takes over and the redirect
  // stops happening — the SetupChecklist banner finishes the journey inline.
  if (!setup.hasAnyProject) return <Navigate to="/onboarding" replace />

  const project = setup.activeProject
  if (!project) return <Loading text="Loading projects..." />

  async function submitTest() {
    if (!project) return
    setTestStatus('running')
    const res = await apiFetch(`/v1/admin/projects/${project.project_id}/test-report`, { method: 'POST' })
    setTestStatus(res.ok ? 'pass' : 'fail')
    if (res.ok) {
      toast.success('Test report queued', 'Watch it land in Reports within a few seconds.')
      setup.reload()
    } else {
      toast.error('Test report failed', res.error?.message ?? 'Check your project keys and try again.')
    }
  }

  const hasKey = !setup.isStepIncomplete('api_key_generated')

  return (
    <div>
      <PageHeader title="Dashboard" description="Welcome to Mushi Mushi. Finish setup to start receiving reports." />
      <SetupChecklist project={project} mode="banner" onRefresh={setup.reload} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Card className="p-4">
          <h4 className="text-xs font-semibold text-fg mb-1">Install the SDK</h4>
          <p className="text-2xs text-fg-muted mb-3">Add the Mushi Mushi widget to your app in under 5 minutes.</p>
          <Btn size="sm" onClick={() => navigate('/onboarding')}>Setup guide</Btn>
        </Card>
        <Card className="p-4">
          <h4 className="text-xs font-semibold text-fg mb-1">Submit a test report</h4>
          <p className="text-2xs text-fg-muted mb-3">Send a test report to verify your pipeline works end-to-end.</p>
          <Btn size="sm" variant={testStatus === 'pass' ? 'ghost' : 'primary'} disabled={!hasKey || testStatus === 'running'} onClick={submitTest}>
            {testStatus === 'running' ? 'Sending…' : testStatus === 'pass' ? '✓ Sent' : 'Send test report'}
          </Btn>
          {testStatus === 'fail' && <p className="text-2xs text-danger mt-1">Failed — check connection.</p>}
        </Card>
      </div>
      <Card className="p-4">
        <ConnectionStatus />
      </Card>
      <div className="mt-4 text-2xs text-fg-faint space-y-0.5">
        <p>
          Project: <span className="font-mono text-fg-secondary">{project.project_name}</span>{' '}
          <span className="font-mono">({project.project_id})</span>
        </p>
        <p>
          {project.report_count} report{project.report_count === 1 ? '' : 's'} · {project.fix_count} fix{project.fix_count === 1 ? '' : 'es'} dispatched
        </p>
      </div>
    </div>
  )
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

export function DashboardPage() {
  const { data, loading, error, reload } = usePageData<DashboardData>('/v1/admin/dashboard')
  const setup = useSetupStatus()

  // 7d vs prior-7d delta on report intake. Direction is the actual change;
  // tone reflects whether that change is good for ops (more reports = warn).
  const intakeDelta = useMemo((): KpiTileProps['delta'] => {
    if (!data?.reportsByDay || data.reportsByDay.length < 14) return null
    const last7 = data.reportsByDay.slice(-7).reduce((a, d) => a + d.total, 0)
    const prev7 = data.reportsByDay.slice(0, 7).reduce((a, d) => a + d.total, 0)
    if (prev7 === 0 && last7 === 0) return null
    if (prev7 === 0) return { value: 'new', direction: 'up', tone: 'warn' }
    const pct = Math.round(((last7 - prev7) / prev7) * 100)
    if (pct === 0) return { value: '0%', direction: 'flat', tone: 'muted' }
    return {
      value: `${Math.abs(pct)}%`,
      direction: pct > 0 ? 'up' : 'down',
      tone: pct > 0 ? 'warn' : 'ok',
    }
  }, [data])

  if (loading) return <Loading text="Loading dashboard..." />
  if (error) return <ErrorAlert message={error} onRetry={reload} />
  if (!data || data.empty) return <GettingStartedEmpty />

  const counts = data.counts!
  const reportsByDay = data.reportsByDay ?? []
  const llmByDay = data.llmByDay ?? []
  const fixSummary = data.fixSummary!
  const topComponents = data.topComponents ?? []
  const triageQueue = data.triageQueue ?? []
  const activity = data.activity ?? []
  const integrations = data.integrations ?? []

  return (
    <div>
      <PageHeader title="Dashboard">
        <Btn size="sm" variant="ghost" onClick={reload}>Refresh</Btn>
        <Link to="/reports" className="text-xs text-brand hover:text-brand-hover">View all reports →</Link>
      </PageHeader>

      <PageHelp
        title="About the Dashboard"
        whatIsIt="14-day operational view of bug intake, LLM cost, auto-fix pipeline, integration health, and the triage queue. Every tile links to the page where you can act on it."
        useCases={[
          'See whether report intake is rising or falling vs the prior week',
          'Catch a backlog of un-triaged reports before users complain',
          'Spot a regression in LLM cost or failure rate after a prompt change',
          'Jump into the highest-priority report that needs review',
        ]}
        howToUse="Click any KPI or row to drill in. Hover the chart bars for per-day totals."
      />

      {setup.activeProject && (
        <SetupChecklist project={setup.activeProject} mode="banner" onRefresh={setup.reload} />
      )}

      <QuotaBanner />

      {/* Top row — clickable KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
        <KpiTile
          label="Reports (14d)"
          value={counts.reports14d}
          sublabel="all severities"
          to="/reports"
          accent="brand"
          delta={intakeDelta}
        />
        <KpiTile
          label="Triage backlog"
          value={counts.openBacklog}
          sublabel="open > 1h"
          to="/reports?status=new"
          accent={counts.openBacklog > 0 ? 'warn' : 'ok'}
        />
        <KpiTile
          label="Auto-fix PRs"
          value={counts.openPrs}
          sublabel={`${fixSummary.inProgress} in progress · ${fixSummary.failed} failed`}
          to="/fixes"
          accent={fixSummary.failed > 0 ? 'danger' : counts.openPrs > 0 ? 'ok' : 'muted'}
        />
        <KpiTile
          label="LLM tokens (14d)"
          value={formatTokens(counts.llmTokens14d)}
          sublabel={`${counts.llmCalls14d} calls · ${counts.llmFailures14d} failed`}
          to="/health"
          accent={counts.llmFailures14d > 0 ? 'warn' : 'ok'}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Report intake (14d)</h3>
            <Link to="/reports" className="text-2xs text-brand hover:text-brand-hover">All reports →</Link>
          </div>
          <SeverityStackedBars data={reportsByDay} />
        </Card>

        <Card className="p-3">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">LLM activity (14d)</h3>
            <Link to="/health" className="text-2xs text-brand hover:text-brand-hover">Health →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-2xs text-fg-muted">Tokens / day</div>
              <LineSparkline values={llmByDay.map(d => d.tokens)} />
              <div className="text-3xs font-mono text-fg-faint mt-0.5">peak {formatTokens(Math.max(0, ...llmByDay.map(d => d.tokens)))}</div>
            </div>
            <div>
              <div className="text-2xs text-fg-muted">Calls / day</div>
              <LineSparkline values={llmByDay.map(d => d.calls)} accent="text-info" />
              <div className="text-3xs font-mono text-fg-faint mt-0.5">{counts.llmCalls14d} total</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Row 3 — triage + auto-fix pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        {/* Triage queue */}
        <Card className="p-3 lg:col-span-2">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Triage queue</h3>
            <Link to="/reports?status=new" className="text-2xs text-brand hover:text-brand-hover">View backlog →</Link>
          </div>
          {triageQueue.length === 0 ? (
            <p className="text-2xs text-fg-faint py-4 text-center">All caught up — no untriaged reports.</p>
          ) : (
            <div className="space-y-1">
              {triageQueue.map(r => (
                <Link
                  key={r.id}
                  to={`/reports/${r.id}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-surface-overlay/50 transition-colors group"
                >
                  <StatusPill status={r.status} />
                  {r.severity && <Badge className={SEVERITY[r.severity] ?? 'bg-fg-faint/15 text-fg-muted'}>{r.severity}</Badge>}
                  <span className="text-xs text-fg-secondary group-hover:text-fg flex-1 truncate">{r.summary}</span>
                  <span className="text-3xs font-mono text-fg-faint shrink-0">{relTime(r.created_at)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* Auto-fix pipeline */}
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Auto-fix</h3>
            <Link to="/fixes" className="text-2xs text-brand hover:text-brand-hover">All →</Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FixStat label="Total" value={fixSummary.total} />
            <FixStat label="Open PRs" value={fixSummary.openPrs} accent="text-ok" />
            <FixStat label="In progress" value={fixSummary.inProgress} accent="text-info" />
            <FixStat label="Failed" value={fixSummary.failed} accent={fixSummary.failed > 0 ? 'text-danger' : undefined} />
          </div>
          <div className="mt-3 pt-3 border-t border-edge-subtle">
            <Link to="/fixes" className="text-2xs text-fg-muted hover:text-fg">
              {fixSummary.openPrs > 0
                ? `${fixSummary.openPrs} draft PR${fixSummary.openPrs === 1 ? '' : 's'} ready for review →`
                : 'Dispatch a fix from a report →'}
            </Link>
          </div>
        </Card>
      </div>

      {/* Row 4 — top components, integrations, recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        {/* Top components */}
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Top components</h3>
            <Link to="/graph" className="text-2xs text-brand hover:text-brand-hover">Graph →</Link>
          </div>
          {topComponents.length === 0 ? (
            <p className="text-2xs text-fg-faint">No component data yet.</p>
          ) : (
            <div className="space-y-1.5">
              {topComponents.map(({ component, count }) => {
                const max = topComponents[0]?.count ?? 1
                const pct = (count / max) * 100
                return (
                  <Link
                    key={component}
                    to={`/reports?component=${encodeURIComponent(component)}`}
                    className="block group"
                  >
                    <div className="flex items-center justify-between text-2xs mb-0.5">
                      <span className="text-fg-secondary group-hover:text-fg truncate" title={component}>{component}</span>
                      <span className="font-mono text-fg-muted shrink-0 ml-2">{count}</span>
                    </div>
                    <div className="h-1 bg-surface-overlay rounded-sm overflow-hidden">
                      <div className="h-full bg-brand/60 group-hover:bg-brand transition-colors" style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </Card>

        {/* Integration health */}
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Integrations</h3>
            <Link to="/integrations" className="text-2xs text-brand hover:text-brand-hover">Manage →</Link>
          </div>
          {integrations.length === 0 ? (
            <p className="text-2xs text-fg-faint">Configure Sentry, Langfuse, GitHub on the Integrations page.</p>
          ) : (
            <div className="space-y-2">
              {integrations.map(it => (
                <Link
                  key={it.kind}
                  to="/integrations"
                  className="flex items-center justify-between gap-2 hover:bg-surface-overlay/50 rounded-sm px-1.5 py-1 transition-colors"
                >
                  <span className="text-xs text-fg-secondary capitalize">{it.kind}</span>
                  <div className="flex items-center gap-2">
                    {it.uptime != null && (
                      <span className="text-3xs font-mono text-fg-muted">{(it.uptime * 100).toFixed(0)}% up</span>
                    )}
                    <HealthPill status={it.lastStatus} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* Recent activity */}
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Recent activity</h3>
          </div>
          {activity.length === 0 ? (
            <p className="text-2xs text-fg-faint">Nothing in the last 14 days.</p>
          ) : (
            <div className="space-y-1">
              {activity.map((a, i) => (
                <Link
                  key={`${a.kind}-${a.id}-${i}`}
                  to={a.kind === 'fix' ? '/fixes' : `/reports/${a.id}`}
                  className="flex items-center gap-2 py-1 px-1.5 rounded-sm hover:bg-surface-overlay/50 transition-colors group"
                >
                  <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${a.kind === 'fix' ? 'bg-brand' : 'bg-info'}`} />
                  <span className="text-2xs text-fg-secondary group-hover:text-fg flex-1 truncate">{a.label}</span>
                  <span className="text-3xs font-mono text-fg-faint shrink-0">{relTime(a.at)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Category quick-filters — clickable shortcuts into Reports filtered by category */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Quick filters</h3>
          <Link to="/reports" className="text-2xs text-brand hover:text-brand-hover">All filters →</Link>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(CATEGORY_LABELS).map(cat => (
            <Link
              key={cat}
              to={`/reports?category=${cat}`}
              className="text-2xs px-2 py-1 rounded-sm bg-surface-overlay/50 text-fg-secondary hover:bg-surface-overlay hover:text-fg transition-colors border border-edge-subtle"
            >
              {CATEGORY_LABELS[cat]}
            </Link>
          ))}
          {(['critical', 'high', 'medium', 'low'] as const).map(sev => (
            <Link
              key={sev}
              to={`/reports?severity=${sev}`}
              className={`text-2xs px-2 py-1 rounded-sm border transition-colors ${SEVERITY[sev] ?? ''} hover:brightness-110`}
            >
              {sev}
            </Link>
          ))}
        </div>
      </Card>
    </div>
  )
}

function FixStat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-surface-overlay/40 rounded-sm px-2 py-1.5 border border-edge-subtle">
      <div className="text-3xs text-fg-muted uppercase tracking-wider">{label}</div>
      <div className={`text-base font-semibold font-mono ${accent ?? 'text-fg'}`}>{value}</div>
    </div>
  )
}

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

// Compact quota strip surfaced above the dashboard KPIs. Highlights any
// project that is approaching or over its free-tier monthly report quota
// so admins can upgrade before ingest gets HTTP 402'd. Free-tier projects
// under 50% usage are hidden to keep the dashboard quiet.
function QuotaBanner() {
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
        const border = tone === 'danger' ? 'border-danger/40' : tone === 'warn' ? 'border-warn/40' : 'border-edge-subtle'
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
                <div className="h-1 bg-surface-overlay rounded-sm overflow-hidden mt-1" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
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
