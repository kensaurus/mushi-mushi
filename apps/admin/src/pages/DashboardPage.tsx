import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { SEVERITY, CATEGORY_LABELS } from '../lib/tokens'
import { PageHeader, PageHelp, StatCard, Card, Badge, Btn, Loading } from '../components/ui'
import { ConnectionStatus } from '../components/ConnectionStatus'

interface Stats {
  total: number
  byStatus: Record<string, number>
  byCategory: Record<string, number>
  bySeverity: Record<string, number>
}

interface Project {
  id: string
  name: string
  api_keys?: Array<{ key_prefix: string }>
}

function GettingStartedEmpty() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [testStatus, setTestStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle')

  useEffect(() => {
    apiFetch<{ projects: Project[] }>('/v1/admin/projects').then((res) => {
      if (res.ok && res.data) setProjects(res.data.projects ?? [])
    })
  }, [])

  const hasProject = projects.length > 0
  const hasKey = projects.some((p) => p.api_keys && p.api_keys.length > 0)
  const onboardingDone = localStorage.getItem('mushi:onboarding_completed') === 'true'

  if (!onboardingDone && !hasProject) {
    return <Navigate to="/onboarding" replace />
  }

  async function submitTest() {
    setTestStatus('running')
    const res = await apiFetch('/v1/reports', {
      method: 'POST',
      body: JSON.stringify({
        projectId: projects[0]?.id ?? '',
        description: 'Dashboard test report — verifying pipeline',
        category: 'other',
        environment: { url: 'admin://dashboard-test', browser: 'mushi-admin', userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language, viewport: { width: window.innerWidth, height: window.innerHeight }, referrer: '', timestamp: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        reporterToken: 'dashboard-test',
      }),
    })
    setTestStatus(res.ok ? 'pass' : 'fail')
  }

  return (
    <div>
      <PageHeader title="Dashboard" description="Welcome to Mushi Mushi. Here's how to get your first report." />

      {/* Getting Started checklist */}
      <Card className="p-4 mb-4">
        <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider mb-3">Getting Started</h3>
        <div className="space-y-2">
          <ChecklistItem done={hasProject} label="Create a project" action={!hasProject ? () => navigate('/projects') : undefined} />
          <ChecklistItem done={hasKey} label="Generate an API key" action={!hasKey && hasProject ? () => navigate('/projects') : undefined} />
          <ChecklistItem done={false} label="Install the SDK in your app" action={() => navigate('/onboarding')} />
          <ChecklistItem done={false} label="Receive your first bug report" />
        </div>
      </Card>

      {/* Action cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Card className="p-4">
          <h4 className="text-xs font-semibold text-fg mb-1">Install the SDK</h4>
          <p className="text-2xs text-fg-muted mb-3">
            Add the Mushi Mushi widget to your app in under 5 minutes.
          </p>
          <Btn size="sm" onClick={() => navigate('/onboarding')}>Setup guide</Btn>
        </Card>

        <Card className="p-4">
          <h4 className="text-xs font-semibold text-fg mb-1">Submit a test report</h4>
          <p className="text-2xs text-fg-muted mb-3">
            Send a test report to verify your pipeline works end-to-end.
          </p>
          <Btn
            size="sm"
            variant={testStatus === 'pass' ? 'ghost' : 'primary'}
            disabled={!hasProject || testStatus === 'running'}
            onClick={submitTest}
          >
            {testStatus === 'running' ? 'Sending…' : testStatus === 'pass' ? '✓ Sent' : 'Send test report'}
          </Btn>
          {testStatus === 'fail' && <p className="text-2xs text-danger mt-1">Failed — check connection.</p>}
        </Card>
      </div>

      {/* Connection health */}
      <Card className="p-4">
        <ConnectionStatus />
      </Card>

      {/* Project reference */}
      {hasProject && (
        <div className="mt-4 text-2xs text-fg-faint space-y-0.5">
          <p>Project: <span className="font-mono text-fg-secondary">{projects[0].name}</span> <span className="font-mono">({projects[0].id})</span></p>
          {hasKey && <p>API Key: <span className="font-mono text-fg-secondary">{projects[0].api_keys![0].key_prefix}...</span></p>}
        </div>
      )}
    </div>
  )
}

function ChecklistItem({ done, label, action }: { done: boolean; label: string; action?: () => void }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`text-sm ${done ? 'text-ok' : 'text-fg-faint'}`}>{done ? '✓' : '○'}</span>
      <span className={`text-xs flex-1 ${done ? 'text-fg-secondary line-through' : 'text-fg'}`}>{label}</span>
      {action && !done && (
        <button onClick={action} className="text-2xs text-brand hover:text-brand-hover">
          Do this →
        </button>
      )}
    </div>
  )
}

export function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  function loadStats() {
    setLoading(true)
    apiFetch<Stats>('/v1/admin/stats').then((res) => {
      if (res.ok && res.data) setStats(res.data)
      else setStats(null)
    }).catch(() => setStats(null)).finally(() => setLoading(false))
  }

  useEffect(() => { loadStats() }, [])

  if (loading) return <Loading text="Loading dashboard..." />

  if (!stats || stats.total === 0) {
    return <GettingStartedEmpty />
  }

  return (
    <div>
      <PageHeader title="Dashboard">
        <Link to="/reports" className="text-xs text-brand hover:text-brand-hover transition-colors">
          View all reports &rarr;
        </Link>
      </PageHeader>

      <PageHelp
        title="About the Dashboard"
        whatIsIt="A high-level snapshot of bug intake across all your projects: total reports, status breakdown, top categories, and severity distribution."
        useCases={[
          'See at a glance whether the pipeline is keeping up with incoming reports',
          'Spot a sudden surge in P0 / P1 bugs after a release',
          'Identify the noisiest category to investigate root causes',
        ]}
        howToUse="Click View all reports for the full inbox, or use the sidebar to drill into Graph, Judge, or Fixes for deeper analysis."
      />

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
