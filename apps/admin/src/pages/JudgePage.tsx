import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { PageHeader, PageHelp, Card, Loading, ErrorAlert, EmptyState } from '../components/ui'
import { SCORE_COLORS } from '../lib/tokens'

interface WeekData {
  week_start: string
  avg_score: number
  avg_accuracy: number
  avg_severity: number
  avg_component: number
  avg_repro: number
  eval_count: number
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xs text-fg-muted w-20">{label}</span>
      <div className="flex-1 h-2 bg-surface-root rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${(value * 100).toFixed(0)}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-2xs text-fg-secondary w-9 text-right font-mono tabular-nums">{(value * 100).toFixed(0)}%</span>
    </div>
  )
}

export function JudgePage() {
  const [weeks, setWeeks] = useState<WeekData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  function loadScores() {
    setLoading(true)
    setError(false)
    apiFetch<{ weeks: WeekData[] }>('/v1/admin/judge-scores')
      .then(res => {
        if (res.ok) setWeeks(res.data?.weeks ?? [])
        else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadScores() }, [])

  if (loading) return <Loading text="Loading judge scores..." />
  if (error) return <ErrorAlert message="Failed to load judge scores." onRetry={loadScores} />

  const latest = weeks[0]
  const previous = weeks[1]
  const drift = latest && previous && previous.avg_score > 0
    ? ((previous.avg_score - latest.avg_score) / previous.avg_score * 100)
    : 0

  return (
    <div className="space-y-4">
      <PageHeader title="Self-Improvement Dashboard" />

      <PageHelp
        title="About the Judge"
        whatIsIt="A second LLM that grades the classifier's output on every report — accuracy, severity, component, and reproduction quality. Scores are aggregated weekly to track model drift over time."
        useCases={[
          'Detect when the classifier silently degrades after a model or prompt change',
          'Decide whether to roll back a prompt update or trigger a new fine-tuning run',
          'Justify the quality of automated triage to stakeholders with hard numbers',
        ]}
        howToUse="Run the judge-batch worker on a schedule. The current week summary highlights week-over-week drift; the history table shows the full trend."
      />

      {latest ? (
        <Card className="p-3 space-y-2">
          <div className="flex justify-between items-center mb-1">
            <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Current Week</h3>
            <span className="text-2xs text-fg-faint font-mono">{latest.eval_count} evaluations</span>
          </div>

          <ScoreBar label="Overall" value={latest.avg_score} color={SCORE_COLORS.overall} />
          <ScoreBar label="Accuracy" value={latest.avg_accuracy} color={SCORE_COLORS.accuracy} />
          <ScoreBar label="Severity" value={latest.avg_severity} color={SCORE_COLORS.severity} />
          <ScoreBar label="Component" value={latest.avg_component} color={SCORE_COLORS.component} />
          <ScoreBar label="Repro" value={latest.avg_repro} color={SCORE_COLORS.repro} />

          {drift > 10 && (
            <div className="mt-2 px-2.5 py-1.5 bg-danger-muted/50 border border-danger/20 rounded-sm text-xs text-danger">
              Drift alert: scores dropped {drift.toFixed(1)}% week-over-week
            </div>
          )}
          {drift > 0 && drift <= 10 && (
            <div className="mt-2 px-2.5 py-1.5 bg-warn-muted/50 border border-warn/20 rounded-sm text-xs text-warn">
              Minor decline: {drift.toFixed(1)}% week-over-week
            </div>
          )}
          {drift <= 0 && previous && (
            <div className="mt-2 px-2.5 py-1.5 bg-ok-muted/50 border border-ok/20 rounded-sm text-xs text-ok">
              Scores improved or stable
            </div>
          )}
        </Card>
      ) : (
        <EmptyState
          title="No evaluations yet"
          description="Run the judge-batch worker to score recent classifications. Scores will appear here weekly."
        />
      )}

      {weeks.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider mb-2">Weekly History</h3>
          <Card className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-fg-muted text-left border-b border-edge">
                  <th className="py-1.5 px-3 font-medium">Week</th>
                  <th className="py-1.5 px-3 font-medium">Score</th>
                  <th className="py-1.5 px-3 font-medium">Accuracy</th>
                  <th className="py-1.5 px-3 font-medium">Severity</th>
                  <th className="py-1.5 px-3 font-medium">Component</th>
                  <th className="py-1.5 px-3 font-medium">Repro</th>
                  <th className="py-1.5 px-3 font-medium">Evals</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map(w => (
                  <tr key={w.week_start} className="border-b border-edge-subtle text-fg-secondary">
                    <td className="py-1.5 px-3">{w.week_start}</td>
                    <td className="py-1.5 px-3 font-mono tabular-nums">{(w.avg_score * 100).toFixed(0)}%</td>
                    <td className="py-1.5 px-3 font-mono tabular-nums">{(w.avg_accuracy * 100).toFixed(0)}%</td>
                    <td className="py-1.5 px-3 font-mono tabular-nums">{(w.avg_severity * 100).toFixed(0)}%</td>
                    <td className="py-1.5 px-3 font-mono tabular-nums">{(w.avg_component * 100).toFixed(0)}%</td>
                    <td className="py-1.5 px-3 font-mono tabular-nums">{(w.avg_repro * 100).toFixed(0)}%</td>
                    <td className="py-1.5 px-3 font-mono tabular-nums">{w.eval_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  )
}
