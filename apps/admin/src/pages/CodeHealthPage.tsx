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
 *
 * The view leads with one status sentence and a bar chart of the oversized
 * files. Known holes in the dependencies (vuln-watch, ADR 0038) live on the
 * Full-stack audit; this view links there in one line instead of repeating
 * them (console journeys 2026-10-27).
 */

import { useMemo, useCallback, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PageLoadError } from '../components/PageLoadError'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import {
  FindingSeverityBadge,
  Section,
  EmptyState,
  Btn,
} from '../components/ui'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { shouldHideGuideWhenBannerActive, COMMON_HEALTHY_PRIORITIES } from '../lib/pagePostureHelpers'
import { usePageData } from '../lib/usePageData'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { BarSparkline } from '../components/charts'
import { formatChartDayLabel } from '../components/charts/chartAxis'
import {
  EMPTY_CODE_HEALTH_STATS,
  type CodeHealthStats,
} from '../components/code-health/CodeHealthStatsTypes'
import { CodeHealthReadout } from '../components/code-health/CodeHealthReadout'
import { CodeHealthGuide } from '../components/code-health/CodeHealthGuide'
import { OversizedFilesChart } from '../components/code-health/OversizedFilesChart'
import type { KnownHolesView } from '../components/code-health/KnownHolesCard'
import { PageStatus, type PageStatusMetrics, type PageStatusTone } from '../components/ui/page-status'
import { PageFirstStep } from '../components/ui/page-first-step'
import { codeHealthErrorsHint, codeHealthNoDataHint, codeHealthWarningsHint } from '../lib/humanPageHints'
import { pluralizeWithCount } from '../lib/format'
import { CHIP_TONE, LINK_ACCENT } from '../lib/chipTone'

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

// ── Direction-of-travel arrow + tone ─────────────────────────────────────────

function TrendArrow({ delta, higherIsBad }: { delta: number; higherIsBad: boolean }) {
  const bad = higherIsBad ? delta > 0 : delta < 0
  const neutral = delta === 0
  if (neutral) return <span className="text-fg-faint text-sm">→</span>
  return (
    <span
      className={`text-sm font-bold ${bad ? 'text-danger' : 'text-ok'}`}
      aria-label={delta > 0 ? 'increased' : 'decreased'}
    >
      {delta > 0 ? '↑' : '↓'}
    </span>
  )
}

// ── Status sentence ──────────────────────────────────────────────────────────

/** Exported for tests; page modules are knip entries, so it carries no tag. One sentence on file and bundle size, worst first. */
export function codeSizeStatus(summary: CodeHealthSummary): { tone: PageStatusTone; sentence: string } {
  const { error_count: errors, warn_count: warnings, max_loc: maxLoc, latest_bundle_kb: kb } = summary
  const bundle = kb != null ? ` Your latest bundle is ${kb.toFixed(1)} KB gzipped.` : ''
  if (errors > 0) {
    const largest = maxLoc != null ? ` The largest has ${maxLoc.toLocaleString()} lines.` : ''
    return { tone: 'danger', sentence: `${codeHealthErrorsHint(errors)}${largest}${bundle}` }
  }
  if (warnings > 0) return { tone: 'warn', sentence: `${codeHealthWarningsHint(warnings)}${bundle}` }
  return { tone: 'ok', sentence: `Every file is under the 2,000-line budget.${bundle}` }
}

