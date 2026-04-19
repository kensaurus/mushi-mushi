import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import {
  PageHeader,
  PageHelp,
  Card,
  Loading,
  ErrorAlert,
  EmptyState,
  Btn,
  Badge,
  Section,
  RelativeTime,
  Tooltip,
} from '../components/ui'
import {
  KpiTile,
  KpiRow,
  LineSparkline,
  Histogram,
  formatPct,
} from '../components/charts'
import { SCORE_COLORS } from '../lib/tokens'
import { useToast } from '../lib/toast'

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
    <div className="flex items-center gap-2">
      <span className="text-2xs text-fg-muted w-20 cursor-help">{label}</span>
      <div className="flex-1 h-2 bg-surface-root rounded-full overflow-hidden">
        <div
          className="h-full rounded-full motion-safe:transition-all motion-safe:duration-500"
          style={{ width: `${(value * 100).toFixed(0)}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-2xs text-fg-secondary w-9 text-right font-mono tabular-nums">
        {(value * 100).toFixed(0)}%
      </span>
    </div>
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
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-3xs text-fg-faint">
      {SCORE_DIMENSIONS.map((d) => (
        <Tooltip key={d.key} content={d.description}>
          <span className="inline-flex items-center gap-1 cursor-help">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: SCORE_COLORS[d.key] }}
              aria-hidden="true"
            />
            {d.label}
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
  const tone = value >= 0.8 ? 'text-ok' : value >= 0.6 ? 'text-warn' : 'text-danger'
  return <span className={`font-mono tabular-nums ${tone}`}>{(value * 100).toFixed(0)}%</span>
}

export function JudgePage() {
  const toast = useToast()
  const [sort, setSort] = useState<'recent' | 'score_asc'>('recent')
  const [running, setRunning] = useState(false)

  const weeksQuery = usePageData<{ weeks: WeekData[] }>('/v1/admin/judge-scores')
  const evalsQuery = usePageData<{ evaluations: EvalRow[] }>(
    `/v1/admin/judge/evaluations?limit=50&sort=${sort === 'score_asc' ? 'score_asc' : 'recent'}`,
  )
  const promptsQuery = usePageData<{ prompts: PromptRow[] }>('/v1/admin/judge/prompts')
  const distQuery = usePageData<Distribution>('/v1/admin/judge/distribution')

  const weeks = weeksQuery.data?.weeks ?? []
  const evals = evalsQuery.data?.evaluations ?? []
  const prompts = promptsQuery.data?.prompts ?? []
  const dist = distQuery.data ?? null
  const loading = weeksQuery.loading || evalsQuery.loading || promptsQuery.loading || distQuery.loading
  const error = weeksQuery.error ?? evalsQuery.error ?? promptsQuery.error ?? distQuery.error

  const loadAll = useCallback(() => {
    weeksQuery.reload()
    evalsQuery.reload()
    promptsQuery.reload()
    distQuery.reload()
  }, [weeksQuery, evalsQuery, promptsQuery, distQuery])

  async function runNow() {
    setRunning(true)
    const res = await apiFetch<{ dispatched: number }>('/v1/admin/judge/run', { method: 'POST' })
    setRunning(false)
    if (res.ok) {
      toast.success('Judge batch dispatched', `${res.data?.dispatched ?? 0} project(s). Refreshing in ~30s.`)
      setTimeout(loadAll, 30_000)
    } else {
      toast.error('Failed to run judge batch', res.error?.message)
    }
  }

  if (loading) return <Loading text="Loading judge…" />
  if (error) return <ErrorAlert message={`Failed to load judge data: ${error}`} onRetry={loadAll} />

  const latest = weeks[0]
  const previous = weeks[1]
  const drift =
    latest && previous && previous.avg_score > 0
      ? (previous.avg_score - latest.avg_score) / previous.avg_score
      : 0

  const totalEvals = weeks.reduce((s, w) => s + w.eval_count, 0)
  const trendValues = [...weeks].reverse().map((w) => w.avg_score)

  return (
    <div className="space-y-4">
      <PageHeader title="Judge">
        <Btn size="sm" variant="ghost" onClick={runNow} disabled={running}>
          {running ? 'Dispatching…' : 'Run judge now'}
        </Btn>
      </PageHeader>

      <PageHelp
        title="About the Judge"
        whatIsIt="A second LLM that grades the classifier's output on every report — accuracy, severity, component, and reproduction quality. Scores feed both the weekly aggregate and the per-prompt leaderboard."
        useCases={[
          'Detect when the classifier silently degrades after a model or prompt change',
          'Compare prompt versions head-to-head on real reports',
          'Decide whether to roll back, fork, or promote a prompt',
        ]}
        howToUse='Click "Run judge now" to score recent unjudged reports immediately. The leaderboard ranks prompt versions by mean judge score; click a row to see the evaluations that drove it.'
      />

      <KpiRow cols={4}>
        <KpiTile
          label="Latest week"
          value={latest ? formatPct(latest.avg_score) : '—'}
          sublabel={latest ? `${latest.eval_count} evals` : 'No evals yet'}
          accent={latest && latest.avg_score >= 0.8 ? 'ok' : latest && latest.avg_score >= 0.6 ? 'warn' : 'danger'}
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
        />
        <KpiTile
          label="Prompt versions"
          value={prompts.length}
          sublabel={`${prompts.filter((p) => p.is_active).length} active · ${prompts.filter((p) => p.is_candidate).length} candidate`}
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
        />
      </KpiRow>

      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <Section title="Score trend (12w)">
          {weeks.length === 0 ? (
            <EmptyState
              title="No evaluations yet"
              description='Click "Run judge now" above to score recent reports.'
            />
          ) : (
            <>
              <LineSparkline values={trendValues} accent="text-brand" height={42} ariaLabel="Weekly judge score trend" />
              {latest && (
                <>
                  <div className="mt-3 space-y-1">
                    <ScoreBar
                      label="Overall"
                      value={latest.avg_score}
                      color={SCORE_COLORS.overall}
                      description={DIMENSION_TOOLTIPS.Score}
                    />
                    <ScoreBar
                      label="Accuracy"
                      value={latest.avg_accuracy}
                      color={SCORE_COLORS.accuracy}
                      description={DIMENSION_TOOLTIPS.Acc}
                    />
                    <ScoreBar
                      label="Severity"
                      value={latest.avg_severity}
                      color={SCORE_COLORS.severity}
                      description={DIMENSION_TOOLTIPS.Sev}
                    />
                    <ScoreBar
                      label="Component"
                      value={latest.avg_component}
                      color={SCORE_COLORS.component}
                      description={DIMENSION_TOOLTIPS.Comp}
                    />
                    <ScoreBar
                      label="Repro"
                      value={latest.avg_repro}
                      color={SCORE_COLORS.repro}
                      description={DIMENSION_TOOLTIPS.Repro}
                    />
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
                labels={['0', '', '', '', '', '5', '', '', '', '10']}
                accent="bg-brand/70"
                height={90}
              />
              <p className="text-2xs text-fg-faint mt-2">
                {dist.total} evals · 0–100 scale, deciles
              </p>
            </>
          ) : (
            <p className="text-xs text-fg-muted">
              No scored evaluations yet.
            </p>
          )}
        </Section>
      </div>

      <Section title="Prompt leaderboard">
        {prompts.length === 0 ? (
          <p className="text-xs text-fg-muted">
            No prompt versions registered yet. The Prompt Lab can create candidates.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-3">
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
                {prompts.map((p) => (
                  <tr key={p.id} className="border-b border-edge-subtle text-fg-secondary">
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Recent evaluations"
        action={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSort('recent')}
              className={`px-2 py-0.5 text-2xs rounded-sm border ${sort === 'recent' ? 'border-edge bg-surface-raised text-fg' : 'border-edge-subtle text-fg-faint'}`}
            >
              Recent
            </button>
            <button
              type="button"
              onClick={() => setSort('score_asc')}
              className={`px-2 py-0.5 text-2xs rounded-sm border ${sort === 'score_asc' ? 'border-edge bg-surface-raised text-fg' : 'border-edge-subtle text-fg-faint'}`}
            >
              Lowest score
            </button>
          </div>
        }
      >
        {evals.length === 0 ? (
          <p className="text-xs text-fg-muted">No evaluations match.</p>
        ) : (
          <div className="overflow-x-auto -mx-3">
            <table className="w-full text-xs">
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
                        <div className="text-3xs text-fg-faint font-mono mt-0.5">
                          {e.report_id.slice(0, 8)}
                          {e.report_severity && (
                            <span className="ml-1.5 normal-case">· {e.report_severity}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 px-3 text-fg-faint text-2xs">
                        <RelativeTime value={e.created_at} />
                      </td>
                      <td className="py-1.5 px-3 font-mono text-2xs text-fg-faint truncate max-w-[12rem]">
                        {e.judge_model ?? '—'}
                        {e.judge_fallback_used && (
                          <Tooltip content="Primary judge model failed; fallback model graded this report.">
                            <span className="ml-1 text-warn cursor-help">⚠</span>
                          </Tooltip>
                        )}
                      </td>
                      <td className="py-1.5 px-3 font-mono text-2xs text-fg-faint">{e.prompt_version ?? '—'}</td>
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
          </div>
        )}
      </Section>

      {weeks.length > 0 && (
        <Section title="Weekly history">
          <div className="overflow-x-auto -mx-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-fg-muted text-left border-b border-edge">
                  <th className="py-1.5 px-3 font-medium">Week</th>
                  <th className="py-1.5 px-3 font-medium text-right">
                    <HeaderTip short="Score" />
                  </th>
                  <th className="py-1.5 px-3 font-medium text-right">
                    <HeaderTip short="Accuracy" full={DIMENSION_TOOLTIPS.Acc} />
                  </th>
                  <th className="py-1.5 px-3 font-medium text-right">
                    <HeaderTip short="Severity" full={DIMENSION_TOOLTIPS.Sev} />
                  </th>
                  <th className="py-1.5 px-3 font-medium text-right">
                    <HeaderTip short="Component" full={DIMENSION_TOOLTIPS.Comp} />
                  </th>
                  <th className="py-1.5 px-3 font-medium text-right">
                    <HeaderTip short="Repro" />
                  </th>
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
          </div>
        </Section>
      )}

      {weeks.length === 0 && evals.length === 0 && prompts.length === 0 && (
        <Card className="p-3 border-info/20 bg-info-muted/10">
          <p className="text-xs text-fg-muted">
            Tip: judge runs nightly via cron. Use <strong>Run judge now</strong> to seed
            evaluations immediately on a fresh project.
          </p>
        </Card>
      )}
    </div>
  )
}
