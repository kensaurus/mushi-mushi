/**
 * Visible LLM cost stage guide — what each operation category spends on.
 */

import { Link } from 'react-router-dom'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import { COST_EXPLAINER_SUMMARY, COST_STAGE_DEFINITIONS } from '../../lib/costExplainer'
import type { CostTopPriority } from '../../lib/costExplainer'

interface Props {
  topPriority?: CostTopPriority
  topOperation?: string | null
}

export function CostStageGuide({ topPriority, topOperation }: Props) {
  const needsGuidance =
    topPriority === 'no_calls' ||
    topPriority === 'spike' ||
    topPriority === 'failed' ||
    topPriority === 'byok_recommended'

  return (
    <FeatureExplainPanel
      title="What drives AI spend in the loop"
      summary={COST_EXPLAINER_SUMMARY}
      defaultOpen={needsGuidance}
    >
      <div className="space-y-1">
        {COST_STAGE_DEFINITIONS.map((stage) => {
          const isTop = topOperation && stage.category === topOperation
          return (
            <WorkflowStageRow
              key={stage.category}
              id={stage.category}
              shortLabel={stage.label}
              metric={isTop ? 'Top driver' : undefined}
              posture={isTop ? 'warn' : 'info'}
              plain={stage.plain}
              examples={stage.examples ? stage.examples.split(', ') : undefined}
            />
          )
        })}
      </div>
      <p className="text-2xs text-fg-faint">
        Add your own key under{' '}
        <Link to="/settings?tab=byok" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors">
          Settings → AI keys
        </Link>{' '}
        to bill Anthropic directly instead of platform credits.
      </p>
    </FeatureExplainPanel>
  )
}