/** One line to the audit, where the holes are listed and managed. */
function DependencyHolesLink({ projectId }: { projectId: string }) {
  const { data } = usePageData<KnownHolesView>(`/v1/admin/projects/${projectId}/vulnerabilities`)
  if (!data?.available) return null
  const open = data.groups.filter((g) => g.status === 'open').length
  return (
    <p className="text-xs text-fg-secondary" data-testid="code-size-holes-link">
      {open > 0
        ? `${pluralizeWithCount(open, 'package')} in your dependencies ${open === 1 ? 'has' : 'have'} known security holes.`
        : data.lastRun
          ? 'No known security holes in your dependencies.'
          : 'Your dependencies have not been checked for known security holes yet.'}{' '}
      <Link to="/fullstack-audit#dependency-holes" className={LINK_ACCENT}>
        {open > 0 ? 'Fix them on Full-stack audit' : 'Open Full-stack audit'} →
      </Link>
    </p>
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
  const timestamps = series.points.map((p) => p.ts)
  const xLabels = timestamps.map((ts) =>
    formatChartDayLabel(ts.slice(0, 10)),
  )

  if (values.length === 0) return null

  const latestVal = values[values.length - 1] ?? 0
  const prevVal = values.length > 1 ? (values[values.length - 2] ?? 0) : null
  const delta = prevVal != null ? latestVal - prevVal : null
  const budget = 2000
  const overBudget = latestVal >= budget

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-2xs uppercase tracking-wider text-fg-muted">{series.label}</p>
        <span
          className={`text-lg font-semibold tabular-nums ${overBudget ? 'text-danger' : 'text-fg'}`}
        >
          {Math.round(latestVal).toLocaleString()} LOC
        </span>
        {delta != null && <TrendArrow delta={delta} higherIsBad />}
        {delta != null && (
          <span className={`text-xs tabular-nums ${delta > 0 ? 'text-danger' : delta < 0 ? 'text-ok' : 'text-fg-muted'}`}>
            {delta > 0 ? `+${Math.round(delta).toLocaleString()}` : Math.round(delta).toLocaleString()} LOC vs prev
          </span>
        )}
        <span className={`text-xs ${overBudget ? 'text-danger font-medium' : 'text-fg-faint'}`}>
          budget {budget.toLocaleString()} {overBudget ? '— over budget!' : '— within budget'}
        </span>
      </div>
      <BarSparkline
        values={values}
        timestamps={timestamps}
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

/** Bundle budget targets in gzip KB. Higher = worse, lower = better. */
const BUNDLE_TARGETS: Record<string, number> = {
  'Web bundle': 300,
  default: 500,
}

function BundleTrendChart({ series }: { series: BundleSeries }) {
  const values = series.points.map((p) => p.value)
  const timestamps = series.points.map((p) => p.ts)
  const xLabels = timestamps.map((ts) =>
    formatChartDayLabel(ts.slice(0, 10)),
  )

  if (values.length === 0) return null

  const latestVal = values[values.length - 1] ?? 0
  const prevVal = values.length > 1 ? (values[values.length - 2] ?? 0) : null
  const delta = prevVal != null ? latestVal - prevVal : null
  const target = BUNDLE_TARGETS[series.label] ?? BUNDLE_TARGETS.default
  const overTarget = latestVal > target
  const pctVsTarget = target > 0 ? ((latestVal / target - 1) * 100) : 0

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-2xs uppercase tracking-wider text-fg-muted">{series.label}</p>
        <span className={`text-lg font-semibold tabular-nums ${overTarget ? 'text-warn' : 'text-brand'}`}>
          {latestVal.toFixed(1)} KB
        </span>
        {delta != null && <TrendArrow delta={delta} higherIsBad />}
        {delta != null && (
          <span className={`text-xs tabular-nums ${delta > 0 ? 'text-warn' : delta < 0 ? 'text-ok' : 'text-fg-muted'}`}>
            {delta > 0 ? '+' : ''}{delta.toFixed(1)} KB vs prev push
          </span>
        )}
        <span className={`text-xs ${overTarget ? 'text-warn font-medium' : 'text-fg-faint'}`}>
          target {target} KB{overTarget ? ` — ${pctVsTarget.toFixed(0)}% over` : ' — within target'}
        </span>
      </div>
      <BarSparkline
        values={values}
        timestamps={timestamps}
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
      <div className={`rounded-md px-4 py-3 ${CHIP_TONE.okSubtle}`}>
        <p className="text-sm font-medium">All clear</p>
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
          // mushi-mushi-allowlist: hand-rolled surface (cn/template; not Card tile)
          className="rounded-md border border-edge-subtle bg-surface-overlay px-3 py-2.5"
        >
          <div className="flex flex-wrap items-start gap-2">
            <FindingSeverityBadge severity={f.severity} />
            <div className="min-w-0 flex-1">
              <p className="break-all font-mono text-xs text-fg">
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

  const { data: codeHealth, loading, error, errorCode, reload } = usePageData<CodeHealthResponse>(path)
  // The status banner links to #god-files. React Router does not scroll to
  // hashes, so do it once the section exists (location.key re-runs it when
  // the link is clicked while already on this page).
  const location = useLocation()
  const godFilesReady = Boolean(codeHealth)
  useEffect(() => {
    if (location.hash !== '#god-files' || !godFilesReady) return
    document.getElementById('god-files')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.hash, location.key, godFilesReady])
  const {
    data: statsData,
    reload: reloadStats,
    isValidating: statsValidating,
    lastFetchedAt: statsFetchedAt,
  } = usePageData<CodeHealthStats>('/v1/admin/code-health/stats')
  const stats = statsData ?? EMPTY_CODE_HEALTH_STATS

  const handleReload = useCallback(() => {
    reload()
    reloadStats()
  }, [reload, reloadStats])

  // Compile all bundle series for the trend chart section.
  const bundleSeries = useMemo<BundleSeries[]>(() => {
    if (!codeHealth?.trends) return []
    const series: BundleSeries[] = []

    if (codeHealth.trends.web.length > 0) {
      series.push({ label: 'Web bundle', points: codeHealth.trends.web, accent: 'bg-brand' })
    }

    const MOBILE_ACCENTS: Record<string, string> = {
      combined: 'bg-accent',
      ios: 'bg-info',
      android: 'bg-ok',
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


  if (!projectId) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeaderBar
          title="Code Health"

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

  const status = codeHealth && hasAnyData ? codeSizeStatus(codeHealth.summary) : null
  const oversized = (codeHealth?.godFiles ?? [])
    .filter((f) => f.line != null && f.severity !== 'info')
    .map((f) => ({ id: f.id, path: f.file_path ?? f.rule_id, lines: f.line as number }))
  const projectLabel = stats.projectName ?? 'this app'
  const errorCount = codeHealth?.summary.error_count ?? 0
  const warnCount = codeHealth?.summary.warn_count ?? 0
  const bundleKb = codeHealth?.summary.latest_bundle_kb ?? null
  const fileMetrics = [
    { label: 'Files over budget', value: errorCount, tone: errorCount > 0 ? 'danger' : 'neutral' },
    { label: 'Close to budget', value: warnCount, tone: warnCount > 0 ? 'warn' : 'neutral' },
  ] as const
  const statusMetrics: PageStatusMetrics =
    bundleKb != null ? [...fileMetrics, { label: 'Bundle (gzip)', value: `${bundleKb.toFixed(1)} KB` }] : fileMetrics

  return (
    <div className={PAGE_CONTENT_STACK}>
      <PageHeaderBar
        title="Code size"
        helpTitle="About code size"
        helpWhatIsIt="How big your files and your app bundle are, sent from your CI after each push to main. Very large files are hard for you and for AI agents to change safely."
        helpHowToUse="Mint an SDK ingest key under Projects, add MUSHI_API_URL and MUSHI_INGEST_KEY to your CI secrets, and run scan-god-files.mjs in bundle-budget.yml. Security holes in your dependencies are on Full-stack audit."
        helpFlowPath="/code-health"
      >
        <Btn size="sm" variant="ghost" onClick={handleReload}>
          Refresh
        </Btn>
      </PageHeaderBar>

      {error && <PageLoadError error={error} code={errorCode} resource="code-size data" onRetry={reload} />}

      {loading && !codeHealth && (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-fg-muted">Loading code size…</p>
        </div>
      )}

      {!loading && !error && codeHealth && !hasAnyData && (
        <PageFirstStep
          title="No code size data yet"
          sentence={codeHealthNoDataHint(projectLabel)}
          action={{ label: 'Mint ingest key', to: `/projects?tab=list&project=${projectId}` }}
          data-testid="code-size-first-step"
        />
      )}

      {status && (
        <PageStatus
          ariaLabel="Code size status"
          tone={status.tone}
          sentence={status.sentence}
          freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
          metrics={statusMetrics}
          action={
            oversized.length > 0 ? (
              <Btn size="sm" variant="primary" to={`${location.pathname}${location.search}#god-files`}>
                Review oversized files
              </Btn>
            ) : undefined
          }
          data-testid="code-size-status"
        />
      )}

      <DependencyHolesLink projectId={projectId} />

      <div className="flex w-full min-w-0 flex-col gap-6">
        {codeHealth && hasAnyData && (
          <>
            {oversized.length > 0 && (
              <Section
                title="Oversized files"
                action={
                  codeHealth.latestRunAt ? (
                    <span className="text-2xs text-fg-faint whitespace-nowrap">
                      From push on {new Date(codeHealth.latestRunAt).toLocaleString()}
                    </span>
                  ) : undefined
                }
              >
                <OversizedFilesChart files={oversized} />
              </Section>
            )}

            {bundleSeries.length > 0 && (
              <Section
                title="Bundle size over time"
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
                title="Largest file over time"
                action={
                  <span className="text-2xs text-fg-faint whitespace-nowrap">
                    lines · last 90 days
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

            <div id="god-files" className="scroll-mt-4">
              <Section title="How to split each file">
                <GodFileList findings={codeHealth.godFiles} />
              </Section>
            </div>
          </>
        )}
      </div>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.guide,
            show: !shouldHideGuideWhenBannerActive(false, COMMON_HEALTHY_PRIORITIES, stats.topPriority),
            children: <CodeHealthGuide topPriority={stats.topPriority} stats={stats} />,
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            children: (
              <CodeHealthReadout stats={stats} fetchedAt={statsFetchedAt} validating={statsValidating} />
            ),
          },
        ]}
      />
    </div>
  )
}
