/**
 * Visible explainer for classifier vs judge on the Judge page.
 */

import { Link } from 'react-router-dom'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  JUDGE_EXPLAINER_SUMMARY,
  JUDGE_PIPELINE_STEPS,
  JUDGE_SCORE_DIMENSIONS_PLAIN,
} from '../../lib/judgeExplainer'
import { judgeStageOverlay } from '../../lib/guideLiveOverlay'
import type { JudgeStats, JudgeTopPriority } from './JudgeStatsTypes'

interface Props {
  topPriority?: JudgeTopPriority
  stats?: Pick<
    JudgeStats,
    | 'totalEvaluations'
    | 'disagreementCount'
    | 'disagreementRatePct'
    | 'latestWeekScore'
    | 'topPriority'
  >
}

export function JudgePipelineGuide({ topPriority, stats }: Props) {
  const needsGuidance =
    topPriority === 'no_evals' ||
    topPriority === 'low_score' ||
    topPriority === 'disagreements' ||
    topPriority === 'drifting' ||
    topPriority === 'stale'

  const live = stats ?? {
    totalEvaluations: 0,
    disagreementCount: 0,
    disagreementRatePct: null,
    latestWeekScore: null,
    topPriority: topPriority ?? 'healthy',
  }

  return (
    <FeatureExplainPanel
      title="Classifier vs Judge — what each one does"
      summary={JUDGE_EXPLAINER_SUMMARY}
      defaultOpen={needsGuidance}
    >
      <div className="space-y-1">
        {JUDGE_PIPELINE_STEPS.map((step) => {
          const overlay = judgeStageOverlay(step.id, live)
          return (
            <WorkflowStageRow
              key={step.id}
              id={step.id}
              shortLabel={step.label}
              metric={overlay.metric}
              posture={overlay.posture}
              plain={`${step.when} — ${step.measures}`}
              actionLine={overlay.actionLine}
            />
          )
        })}
      </div>
      <div>
        <p className="mb-1.5 text-3xs font-semibold uppercase tracking-wider text-fg-faint">
          Score rubric
        </p>
        <ul className="list-disc pl-4 space-y-0.5 text-2xs text-fg-secondary">
          {JUDGE_SCORE_DIMENSIONS_PLAIN.map((dim) => (
            <li key={dim.key}>
              <span className="font-medium text-fg">{dim.label}</span> — {dim.plain}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-2xs text-fg-faint">
        Tune classifier prompts in{' '}
        <Link to="/prompt-lab?tab=prompts" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors">
          Prompt Lab
        </Link>
        . Disagreements appear under the Evaluations tab.
      </p>
    </FeatureExplainPanel>
  )
}
