/**
 * CodeHealthPage — Bundle-size trends + god-file / refactor findings.
 *
 * Mirrors FullStackAuditPage structure: same PageHeader / Card / Badge /
 * Section primitives, same apiFetch + useActiveProjectId wiring, same
 * severity-badge vocabulary.
 *
 * Data is pushed from the host repo's CI (yen-yen bundle-budget.yml) via
 * POST /v1/ingest/metrics. This page only reads; it never triggers a scan.
 *
 * Sections:
 *  1. Summary scorecard — error/warn count, max LOC, latest bundle KB
 *  2. Bundle-size trends — bar sparkline per bundle.* metric
 *  3. God-file findings — list of files over the LOC budget
 */

import { useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import {
  Badge,
  Section,
  ErrorAlert,
  EmptyState,
  Btn,
  Card,
} from '../components/ui'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageData } from '../lib/usePageData'
import { BarSparkline } from '../components/charts'

// ── Types (mirrors code-health.ts response shapes) ────────────────────────────

interface TrendPoint {
  ts: string
  value: number
  dimension: string | null
}

interface BundleTrends {
  mobile: Record<string, TrendPoint[]>
  web: TrendPoint[]
  godFileCounts: Record<string, TrendPoint[]>
  maxFileLoc: Record<string, TrendPoint[]>
}

interface GodFileFinding {
  id: string
  rule_id: string
  severity: 'error' | 'warn' | 'info'
  file_path: string | null
  line: number | null
  message: string
  suggested_fix: Record<string, string | number | boolean | null> | null
}

interface CodeHealthSummary {
  error_count: number
  warn_count: number
  max_loc: number | null
  latest_bundle_kb: number | null
}

interface CodeHealthResponse {
  trends: BundleTrends
  godFiles: GodFileFinding[]
  latestRunAt: string | null
  latestRunStatus: string | null
  summary: CodeHealthSummary
}

// ── Severity badge ────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: GodFileFinding['severity'] }) {
  if (severity === 'error')
    return <Badge className="bg-danger-subtle text-danger">Error</Badge>
  if (severity === 'warn')
    return <Badge className="bg-warn-muted/50 text-warning-foreground">Warn</Badge>
  return <Badge className="bg-surface-overlay text-fg-secondary">Info</Badge>
}

// ── Summary scorecard ─────────────────────────────────────────────────────────

