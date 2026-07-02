import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { useMergedErrors } from '../lib/useMergedErrors'
import { usePublishPageContext } from '../lib/pageContext'
import { ErrorAlert,
  EmptyState,
  Btn,
  Badge,
  Section,
  RelativeTime,
  Tooltip,
  ResultChip,
  type ResultChipTone,
  FreshnessPill,
  SegmentedControl, } from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { JudgeStatusBanner, isJudgeStatusBannerCritical } from '../components/judge/JudgeStatusBanner'
import { JudgeSnapshotStrip } from '../components/judge/JudgeSnapshotStrip'
import { JudgePipelineGuide } from '../components/judge/JudgePipelineGuide'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import {
  EMPTY_JUDGE_STATS,
  type JudgeStats,
  type JudgeTabId,
} from '../components/judge/JudgeStatsTypes'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { ResponsiveTable } from '../components/ResponsiveTable'
import {
  KpiTile,
  KpiRow,
  LineSparkline,
  Histogram,
  formatPct,
} from '../components/charts'
import { SCORE_COLORS } from '../lib/tokens'
import { useToast } from '../lib/toast'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageCopy } from '../lib/copy'
import { useJudgeUx, resolveQuickJudgeTab } from '../lib/judgeModeUx'
import { HeroJudgeScale } from '../components/illustrations/HeroIllustrations'
import { PageHero } from '../components/PageHero'
import { useNextBestAction } from '../lib/useNextBestAction'
import { ChartActionsMenu } from '../components/ChartActionsMenu'
import { ChartAnnotations } from '../components/charts/ChartAnnotations'
import type { ChartEvent } from '../lib/apiSchemas'
import { CHIP_TONE } from '../lib/chipTone'

interface WeekData {
  week_start: string
  avg_score: number
  avg_accuracy: number
  avg_severity: number
  avg_component: number
  avg_repro: number
  eval_count: number
}

interface EvalRow {
  id: string
  report_id: string
  judge_model: string | null
  judge_score: number | null
  accuracy_score: number | null
  severity_score: number | null
  component_score: number | null
  repro_score: number | null
  classification_agreed: boolean | null
  judge_reasoning: string | null
  prompt_version: string | null
  created_at: string
  judge_fallback_used: boolean | null
  report_summary: string | null
  report_severity: string | null
  report_status: string | null
}

/**
 * Glossary for the judge score columns. Drives both the score-trend legend
 * and the column-header tooltips so the same explanation appears wherever
 * the dimension is referenced — single source of truth.
 */
const SCORE_DIMENSIONS = [
  {
    key: 'overall',
    label: 'Overall',
    short: 'Score',
    description: 'Weighted average of accuracy, severity, component, and repro. Headline judge grade.',
  },
  {
    key: 'accuracy',
    label: 'Accuracy',
    short: 'Acc',
    description: 'Did the classifier pick the right category for what the user actually reported?',
  },
  {
    key: 'severity',
    label: 'Severity',
    short: 'Sev',
    description: 'Did the assigned severity (critical/high/medium/low) match real impact?',
  },
  {
    key: 'component',
    label: 'Component',
    short: 'Comp',
    description: "Did the classifier identify the correct affected component or page?",
  },
  {
    key: 'repro',
    label: 'Repro',
    short: 'Repro',
    description: 'How well does the report capture steps to reproduce — useful for the auto-fix agent?',
  },
] as const

const DIMENSION_TOOLTIPS = Object.fromEntries(
  SCORE_DIMENSIONS.map((d) => [d.short, d.description] as const),
) as Record<string, string>

interface PromptRow {
  id: string
  project_id: string | null
  stage: string
  version: string
  is_active: boolean
  is_candidate: boolean
  traffic_percentage: number
  avg_judge_score: number | null
  total_evaluations: number
  created_at: string
}

interface Distribution {
  buckets: number[]
  total: number
}

const JUDGE_TABS: Array<{ id: JudgeTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Posture banner, workflow, and run-judge CTA.',
  },
  {
    id: 'trend',
    label: 'Trend',
    description: '12-week score sparkline, dimension bars, and distribution histogram.',
  },
  {
    id: 'evaluations',
    label: 'Evaluations',
    description: 'Per-report judge grades — filter disagreements or lowest scores.',
  },
  {
    id: 'prompts',
    label: 'Prompts',
    description: 'Prompt-version leaderboard ranked by mean judge score.',
  },
]

function resolveJudgeTab(value: string | null): JudgeTabId {
  if (value === 'trend' || value === 'evaluations' || value === 'prompts') return value
  return 'overview'
}

function ScoreBar({
  label,
  value,
  color,
  description,
}: {
  label: string
  value: number
  color: string
  description?: string
}) {
  const inner = (
    <ContainedBlock tone="muted" className="py-1.5">
      <div className="flex items-center gap-2">
        <SignalChip tone="neutral" className="w-20 justify-center cursor-help">
          {label}
        </SignalChip>
        <div className="flex-1 h-2 bg-surface-root rounded-full overflow-hidden">
          <div
            className="h-full rounded-full motion-safe:transition-[background-color,border-color,color,box-shadow,transform,opacity] motion-safe:duration-500"
            style={{ width: `${(value * 100).toFixed(0)}%`, backgroundColor: color }}
          />
        </div>
        <SignalChip tone="brand" className="w-9 justify-center font-mono tabular-nums">
          {(value * 100).toFixed(0)}%
        </SignalChip>
      </div>
    </ContainedBlock>
  )
  if (!description) return inner
  return <Tooltip content={description}>{inner}</Tooltip>
}

