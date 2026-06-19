/**
 * Visible Prompt Lab workflow guide.
 */

import { Link } from 'react-router-dom'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  PROMPT_LAB_EXPLAINER_SUMMARY,
  PROMPT_LAB_WORKFLOW,
  PROMPT_STAGE_PLAIN,
} from '../../lib/promptLabExplainer'
import type { PromptLabTopPriority } from './PromptLabStatsTypes'

interface Props {
  topPriority?: PromptLabTopPriority
}

export function PromptLabGuide({ topPriority }: Props) {
  const needsGuidance =
    topPriority === 'no_dataset' ||
    topPriority === 'untested_ab' ||
    topPriority === 'promote_ready' ||
    topPriority === 'candidates_idle'

  return (
    <FeatureExplainPanel
      title="How prompt tuning works"
      summary={PROMPT_LAB_EXPLAINER_SUMMARY}
      defaultOpen={needsGuidance}
    >
      <div className="space-y-1">
        {PROMPT_LAB_WORKFLOW.map((step, i) => (
          <WorkflowStageRow
            key={step.id}
            id={step.id}
            shortLabel={step.label}
            posture="info"
            metric={`${i + 1}`}
            plain={step.plain}
          />
        ))}
      </div>
      <div>
        <p className="mb-1 text-3xs font-semibold uppercase tracking-wider text-fg-faint">
          Pipeline stages
        </p>
        <ul className="list-disc pl-4 space-y-0.5 text-2xs text-fg-muted">
          {Object.entries(PROMPT_STAGE_PLAIN).map(([key, plain]) => (
            <li key={key}>
              <span className="font-mono text-fg-secondary">{key}</span> — {plain}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-2xs text-fg-faint">
        Eval scores come from{' '}
        <Link to="/judge" className="text-brand hover:underline">
          Judge
        </Link>
        . Never promote a candidate without a judge score ≥ 80%.
      </p>
    </FeatureExplainPanel>
  )
}
