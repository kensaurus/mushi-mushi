/**
 * FILE: apps/admin/src/components/dashboard/EvolutionHistoryWidget.tsx
 * PURPOSE: Shows the last 8 weeks of judge scores as a mini sparkline +
 *          a convergence badge ("loop converging" / "loop stalling") next to
 *          the KPI row on the Dashboard.
 *
 *          Data: /v1/admin/dashboard/evolution-history → calls
 *          weekly_judge_scores(project_id, 8) RPC on the server.
 */

import { Link } from 'react-router-dom'
import { usePageData } from '../../lib/usePageData'
import { Tooltip } from '../ui'

interface WeekBucket {
  week_start: string
  avg_score: number | null
  fix_count: number
}

interface EvolutionData {
  weeks: WeekBucket[]
  avg_score_last4w: number | null
  avg_score_prev4w: number | null
  converging: boolean | null
  lesson_count: number
  prompt_promotions_30d: number
}

interface Props {
  projectId: string | null
}

const MAX_SCORE = 10

function Spark({ weeks }: { weeks: WeekBucket[] }) {
  if (!weeks.length) return null
  const h = 24
  const w = 8
  const gap = 3
  const total = weeks.length * w + (weeks.length - 1) * gap
  const maxScore = MAX_SCORE

  return (
    <svg
      width={total}
      height={h}
      aria-hidden="true"
      className="shrink-0"
    >
      {weeks.map((wk, i) => {
        const score = wk.avg_score ?? 0
        const barH = Math.max(2, Math.round((score / maxScore) * h))
        const x = i * (w + gap)
        const y = h - barH
        const tone =
          score >= 7
            ? 'var(--color-viz-score-ok)'
            : score >= 5
              ? 'var(--color-viz-score-warn)'
              : 'var(--color-viz-score-danger)'
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={w}
            height={barH}
            rx={2}
            fill={tone}
            opacity={0.8}
          />
        )
      })}
    </svg>
  )
}

export function EvolutionHistoryWidget({ projectId }: Props) {
  const path = projectId
    ? `/v1/admin/projects/${projectId}/evolution-history`
    : null

  const { data, loading } = usePageData<EvolutionData>(path)

  if (loading || !data || !data.weeks.length) return null

  const converging = data.converging
  const avgScore = data.avg_score_last4w

  const badge =
    converging === true ? (
      <span className="inline-flex items-center gap-1 text-2xs font-medium text-ok">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-ok" />
        loop converging
      </span>
    ) : converging === false ? (
      <span className="inline-flex items-center gap-1 text-2xs font-medium text-warn">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-warn" />
        loop stalling
      </span>
    ) : null

  return (
    <Tooltip
      content={`Judge scores last 8 weeks. ${data.lesson_count} active lessons · ${data.prompt_promotions_30d} prompt promotions this month.`}
      side="top"
      portal
    >
      <Link
        to="/judge"
        className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-surface-raised transition-opacity"
        aria-label={`Evolution loop: avg judge score ${avgScore?.toFixed(1) ?? '—'} / 10`}
      >
        <Spark weeks={data.weeks} />
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-2xs text-fg-muted">Judge avg</span>
          <span className="text-sm font-semibold font-mono text-fg leading-none">
            {avgScore != null ? avgScore.toFixed(1) : '—'}
            <span className="text-2xs font-normal text-fg-faint">/10</span>
          </span>
        </div>
        {badge}
      </Link>
    </Tooltip>
  )
}