/**
 * Compact legend that maps a dimension's color swatch to its human meaning.
 * Renders inline next to the score-trend sparkline so first-time users can
 * decode the colored bars without clicking around. Uses the same
 * SCORE_DIMENSIONS source the column tooltips use.
 */
function ScoreTrendLegend() {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {SCORE_DIMENSIONS.map((d) => (
        <Tooltip key={d.key} content={d.description}>
          <span className="inline-flex cursor-help">
            <SignalChip tone="neutral" className="gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: SCORE_COLORS[d.key] }}
                aria-hidden="true"
              />
              {d.label}
            </SignalChip>
          </span>
        </Tooltip>
      ))}
    </div>
  )
}

/**
 * Adds a help cursor + dotted underline + hover tooltip to a column-header
 * label. Most of the recent-evaluations columns are 3-character abbreviations
 * (Acc, Sev, Comp, Repro) so the tooltip is the only place users learn what
 * they actually mean.
 */
function HeaderTip({ short, full }: { short: string; full?: string }) {
  const description = full ?? DIMENSION_TOOLTIPS[short]
  if (!description) return <>{short}</>
  return (
    <Tooltip content={description}>
      <span className="cursor-help underline decoration-dotted decoration-fg-faint/40 underline-offset-2">
        {short}
      </span>
    </Tooltip>
  )
}

function ScorePill({ value }: { value: number | null }) {
  if (value == null) return <span className="text-fg-faint text-2xs font-mono">—</span>
  // Judge scores calibrate differently to operational rates. The PM
  // baseline is "≥0.80 agrees with humans (green), ≥0.60 borderline
  // (amber), <0.60 regression (red)". Delegating to <Pct>/pctToneClass
  // (90/70 thresholds, tuned for success/uptime) recoloured every
  // 0.80–0.89 row from green → amber and every 0.60–0.69 row from
  // amber → red across the leaderboard + weekly trend + per-eval tables,
  // silently shifting the visual definition of "good". Keep the
  // judge-specific ramp local to the domain rather than polluting the
  // shared higher-better tone ramp with a "sometimes-80-is-fine" knob.
  const tone = value >= 0.8 ? 'text-ok' : value >= 0.6 ? 'text-warn' : 'text-danger'
  return (
    <span className={`font-mono tabular-nums ${tone}`}>{(value * 100).toFixed(0)}%</span>
  )
}

