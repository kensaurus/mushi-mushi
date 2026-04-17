import { useEffect, useState } from 'react'
import { apiFetch, supabase } from '../lib/supabase'
import { RESOLVED_API_URL } from '../lib/env'
import { PageHeader, PageHelp, Card, Btn, Loading, ErrorAlert, EmptyState, Toggle } from '../components/ui'

interface IntelligenceReport {
  id: string
  project_id: string
  week_start: string
  summary_md: string
  stats: {
    reports?: { total?: number; byCategory?: Record<string, number>; bySeverity?: Record<string, number> }
    fixes?: { total?: number; completed?: number; completionRate?: number; avgDurationSeconds?: number | null }
  } | null
  benchmarks: { optedIn?: boolean; reason?: string; buckets?: unknown[] } | null
  llm_model: string | null
  generated_by: string
  created_at: string
}

interface BenchmarkSettings {
  optIn: boolean
  optInAt: string | null
}

export function IntelligencePage() {
  const [reports, setReports] = useState<IntelligenceReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [benchmark, setBenchmark] = useState<BenchmarkSettings>({ optIn: false, optInAt: null })

  const fetchData = async () => {
    setLoading(true)
    setError(false)
    const [reportsRes, settingsRes] = await Promise.all([
      apiFetch<{ reports: IntelligenceReport[] }>('/v1/admin/intelligence'),
      apiFetch<{ benchmarking_optin?: boolean; benchmarking_optin_at?: string | null }>('/v1/admin/settings'),
    ])
    if (reportsRes.ok && reportsRes.data) setReports(reportsRes.data.reports)
    else setError(true)
    if (settingsRes.ok && settingsRes.data) {
      setBenchmark({
        optIn: settingsRes.data.benchmarking_optin === true,
        optInAt: settingsRes.data.benchmarking_optin_at ?? null,
      })
    }
    setLoading(false)
  }

  useEffect(() => { void fetchData() }, [])

  const generateNow = async () => {
    setGenerating(true)
    try {
      await apiFetch('/v1/admin/intelligence', { method: 'POST' })
      await fetchData()
    } finally {
      setGenerating(false)
    }
  }

  const toggleOptIn = async (next: boolean) => {
    // Snapshot the whole state — restoring only the boolean would clobber
    // optInAt, breaking the "Opted in {date}" display when the call fails.
    const prev = benchmark
    setBenchmark({ optIn: next, optInAt: next ? new Date().toISOString() : null })
    const res = await apiFetch('/v1/admin/settings/benchmarking', {
      method: 'PUT',
      body: JSON.stringify({ optIn: next }),
    })
    if (!res.ok) {
      setBenchmark(prev)
      alert('Failed to update benchmarking opt-in.')
    }
  }

  const downloadPdf = async (id: string, weekStart: string) => {
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      if (!token) {
        alert('Not authenticated.')
        return
      }
      const res = await fetch(`${RESOLVED_API_URL}/v1/admin/intelligence/${id}/html`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        alert(`Failed to load report (${res.status}).`)
        return
      }
      const html = await res.text()
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const win = window.open(url, '_blank')
      if (!win) {
        const a = document.createElement('a')
        a.href = url
        a.download = `bug-intelligence-${weekStart}.html`
        a.click()
      } else {
        // Wait for content to load, then trigger print so the user can save as PDF.
        win.addEventListener('load', () => setTimeout(() => win.print(), 200))
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      alert(`Could not open report: ${String(e)}`)
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader title="Bug Intelligence">
        <Btn onClick={generateNow} disabled={generating}>
          {generating ? 'Generating…' : 'Generate this week'}
        </Btn>
      </PageHeader>

      <PageHelp
        title="About Bug Intelligence"
        whatIsIt="Weekly LLM-authored digest of your bug pipeline — trends, fix velocity, hotspots, and recommendations. Each report is persisted, versioned, and exportable as PDF."
        useCases={[
          'Share a one-page status with stakeholders every Monday',
          'Spot regressions early — week-over-week category and severity drift',
          'Compare your fix velocity against anonymised industry benchmarks (opt-in)',
        ]}
        howToUse="Reports are generated automatically by the cron job every Monday. Click Generate to run for the current week on demand. Click Download PDF to open a printable view — your browser's print dialog handles the actual PDF export."
      />

      <Card className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-fg uppercase tracking-wider mb-1">Cross-customer benchmarking</div>
            <p className="text-2xs text-fg-muted max-w-xl leading-relaxed">
              Opt in to share aggregated, anonymised report metrics with other Mushi Mushi tenants. We enforce
              k-anonymity (≥ 5 contributing projects per bucket) — no project IDs, names, or report content
              ever leak. Opt out any time.
              {benchmark.optInAt && (
                <span className="block mt-1 text-fg-faint">
                  Opted in {new Date(benchmark.optInAt).toLocaleString()}.
                </span>
              )}
            </p>
          </div>
          <Toggle checked={benchmark.optIn} onChange={toggleOptIn} label={benchmark.optIn ? 'Sharing on' : 'Sharing off'} />
        </div>
      </Card>

      {loading ? <Loading /> : error ? <ErrorAlert message="Failed to load intelligence reports." onRetry={fetchData} /> : reports.length === 0 ? (
        <EmptyState
          title="No intelligence reports yet"
          description="Reports are generated weekly by the cron job. Click Generate above to produce one immediately."
        />
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <Card key={r.id} className="p-3">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-xs font-medium text-fg">Week of {r.week_start}</span>
                  <span className="text-2xs text-fg-faint">{r.generated_by}</span>
                  {r.benchmarks?.optedIn && (
                    <span className="text-2xs text-success">benchmarks ✓</span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <Btn size="sm" variant="ghost" onClick={() => downloadPdf(r.id, r.week_start)}>
                    Download PDF
                  </Btn>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-2xs">
                <Stat label="Reports" value={r.stats?.reports?.total?.toString() ?? '—'} />
                <Stat label="Fix attempts" value={r.stats?.fixes?.total?.toString() ?? '—'} />
                <Stat
                  label="Completion"
                  value={
                    r.stats?.fixes?.completionRate != null
                      ? `${Math.round(r.stats.fixes.completionRate * 100)}%`
                      : '—'
                  }
                />
                <Stat
                  label="Avg fix"
                  value={
                    r.stats?.fixes?.avgDurationSeconds != null && r.stats.fixes.avgDurationSeconds > 0
                      ? `${(r.stats.fixes.avgDurationSeconds / 60).toFixed(1)} min`
                      : '—'
                  }
                />
              </div>

              <details className="group">
                <summary className="cursor-pointer text-2xs text-fg-muted hover:text-fg-secondary">
                  Read summary
                </summary>
                <div className="mt-2 p-2 rounded-sm bg-surface-raised/50 border border-edge-subtle text-xs text-fg-secondary whitespace-pre-wrap leading-relaxed">
                  {r.summary_md}
                </div>
              </details>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-fg-faint">{label}</div>
      <div className="text-fg font-mono tabular-nums">{value}</div>
    </div>
  )
}
