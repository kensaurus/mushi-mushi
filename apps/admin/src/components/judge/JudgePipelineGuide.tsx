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
import type { JudgeTopPriority } from './JudgeStatsTypes'

interface Props {
  topPriority?: JudgeTopPriority
}

export function JudgePipelineGuide({ topPriority }: Props) {
  const needsGuidance =
    topPriority === 'no_evals' ||
    topPriority === 'low_score' ||
    topPriority === 'disagreements' ||
    topPriority === 'drifting' ||
    topPriority === 'stale'

  return (
    <FeatureExplainPanel
      title="Classifier vs Judge — what each one does"
      summary={JUDGE_EXPLAINER_SUMMARY}
      defaultOpen={needsGuidance}
    >
      <div className="space-y-1">
        {JUDGE_PIPELINE_STEPS.map((step) => (
          <WorkflowStageRow
            key={step.id}
            id={step.id}
            shortLabel={step.label}
            posture="info"
            plain={`${step.when} — ${step.measures}`}
          />
        ))}
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
        <Link to="/prompt-lab?tab=prompts" className="text-brand hover:underline">
          Prompt Lab
        </Link>
        . Disagreements appear under the Evaluations tab.
      </p>
    </FeatureExplainPanel>
  )
}