function Scorecard({ data }: { data: CodeHealthResponse }) {
  const { summary, latestRunAt, latestRunStatus } = data
  const { error_count, warn_count, max_loc, latest_bundle_kb } = summary
  const overall = error_count > 0 ? 'fail' : warn_count > 0 ? 'warn' : 'pass'

  const overallCls =
    overall === 'fail'
      ? 'border-danger/40 bg-danger-subtle'
      : overall === 'warn'
        ? 'border-warn/40 bg-warn/10'
        : 'border-ok/40 bg-ok-muted'
  const overallLabel =
    overall === 'fail' ? 'Issues found' : overall === 'warn' ? 'Warnings' : 'All clear'
  const overallTextCls =
    overall === 'fail' ? 'text-danger' : overall === 'warn' ? 'text-warn' : 'text-ok'

  return (
    <div className={`rounded-md border px-4 py-3 ${overallCls}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className={`text-sm font-semibold ${overallTextCls}`}>{overallLabel}</p>
          <p className="mt-0.5 text-xs text-fg-secondary">
            {error_count} error{error_count !== 1 ? 's' : ''} ·{' '}
            {warn_count} warning{warn_count !== 1 ? 's' : ''}
            {max_loc != null && <> · largest file: {max_loc.toLocaleString()} LOC</>}
            {latest_bundle_kb != null && (
              <> · latest bundle: {latest_bundle_kb.toFixed(1)} KB gzip</>
            )}
          </p>
        </div>
        <div className="text-right">
          {latestRunAt ? (
            <>
              <p className="text-xs text-fg-faint">
                Last push: {new Date(latestRunAt).toLocaleString()}
              </p>
              <p className="text-xs text-fg-faint">
                Gate:{' '}
                <span
                  className={
                    latestRunStatus === 'fail'
                      ? 'text-danger'
                      : latestRunStatus === 'warn'
                        ? 'text-warn'
                        : 'text-ok'
                  }
                >
                  {latestRunStatus ?? '—'}
                </span>
              </p>
            </>
          ) : (
            <p className="text-xs text-fg-faint">No CI push data yet</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Bundle trend chart ────────────────────────────────────────────────────────

interface BundleSeries {
  label: string
  points: TrendPoint[]
  accent: string
}

function LocTrendChart({ series }: { series: BundleSeries }) {
  const values = series.points.map((p) => p.value)
  const xLabels = series.points.map((p) =>
    new Date(p.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  )

  if (values.length === 0) return null

  const latestVal = values[values.length - 1] ?? 0
  const budget = 2000

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <p className="text-2xs uppercase tracking-wider text-fg-muted">{series.label}</p>
        <span
          className={`text-lg font-semibold tabular-nums ${latestVal >= budget ? 'text-danger' : 'text-fg-primary'}`}
        >
          {Math.round(latestVal).toLocaleString()} LOC
        </span>
        <span className="text-xs text-fg-faint">budget {budget.toLocaleString()}</span>
      </div>
      <BarSparkline
        values={values}
        xLabels={xLabels}
        barTitles={xLabels.map((l, i) => `${l}: ${Math.round(values[i] ?? 0).toLocaleString()} LOC`)}
        height={72}
        accent={series.accent}
        scaleToData
        showAxes
        yAxisCaption="LOC"
        ariaLabel={`${series.label} largest file LOC trend`}
      />
    </div>
  )
}

function BundleTrendChart({ series }: { series: BundleSeries }) {
  const values = series.points.map((p) => p.value)
  const xLabels = series.points.map((p) =>
    new Date(p.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  )

  if (values.length === 0) return null

  const latestVal = values[values.length - 1] ?? 0
  const prevVal = values.length > 1 ? (values[values.length - 2] ?? 0) : null
  const delta = prevVal != null ? latestVal - prevVal : null
  const deltaSign = delta != null && delta > 0 ? '+' : ''
  const deltaCls =
    delta == null ? '' : delta > 0 ? 'text-warn' : delta < 0 ? 'text-ok' : 'text-fg-muted'

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <p className="text-2xs uppercase tracking-wider text-fg-muted">{series.label}</p>
        <span className="text-lg font-semibold tabular-nums text-brand">
          {latestVal.toFixed(1)} KB
        </span>
        {delta != null && (
          <span className={`text-xs tabular-nums ${deltaCls}`}>
            {deltaSign}
            {delta.toFixed(1)} KB vs prev
          </span>
        )}
      </div>
      <BarSparkline
        values={values}
        xLabels={xLabels}
        barTitles={xLabels.map((l, i) => `${l}: ${(values[i] ?? 0).toFixed(1)} KB`)}
        height={72}
        accent={series.accent}
        scaleToData
        showAxes
        yAxisCaption="gzip KB"
        ariaLabel={`${series.label} bundle size trend`}
      />
    </div>
  )
}

// ── God-file findings list ────────────────────────────────────────────────────

function GodFileList({ findings }: { findings: GodFileFinding[] }) {
  const sorted = useMemo(
    () =>
      [...findings].sort((a, b) => {
        const sev = (s: GodFileFinding['severity']) =>
          s === 'error' ? 0 : s === 'warn' ? 1 : 2
        const d = sev(a.severity) - sev(b.severity)
        if (d !== 0) return d
        return (b.line ?? 0) - (a.line ?? 0)
      }),
    [findings],
  )

  if (findings.length === 0) {
    return (
      <div className="rounded-md border border-ok/30 bg-ok-muted/40 px-4 py-3">
        <p className="text-sm font-medium text-ok">All clear</p>
        <p className="mt-0.5 text-xs text-fg-secondary">
          No files exceed the LOC budget in the latest CI push.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {sorted.map((f) => (
        <div
          key={f.id}
          className="rounded-md border border-edge-subtle bg-surface-overlay px-3 py-2.5"
        >
          <div className="flex flex-wrap items-start gap-2">
            <SeverityBadge severity={f.severity} />
            <div className="min-w-0 flex-1">
              <p className="break-all font-mono text-xs text-fg-primary">
                {f.file_path ?? f.rule_id}
              </p>
              <p className="mt-0.5 text-xs text-fg-secondary">{f.message}</p>
              {f.suggested_fix?.hint != null && (
                <p className="mt-1 text-2xs italic text-fg-faint">
                  Hint: {String(f.suggested_fix.hint)}
                  {f.suggested_fix.budget != null && (
                    <> (budget: {String(f.suggested_fix.budget)} LOC)</>
                  )}
                </p>
              )}
            </div>
            {f.line != null && (
              <span className="shrink-0 font-mono text-xs tabular-nums text-fg-muted">
                {f.line.toLocaleString()} LOC
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function CodeHealthPage() {
  const projectId = useActiveProjectId()
  const path = projectId ? `/v1/admin/code-health?project_id=${projectId}` : null

  const { data: codeHealth, loading, error, reload } = usePageData<CodeHealthResponse>(path)

  const handleReload = useCallback(() => reload(), [reload])

  // Compile all bundle series for the trend chart section.
  const bundleSeries = useMemo<BundleSeries[]>(() => {
    if (!codeHealth?.trends) return []
    const series: BundleSeries[] = []

    if (codeHealth.trends.web.length > 0) {
      series.push({ label: 'Web bundle', points: codeHealth.trends.web, accent: 'bg-brand' })
    }

    const MOBILE_ACCENTS: Record<string, string> = {
      combined: 'bg-violet-500',
      ios: 'bg-sky-500',
      android: 'bg-emerald-500',
    }
    for (const [dim, points] of Object.entries(codeHealth.trends.mobile)) {
      series.push({
        label: `Mobile — ${dim}`,
        points,
        accent: MOBILE_ACCENTS[dim] ?? 'bg-brand/70',
      })
    }
    return series
  }, [codeHealth])

  const locTrendSeries = useMemo<BundleSeries[]>(() => {
    if (!codeHealth?.trends) return []
    const series: BundleSeries[] = []
    for (const [dim, points] of Object.entries(codeHealth.trends.maxFileLoc)) {
      if (points.length > 0) {
        series.push({
          label: `Max file LOC — ${dim}`,
          points,
          accent: 'bg-warn',
        })
      }
    }
    return series
  }, [codeHealth])

  const hasAnyData = Boolean(
    codeHealth &&
      (codeHealth.latestRunAt ||
        codeHealth.godFiles.length > 0 ||
        bundleSeries.length > 0 ||
        locTrendSeries.length > 0 ||
        codeHealth.summary.latest_bundle_kb != null),
  )

  const hasGodFileErrors = (codeHealth?.summary.error_count ?? 0) > 0

  if (!projectId) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeaderBar
          title="Code Health"
          description="Switch to a project using the selector at the top to view code-health data."
        />
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title="No project selected"
            description="Switch to a project using the selector at the top to view code-health data."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeaderBar
        title="Code Health"
        description="Tracks bundle KB trends and files over the 2,000-LOC budget across CI pushes."
        helpTitle="What is Code Health?"
        helpWhatIsIt="Bundle sizes and god-file findings pushed from your host repo's CI pipeline. Each push records a gate run you can track over time."
        helpHowToUse="Mint an SDK ingest key under Projects, add MUSHI_API_URL + MUSHI_INGEST_KEY to your CI secrets, and include scan-god-files.mjs in bundle-budget.yml. Pair with Full-Stack Audit for backend/schema checks."
        helpFlowPath="/code-health"
      >
        <Btn size="sm" variant="ghost" onClick={handleReload}>
          Refresh
        </Btn>
      </PageHeaderBar>

      <div className="flex flex-col gap-6 px-4 pb-8 pt-4">
        {error && <ErrorAlert message={error} />}

        {loading && !codeHealth && (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-fg-muted">Loading code-health data…</p>
          </div>
        )}

        {!loading && !error && codeHealth && !hasAnyData && (
          <EmptyState
            title="No data yet"
            description="Mint an SDK ingest key, add CI secrets, and push to main — bundle sizes and god-file findings will appear here automatically."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Link to={`/projects?tab=list&project=${projectId}`}>
                  <Btn size="sm" variant="primary">
                    Mint ingest key
                  </Btn>
                </Link>
                <Link to="/fullstack-audit">
                  <Btn size="sm" variant="ghost">
                    Full-Stack Audit →
                  </Btn>
                </Link>
              </div>
            }
          />
        )}

        {codeHealth && hasAnyData && (
          <>
            <Scorecard data={codeHealth} />

            <Card className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <p className="text-xs text-fg-secondary">
                Backend schema &amp; API contract checks live on{' '}
                <Link to="/fullstack-audit" className="text-accent hover:underline">
                  Full-Stack Audit
                </Link>
                .
              </p>
              {!codeHealth.latestRunAt && bundleSeries.length > 0 && (
                <span className="text-2xs text-fg-faint whitespace-nowrap">
                  Bundle metrics only — no god-file gate run yet
                </span>
              )}
            </Card>

            {hasGodFileErrors && (
              <Section
                title="God-file findings"
                action={
                  codeHealth.latestRunAt ? (
                    <span className="text-2xs text-fg-faint whitespace-nowrap">
                      From push on {new Date(codeHealth.latestRunAt).toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-2xs text-danger whitespace-nowrap">
                      {codeHealth.summary.error_count} file
                      {codeHealth.summary.error_count !== 1 ? 's' : ''} over budget
                    </span>
                  )
                }
              >
                <GodFileList findings={codeHealth.godFiles} />
              </Section>
            )}

            {bundleSeries.length > 0 && (
              <Section
                title="Bundle-size trends"
                action={
                  <span className="text-2xs text-fg-faint whitespace-nowrap">
                    gzipped KB · last 90 days
                  </span>
                }
              >
                <div className="divide-y divide-edge-subtle/50">
                  {bundleSeries.map((s) => (
                    <div key={s.label} className="px-1 py-4 first:pt-2">
                      <BundleTrendChart series={s} />
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {locTrendSeries.length > 0 && (
              <Section
                title="Largest file LOC trend"
                action={
                  <span className="text-2xs text-fg-faint whitespace-nowrap">
                    peak LOC · last 90 days
                  </span>
                }
              >
                <div className="divide-y divide-edge-subtle/50">
                  {locTrendSeries.map((s) => (
                    <div key={s.label} className="px-1 py-4 first:pt-2">
                      <LocTrendChart series={s} />
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {!hasGodFileErrors && (
              <Section
                title="God-file findings"
                action={
                  codeHealth.latestRunAt ? (
                    <span className="text-2xs text-fg-faint whitespace-nowrap">
                      From push on {new Date(codeHealth.latestRunAt).toLocaleString()}
                    </span>
                  ) : undefined
                }
              >
                <GodFileList findings={codeHealth.godFiles} />
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