export function JudgePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab = resolveJudgeTab(tabParam)
  const activeTabMeta = JUDGE_TABS.find((t) => t.id === activeTab) ?? JUDGE_TABS[0]
  const disagreementOnly = searchParams.get('filter') === 'disagreement'
  const toast = useToast()

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<JudgeStats>('/v1/admin/judge/stats')
  usePublishPageHeroStats('/judge', statsData)
  const stats = { ...EMPTY_JUDGE_STATS, ...statsData }

  const setActiveTab = useCallback(
    (tab: JudgeTabId) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (tab === 'overview') next.delete('tab')
        else next.set('tab', tab)
        return next
      })
    },
    [setSearchParams],
  )
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const copy = usePageCopy('/judge')
  const ux = useJudgeUx()

  useEffect(() => {
    if (!ux.isQuickstart || statsLoading) return
    const quickTab = resolveQuickJudgeTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsLoading, stats, activeTab, setActiveTab])
  const [sort, setSort] = useState<'recent' | 'score_asc'>('recent')
  const [running, setRunning] = useState(false)
  const [heroCollapsed, setHeroCollapsed] = useState(true)
  // Sticky inline receipt for "Run judge now" — toast disappears, this stays
  // on screen until the next run so the user can see the pending refresh
  // countdown and the dispatched count without scrolling back up.
  const [runResult, setRunResult] = useState<
    | { tone: ResultChipTone; message: string; at: string | null }
    | null
  >(null)
  // Drives both the leaderboard-row "selected" highlight and the
  // /evaluations query filter. fixes the inert leaderboard rows
  // the PageHelp claimed were clickable.
  const [promptFilter, setPromptFilter] = useState<{ version: string; stage: string } | null>(null)

  const weeksQuery = usePageData<{ weeks: WeekData[] }>('/v1/admin/judge-scores')
  // Wave T.5.8b: fetch chart events (deploys, cron anomalies, BYOK
  // rotations) to overlay on the weekly score trend. Failures are silent
  // — annotations are a garnish, not a load-blocking dependency. We scope
  // to ~12 weeks so the pill overlay stays readable on 12 weeks of data.
  const chartEventsQuery = usePageData<{ events: ChartEvent[] }>(
    '/v1/admin/chart-events?kinds=deploy,cron,byok',
  )
  const chartEvents = chartEventsQuery.data?.events ?? []
  const evalsQuery = usePageData<{ evaluations: EvalRow[] }>(
    `/v1/admin/judge/evaluations?limit=50&sort=${sort === 'score_asc' ? 'score_asc' : 'recent'}${promptFilter ? `&prompt_version=${encodeURIComponent(promptFilter.version)}` : ''}`,
  )
  const promptsQuery = usePageData<{ prompts: PromptRow[] }>('/v1/admin/judge/prompts')
  const distQuery = usePageData<Distribution>('/v1/admin/judge/distribution')

  const weeks = weeksQuery.data?.weeks ?? []
  const evalsRaw = evalsQuery.data?.evaluations ?? []
  const evals = useMemo(
    () =>
      disagreementOnly
        ? evalsRaw.filter((e) => e.classification_agreed === false)
        : evalsRaw,
    [evalsRaw, disagreementOnly],
  )
  const prompts = promptsQuery.data?.prompts ?? []

  const dist = distQuery.data ?? null
  // Single source of truth for first-paint loading + error gating across
  // the four panels of this page Background refetches
  // (e.g. after `runNow`) no longer flash a skeleton because `merged.loading`
  // only blocks until each query has resolved at least once.
  const merged = useMergedErrors([
    { ...weeksQuery, label: 'weekly trend' },
    { ...evalsQuery, label: 'recent evaluations' },
    { ...promptsQuery, label: 'prompt leaderboard' },
    { ...distQuery, label: 'score distribution' },
  ])
  const loading = merged.loading
  const error = merged.error

  const loadAll = useCallback(() => {
    reloadStats()
    weeksQuery.reload()
    evalsQuery.reload()
    promptsQuery.reload()
    distQuery.reload()
  }, [reloadStats, weeksQuery, evalsQuery, promptsQuery, distQuery])

  // Post-dispatch refresh timer — cleared on unmount so navigating away
  // doesn't fire reloads against unmounted queries.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
  }, [])

  async function runNow() {
    setRunning(true)
    setRunResult({ tone: 'running', message: 'Dispatching judge batch…', at: null })
    const res = await apiFetch<{ dispatched: number }>('/v1/admin/judge/run', { method: 'POST' })
    setRunning(false)
    const at = new Date().toISOString()
    if (res.ok) {
      const count = res.data?.dispatched ?? 0
      const message = `Dispatched ${count} project${count === 1 ? '' : 's'} — refreshing in ~30s`
      toast.success('Judge batch dispatched', `${count} project(s). Refreshing in ~30s.`)
      setRunResult({ tone: 'success', message, at })
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = setTimeout(loadAll, 30_000)
    } else {
      const message = res.error?.message ?? 'Judge batch failed'
      toast.error('Failed to run judge batch', message)
      setRunResult({ tone: 'error', message, at })
    }
  }

  const runAction = searchParams.get('action')
  // Ref guard, not `running` state: setRunning(true) hasn't committed when
  // StrictMode re-invokes the effect, so state alone double-dispatches.
  const autoRunFiredRef = useRef(false)
  useEffect(() => {
    if (runAction !== 'run' || autoRunFiredRef.current) return
    autoRunFiredRef.current = true
    void runNow()
    const next = new URLSearchParams(searchParams)
    next.delete('action')
    setSearchParams(next, { replace: true })
  }, [runAction, searchParams, setSearchParams])

  // Publish page context so the browser tab reflects the latest judge
  // week score (e.g. "Judge · 65% this week — Mushi Mushi") and the
  // Ask Mushi / palette pick up the same summary. Called before the
  // loading / error early-returns so hook order stays stable.
  const latestWeek = weeksQuery.data?.weeks?.[0]
  usePublishPageContext({
    route: '/judge',
    title: projectName ? `Judge · ${projectName}` : 'Judge',
    summary: loading
      ? 'Loading judge scores…'
      : latestWeek
        ? `${Math.round((latestWeek.avg_score ?? 0) * 100)}% this week · ${latestWeek.eval_count} evals`
        : 'No evaluations yet',
    questions: latestWeek
      ? [
          'Why did the judge score change week-over-week?',
          'Which evaluation criteria are dragging the score down?',
          'Show me the worst-scoring evaluations from this week.',
        ]
      : [
          'How do I run the first judge evaluation?',
          'What does the judge actually measure?',
        ],
  })

  const disagreementRate = evalsRaw.length > 0
    ? evalsRaw.filter((e) => e.classification_agreed === false).length / evalsRaw.length
    : null
  const staleHoursAgo = evalsRaw[0]?.created_at
    ? Math.floor((Date.now() - new Date(evalsRaw[0].created_at).getTime()) / 3_600_000)
    : null
  const heroAction = useNextBestAction({
    scope: 'judge',
    disagreementRate,
    sampledCount: evalsRaw.length,
    staleHoursAgo,
  })

  const tabOptions = useMemo(
    () =>
      JUDGE_TABS.map((t) => ({
        id: t.id,
        label: copy?.tabLabels?.[t.id] ?? t.label,
        count:
          t.id === 'evaluations' && stats.disagreementCount > 0
            ? stats.disagreementCount
            : t.id === 'prompts' && stats.promptVersionCount > 0
              ? stats.promptVersionCount
              : undefined,
      })),
    [stats.disagreementCount, stats.promptVersionCount, copy?.tabLabels],
  )

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading judge">
        <div className="h-8 w-48 rounded bg-surface-raised" />
        <div className="h-16 rounded bg-surface-raised/60" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded bg-surface-raised" />
          ))}
        </div>
      </div>
    )
  }

  if (statsError) {
    return <ErrorAlert message={`Failed to load judge stats: ${statsError}`} onRetry={reloadStats} />
  }

  if (loading) return <TableSkeleton rows={6} columns={5} showFilters showKpiStrip label="Loading judge" />
  if (error) return <ErrorAlert message={`Failed to load ${merged.failedLabel ?? 'judge data'}: ${error}`} onRetry={loadAll} />

  const latest = weeks[0]
  const previous = weeks[1]
  const drift =
    latest && previous && previous.avg_score > 0
      ? (previous.avg_score - latest.avg_score) / previous.avg_score
      : 0

  const totalEvals = weeks.reduce((s, w) => s + w.eval_count, 0)
  const trendValues = [...weeks].reverse().map((w) => w.avg_score)
  // Wave T.4.7b: Each weekly bucket exposes a `week` ISO. We pass them
  // aligned with `trendValues` so brushing the sparkline emits concrete
  // fromIso/toIso bounds the filter logic can consume.
  const trendTimestamps = [...weeks].reverse().map((w) => (w as { week?: string }).week ?? '')

  const overallScore = latest?.avg_score
  const heroSeverity: 'ok' | 'warn' | 'crit' | 'neutral' =
    overallScore == null
      ? 'neutral'
      : overallScore >= 0.8
        ? 'ok'
        : overallScore >= 0.6
          ? 'warn'
          : 'crit'
  const lastEval = evals[0]

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : stats.topPriority === 'no_evals'
        ? 'brand'
        : stats.topPriority === 'low_score' || stats.topPriority === 'drifting'
          ? 'danger'
          : stats.topPriority === 'disagreements' || stats.topPriority === 'stale'
            ? 'warn'
            : stats.topPriority === 'healthy'
              ? 'ok'
              : 'info'

  const trendPanel = (
    <>
      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <Section
          title="Score trend (12w)"
          action={
            <ChartActionsMenu
              label="Score trend"
              exportFilename={`judge-score-trend-${new Date().toISOString().slice(0, 10)}.csv`}
              onExportCsv={() => {
                const header = 'week_start,avg_score,avg_accuracy,avg_severity,avg_component,avg_repro,eval_count'
                const rows = weeks.map((w) =>
                  [w.week_start, w.avg_score, w.avg_accuracy, w.avg_severity, w.avg_component, w.avg_repro, w.eval_count].join(','),
                )
                return [header, ...rows].join('\n')
              }}
              openFilterTo="/judge?tab=evaluations&filter=disagreement"
              openFilterLabel="Browse disagreements"
            />
          }
        >
          {weeks.length === 0 ? (
            <EmptyState
              icon={<HeroJudgeScale />}
              title="No evaluations yet"
              description="Run judge now to score classified reports. Weekly trend and dimension bars appear here after the first batch."
              hints={[
                'Run judge now scores the most recent reports against the active prompt.',
                'Aim for ≥80% mean score before promoting a candidate prompt.',
              ]}
            />
          ) : (
            <>
              <div className="relative">
                <LineSparkline
                  values={trendValues}
                  timestamps={trendTimestamps.every(Boolean) ? trendTimestamps : undefined}
                  onRangeSelect={
                    trendTimestamps.every(Boolean)
                      ? ({ fromIso, toIso }) => {
                          const next = new URLSearchParams(window.location.search)
                          next.set('from', fromIso)
                          next.set('to', toIso)
                          window.history.pushState(null, '', `${window.location.pathname}?${next.toString()}`)
                        }
                      : undefined
                  }
                  accent="text-brand"
                  height={72}
                  showAxes
                  scaleToData
                  valueFormat="percent"
                  yAxisCaption="Score"
                  xAxisCaption="Week"
                  showPeakLabel
                  ariaLabel="Weekly judge score trend"
                />
                {trendTimestamps.every(Boolean) && chartEvents.length > 0 && (
                  <ChartAnnotations
                    events={chartEvents}
                    fromIso={trendTimestamps[0]}
                    toIso={trendTimestamps[trendTimestamps.length - 1]}
                    ariaLabel="Judge score annotations"
                  />
                )}
              </div>
              {latest && (
                <>
                  <div className="mt-3 space-y-1">
                    <ScoreBar label="Overall" value={latest.avg_score} color={SCORE_COLORS.overall} description={DIMENSION_TOOLTIPS.Score} />
                    <ScoreBar label="Accuracy" value={latest.avg_accuracy} color={SCORE_COLORS.accuracy} description={DIMENSION_TOOLTIPS.Acc} />
                    <ScoreBar label="Severity" value={latest.avg_severity} color={SCORE_COLORS.severity} description={DIMENSION_TOOLTIPS.Sev} />
                    <ScoreBar label="Component" value={latest.avg_component} color={SCORE_COLORS.component} description={DIMENSION_TOOLTIPS.Comp} />
                    <ScoreBar label="Repro" value={latest.avg_repro} color={SCORE_COLORS.repro} description={DIMENSION_TOOLTIPS.Repro} />
                  </div>
                  <ScoreTrendLegend />
                </>
              )}
            </>
          )}
        </Section>

        <Section title="Score distribution">
          {dist && dist.total > 0 ? (
            <>
              <Histogram
                buckets={dist.buckets}
                labels={['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']}
                accent="bg-brand/70"
                height={100}
                showAxes
                valueFormat="count"
                yAxisCaption="Evals"
                xAxisCaption="Score (0–10)"
              />
              <InlineProof className="mt-2">
                {dist.total} evals · 0–100 scale, deciles
              </InlineProof>
            </>
          ) : (
            <EmptySectionMessage
              text="No scored evaluations yet."
              hint="Run judge now or wait for the nightly cron — distribution bars appear after the first batch."
            />
          )}
        </Section>
      </div>

      {weeks.length > 0 && (
        <Section title="Weekly history">
          <ResponsiveTable className="-mx-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-fg-muted text-left border-b border-edge">
                  <th className="py-1.5 px-3 font-medium">Week</th>
                  <th className="py-1.5 px-3 font-medium text-right"><HeaderTip short="Score" /></th>
                  <th className="py-1.5 px-3 font-medium text-right"><HeaderTip short="Accuracy" full={DIMENSION_TOOLTIPS.Acc} /></th>
                  <th className="py-1.5 px-3 font-medium text-right"><HeaderTip short="Severity" full={DIMENSION_TOOLTIPS.Sev} /></th>
                  <th className="py-1.5 px-3 font-medium text-right"><HeaderTip short="Component" full={DIMENSION_TOOLTIPS.Comp} /></th>
                  <th className="py-1.5 px-3 font-medium text-right"><HeaderTip short="Repro" /></th>
                  <th className="py-1.5 px-3 font-medium text-right">Evals</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.week_start} className="border-b border-edge-subtle text-fg-secondary">
                    <td className="py-1.5 px-3">{w.week_start}</td>
                    <td className="py-1.5 px-3 text-right"><ScorePill value={w.avg_score} /></td>
                    <td className="py-1.5 px-3 text-right"><ScorePill value={w.avg_accuracy} /></td>
                    <td className="py-1.5 px-3 text-right"><ScorePill value={w.avg_severity} /></td>
                    <td className="py-1.5 px-3 text-right"><ScorePill value={w.avg_component} /></td>
                    <td className="py-1.5 px-3 text-right"><ScorePill value={w.avg_repro} /></td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums">{w.eval_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        </Section>
      )}
    </>
  )

  return (
    <div className="space-y-4" data-testid="mushi-page-judge">
      <PageHeaderBar
        title={copy?.title ?? 'Judge'}
        projectScope={stats.projectName ?? projectName ?? undefined}
        withPageHero={!ux.hideOverviewChrome}

        helpTitle={copy?.help?.title ?? 'About the Judge'}
        helpWhatIsIt={copy?.help?.whatIsIt ?? "A second LLM that grades the classifier's output on every report — accuracy, severity, component, and reproduction quality. Scores feed both the weekly aggregate and the per-prompt leaderboard."}
        helpUseCases={copy?.help?.useCases ?? [
          'Detect when the classifier silently degrades after a model or prompt change',
          'Compare prompt versions head-to-head on real reports',
          'Decide whether to roll back, fork, or promote a prompt',
        ]}
        helpHowToUse={copy?.help?.howToUse ?? 'Click "Run judge now" to score recent unjudged reports immediately. The leaderboard ranks prompt versions by mean judge score; click a row to see the evaluations that drove it.'}
      >
        <Badge
          className={
            bannerSeverity === 'ok'
              ? CHIP_TONE.okSubtle
              : bannerSeverity === 'danger'
                ? CHIP_TONE.dangerSubtle
                : bannerSeverity === 'warn'
                  ? CHIP_TONE.warnSubtle
                  : bannerSeverity === 'brand'
                    ? 'bg-brand/15 text-brand'
                    : 'bg-surface-overlay text-fg-muted'
          }
        >
          {!stats.hasAnyProject
            ? 'NO PROJECT'
            : stats.totalEvaluations === 0
              ? 'NO EVALS'
              : stats.topPriority === 'low_score' || stats.topPriority === 'drifting'
                ? 'DRIFT'
                : stats.disagreementCount > 0
                  ? `${stats.disagreementCount} DISAGREE`
                  : stats.latestWeekScore != null
                    ? `${Math.round(stats.latestWeekScore * 100)}%`
                    : 'OK'}
        </Badge>
        <FreshnessPill
          at={statsFetchedAt ?? evalsQuery.lastFetchedAt ?? weeksQuery.lastFetchedAt}
          isValidating={statsValidating || evalsQuery.isValidating || weeksQuery.isValidating || promptsQuery.isValidating || distQuery.isValidating}
        />
        <Btn size="sm" variant="ghost" onClick={loadAll} loading={statsValidating || evalsQuery.isValidating || weeksQuery.isValidating}>
          Refresh
        </Btn>
        <Btn
          size="sm"
          variant="primary"
          onClick={runNow}
          disabled={running}
          loading={running}
          leadingIcon={<PlayIcon />}
          data-dav-anchor="judge:act"
        >
          Run judge now
        </Btn>
        {runResult && (
          <ResultChip tone={runResult.tone} at={runResult.at}>
            {runResult.message}
          </ResultChip>
        )}
      </PageHeaderBar>

      {isJudgeStatusBannerCritical(stats) ? (
        <PagePosture
          slots={[
            {
              priority: POSTURE_PRIORITY.status,
              children: (
                <JudgeStatusBanner
                  stats={stats}
                  onTab={setActiveTab}
                  onRefresh={loadAll}
                  refreshing={statsValidating || evalsQuery.isValidating || weeksQuery.isValidating}
                  onRunJudge={runNow}
                  running={running}
                  plainBanner={ux.plainBanner}
                />
              ),
            },
            {
              priority: POSTURE_PRIORITY.guide,
              children: <JudgePipelineGuide topPriority={stats.topPriority} stats={stats} />,
            },
            {
              priority: POSTURE_PRIORITY.heroOrSnapshot,
              show: !ux.hideJudgeSnapshot,
              children: (
                <JudgeSnapshotStrip
                  stats={stats}
                  statsFetchedAt={statsFetchedAt}
                  statsValidating={statsValidating}
                  sectionTitle={copy?.sections?.snapshot ?? 'JUDGE SNAPSHOT'}
                  hint={activeTabMeta.description}
                  statLabels={copy?.statLabels}
                />
              ),
            },
          ]}
        />
      ) : (
        <>
          <JudgePipelineGuide topPriority={stats.topPriority} stats={stats} />
          {!ux.hideJudgeSnapshot && (
            <JudgeSnapshotStrip
              stats={stats}
              statsFetchedAt={statsFetchedAt}
              statsValidating={statsValidating}
              sectionTitle={copy?.sections?.snapshot ?? 'JUDGE SNAPSHOT'}
              hint={activeTabMeta.description}
              statLabels={copy?.statLabels}
            />
          )}
        </>
      )}

      {!ux.hideTabs && (
      <SegmentedControl<JudgeTabId>
        size="sm"
        ariaLabel="Judge sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
      />
      )}

      {activeTab === 'overview' && !ux.hideOverviewChrome && (
        <>
      <PageHero
        scope="judge"
        title={copy?.title ?? 'Judge'}
        kicker="Independent grading"
        onCollapsedChange={setHeroCollapsed}
        decide={{
          label: overallScore == null ? 'No evaluations yet' : `Overall score ${Math.round(overallScore * 100)}%`,
          metric: overallScore == null ? '—' : `${Math.round(overallScore * 100)}%`,
          summary: overallScore == null
            ? 'Run a judge batch to populate scores. Fresh runs every Mon/Thu are recommended.'
            : drift >= 0.05
              ? `Down ${(drift * 100).toFixed(1)}% week-over-week — investigate before shipping prompt changes.`
              : `Stable across ${totalEvals} evaluations over ${weeks.length} weeks.`,
          severity: heroSeverity,
          anchor: 'judge:decide',
          evidence: overallScore != null ? {
            kind: 'metric-breakdown',
            items: [
              { label: 'Avg score', value: `${Math.round(overallScore * 100)}%`, tone: overallScore >= 0.8 ? 'ok' : overallScore >= 0.6 ? 'warn' : 'crit' },
              { label: 'Evaluations', value: totalEvals, tone: 'neutral' },
              { label: 'Weeks tracked', value: weeks.length, tone: 'neutral' },
              ...(disagreementRate != null ? [{ label: 'Disagreement', value: `${(disagreementRate * 100).toFixed(1)}%`, tone: disagreementRate > 0.2 ? 'warn' as const : 'ok' as const }] : []),
            ],
          } : undefined,
        }}
        act={heroAction}
        actAnchor="judge:act"
        actEvidence={heroAction ? { kind: 'rule-trace', why: heroAction.reason ?? heroAction.title, threshold: drift >= 0.05 ? `drift ${(drift * 100).toFixed(1)}%` : undefined } : undefined}
        verify={{
          label: lastEval ? `Last eval · ${lastEval.judge_model ?? 'model'}` : 'Awaiting first eval',
          detail: lastEval
            ? `${lastEval.id.slice(0, 8)} · ${new Date(lastEval.created_at).toISOString().slice(0, 16).replace('T', ' ')}`
            : '—',
          to: lastEval ? `/reports/${lastEval.report_id}` : '/reports',
          secondaryTo: '/prompt-lab',
          secondaryLabel: 'Open Prompt Lab',
          anchor: 'judge:verify',
          evidence: lastEval ? {
            kind: 'last-event',
            at: lastEval.created_at,
            by: lastEval.judge_model ?? 'judge',
            payloadSummary: `eval ${lastEval.id.slice(0, 8)} · ${lastEval.classification_agreed === false ? 'disagreement' : 'agreement'}`,
            status: lastEval.classification_agreed === false ? 'warn' : 'ok',
          } : undefined,
        }}
      />
        </>
      )}

      {activeTab === 'overview' && !ux.hideOverviewChrome && heroCollapsed && ux.hideJudgeSnapshot && (
        <>
      <div data-dav-anchor="judge:decide">
      <KpiRow cols={4}>
        <KpiTile
          label="Latest week"
          value={latest ? formatPct(latest.avg_score) : '—'}
          sublabel={latest ? `${latest.eval_count} evals` : 'No evals yet'}
          accent={latest && latest.avg_score >= 0.8 ? 'ok' : latest && latest.avg_score >= 0.6 ? 'warn' : 'danger'}
          meaning="Mean judge score this week. ≥80% is healthy; <60% means the classifier is drifting and the prompt likely needs a tune."
          delta={
            previous
              ? {
                  value: `${(Math.abs(drift) * 100).toFixed(1)}%`,
                  direction: drift > 0.01 ? 'down' : drift < -0.01 ? 'up' : 'flat',
                  tone: drift > 0.10 ? 'danger' : drift > 0.01 ? 'warn' : drift < -0.01 ? 'ok' : 'muted',
                }
              : null
          }
        />
        <KpiTile
          label="Total evaluations"
          value={totalEvals}
          sublabel="Last 12 weeks"
          meaning="How many fix attempts the independent LLM judge has graded over the last 12 weeks. More evals = more confidence in the trend."
        />
        <KpiTile
          label="Prompt versions"
          value={prompts.length}
          sublabel={`${prompts.filter((p) => p.is_active).length} active · ${prompts.filter((p) => p.is_candidate).length} candidate`}
          meaning="Distinct classifier prompts in your library. Candidates are A/B'd against the active prompt; promote a winner from the leaderboard."
        />
        <KpiTile
          label="Mean score (overall)"
          value={
            dist && dist.total > 0
              ? formatPct(
                  dist.buckets.reduce((s, n, i) => s + n * (i + 0.5) * 0.1, 0) /
                    dist.total,
                )
              : '—'
          }
          sublabel={dist ? `${dist.total} scored evals` : ''}
          meaning="All-time mean judge score across every evaluation. Useful as a long-term health signal — a sliding 12w mean is on the chart to its right."
        />
      </KpiRow>
      </div>

      {weeks.length === 0 && evals.length === 0 && prompts.length === 0 && (
        <ContainedBlock tone="info">
          <InlineProof>
            Tip: judge runs nightly via cron. Use <strong>Run judge now</strong> to seed
            evaluations immediately on a fresh project.
          </InlineProof>
        </ContainedBlock>
      )}
        </>
      )}

      {activeTab === 'trend' && trendPanel}

      {activeTab === 'prompts' && (
      <Section title="Prompt leaderboard">
        {prompts.length === 0 ? (
          <div className="space-y-2">
            <EmptySectionMessage
              text="No prompt versions registered yet."
              hint="The Prompt Lab can create candidates to A/B against the active classifier prompt."
            />
            <ActionPillRow>
              <ActionPill to="/prompt-lab" tone="brand">
                Open Prompt Lab →
              </ActionPill>
            </ActionPillRow>
          </div>
        ) : (
          <ResponsiveTable className="-mx-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-fg-muted text-left border-b border-edge">
                  <th className="py-1.5 px-3 font-medium">Stage</th>
                  <th className="py-1.5 px-3 font-medium">Version</th>
                  <th className="py-1.5 px-3 font-medium">Status</th>
                  <th className="py-1.5 px-3 font-medium text-right">Score</th>
                  <th className="py-1.5 px-3 font-medium text-right">Evals</th>
                  <th className="py-1.5 px-3 font-medium text-right">Traffic</th>
                </tr>
              </thead>
              <tbody>
                {prompts.map((p) => {
                  const isSelected =
                    promptFilter?.version === p.version && promptFilter?.stage === p.stage
                  const toggle = () => {
                    const next = isSelected ? null : { version: p.version, stage: p.stage }
                    setPromptFilter(next)
                    if (next) setActiveTab('evaluations')
                  }
                  return (
                    <tr
                      key={p.id}
                      onClick={toggle}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggle()
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-pressed={isSelected}
                      aria-label={`Filter recent evaluations by prompt ${p.version}`}
                      title={
                        isSelected
                          ? 'Click to clear the filter'
                          : `Click to filter Recent evaluations by ${p.version}`
                      }
                      className={`cursor-pointer border-b border-edge-subtle text-fg-secondary outline-none transition-colors hover:bg-surface-overlay/40 focus-visible:bg-surface-overlay/60 focus-visible:ring-1 focus-visible:ring-brand/60 ${
                        isSelected ? 'bg-brand/10 text-fg' : ''
                      }`}
                    >
                      <td className="py-1.5 px-3 font-mono text-fg-faint">{p.stage}</td>
                      <td className="py-1.5 px-3 font-mono text-fg">{p.version}</td>
                      <td className="py-1.5 px-3">
                        {p.is_active && (
                          <Badge className="bg-ok/15 text-ok border border-ok/30">active</Badge>
                        )}
                        {p.is_candidate && (
                          <Badge className="bg-info/15 text-info border border-info/30 ml-1">candidate</Badge>
                        )}
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        <ScorePill value={p.avg_judge_score} />
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                        {p.total_evaluations}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums text-fg-faint">
                        {p.traffic_percentage}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ResponsiveTable>
        )}
      </Section>
      )}

      {activeTab === 'evaluations' && (
      <Section
        title="Recent evaluations"
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            {disagreementOnly && (
              <button
                type="button"
                onClick={() => {
                  const next = new URLSearchParams(searchParams)
                  next.delete('filter')
                  setSearchParams(next, { replace: true })
                }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-2xs rounded-sm border border-warn/40 ${CHIP_TONE.warnSubtle} hover:bg-warn/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warn/60`}
                aria-label="Clear disagreement filter"
              >
                <span>Disagreements only</span>
                <span aria-hidden="true">×</span>
              </button>
            )}
            {promptFilter && (
              <button
                type="button"
                onClick={() => setPromptFilter(null)}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-2xs rounded-sm border border-brand/40 bg-brand/10 text-brand hover:bg-brand/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60"
                aria-label={`Clear filter on prompt ${promptFilter.version}`}
                title="Clear prompt filter"
              >
                <span>Filtered: {promptFilter.version}</span>
                <span aria-hidden="true">×</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setSort('recent')}
              className={`px-2 py-0.5 text-2xs rounded-sm border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60 ${sort === 'recent' ? 'border-edge bg-surface-raised text-fg' : 'border-edge-subtle text-fg-faint'}`}
            >
              Recent
            </button>
            <button
              type="button"
              onClick={() => setSort('score_asc')}
              className={`px-2 py-0.5 text-2xs rounded-sm border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60 ${sort === 'score_asc' ? 'border-edge bg-surface-raised text-fg' : 'border-edge-subtle text-fg-faint'}`}
            >
              Lowest score
            </button>
          </div>
        }
      >
        {evals.length === 0 ? (
          <EmptySectionMessage
            text="No evaluations match."
            hint={
              disagreementOnly || promptFilter
                ? 'Clear the active filter or run judge now to seed fresh evaluations.'
                : 'Run judge now or wait for the nightly cron to score classified reports.'
            }
          />
        ) : (
          <ResponsiveTable className="-mx-3">
            <table className="w-full text-xs" data-dav-anchor="judge:verify">
              <thead>
                <tr className="text-fg-muted text-left border-b border-edge">
                  <th className="py-1.5 px-3 font-medium">Report</th>
                  <th className="py-1.5 px-3 font-medium">When</th>
                  <th className="py-1.5 px-3 font-medium">Model</th>
                  <th className="py-1.5 px-3 font-medium">Prompt</th>
                  <th className="py-1.5 px-3 font-medium text-right">
                    <HeaderTip short="Score" />
                  </th>
                  <th className="py-1.5 px-3 font-medium text-right">
                    <HeaderTip short="Acc" />
                  </th>
                  <th className="py-1.5 px-3 font-medium text-right">
                    <HeaderTip short="Sev" />
                  </th>
                  <th className="py-1.5 px-3 font-medium text-right">
                    <HeaderTip short="Comp" />
                  </th>
                  <th className="py-1.5 px-3 font-medium text-right">
                    <HeaderTip short="Repro" />
                  </th>
                  <th className="py-1.5 px-3 font-medium">
                    <Tooltip content="Did the classifier agree with the user's own category submission? ✓ = agreed, ✗ = overrode the user's pick.">
                      <span className="cursor-help underline decoration-dotted decoration-fg-faint/40 underline-offset-2">Agreed</span>
                    </Tooltip>
                  </th>
                </tr>
              </thead>
              <tbody>
                {evals.map((e) => {
                  const summary = e.report_summary?.trim()
                  const display = summary && summary.length > 0
                    ? summary
                    : `Report ${e.report_id.slice(0, 8)}…`
                  // Surface the judge's disagreement reasoning inline so
                  // operators don't have to click into the report to see why
                  // the classifier and judge diverged. Tooltip carries the
                  // full text. .
                  const disagreementReason =
                    e.classification_agreed === false ? e.judge_reasoning?.trim() : null
                  return (
                    <tr key={e.id} className="border-b border-edge-subtle text-fg-secondary hover:bg-surface-overlay/30">
                      <td className="py-1.5 px-3 max-w-[22rem]">
                        <Link
                          to={`/reports/${e.report_id}`}
                          className="text-brand hover:text-brand-hover line-clamp-1 leading-snug"
                          title={summary ?? undefined}
                        >
                          {display}
                        </Link>
                        <InlineProof className="mt-0.5 border-0 bg-transparent px-0 py-0 font-mono text-3xs">
                          {e.report_id.slice(0, 8)}
                          {e.report_severity && (
                            <>
                              {' '}
                              <SignalChip tone="warn" className="ml-1 normal-case font-sans">
                                {e.report_severity}
                              </SignalChip>
                            </>
                          )}
                        </InlineProof>
                        {disagreementReason && (
                          <Tooltip content={disagreementReason}>
                            <p className="mt-1 text-3xs text-warn line-clamp-1 cursor-help italic">
                              ⚠ {disagreementReason}
                            </p>
                          </Tooltip>
                        )}
                      </td>
                      <td className="py-1.5 px-3 text-fg-faint text-2xs">
                        <RelativeTime value={e.created_at} />
                      </td>
                      <td className="py-1.5 px-3 truncate max-w-[12rem]">
                        <SignalChip tone="neutral" className="font-mono">
                          {e.judge_model ?? '—'}
                        </SignalChip>
                        {e.judge_fallback_used && (
                          <Tooltip content="Primary judge model failed; fallback model graded this report.">
                            <SignalChip tone="warn" className="ml-1 cursor-help">
                              fallback
                            </SignalChip>
                          </Tooltip>
                        )}
                      </td>
                      <td className="py-1.5 px-3">
                        <SignalChip tone="neutral" className="font-mono">
                          {e.prompt_version ?? '—'}
                        </SignalChip>
                      </td>
                      <td className="py-1.5 px-3 text-right"><ScorePill value={e.judge_score} /></td>
                      <td className="py-1.5 px-3 text-right"><ScorePill value={e.accuracy_score} /></td>
                      <td className="py-1.5 px-3 text-right"><ScorePill value={e.severity_score} /></td>
                      <td className="py-1.5 px-3 text-right"><ScorePill value={e.component_score} /></td>
                      <td className="py-1.5 px-3 text-right"><ScorePill value={e.repro_score} /></td>
                      <td className="py-1.5 px-3">
                        {e.classification_agreed === true && (
                          <span className="text-ok text-xs">✓</span>
                        )}
                        {e.classification_agreed === false && (
                          <span className="text-danger text-xs">✗</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ResponsiveTable>
        )}
      </Section>
      )}

    </div>
  )
}

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="11"
      height="11"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3.5 2.6v10.8c0 .9 1 1.4 1.7.9l8.3-5.4a1.1 1.1 0 0 0 0-1.8L5.2 1.7a1.1 1.1 0 0 0-1.7.9z" />
    </svg>
  )
}
