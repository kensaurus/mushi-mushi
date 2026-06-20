/**
 * Visible rewards economy guide.
 */

import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  REWARDS_ECONOMY_CONCEPTS,
  REWARDS_EXPLAINER_SUMMARY,
  isRewardsGuideExpanded,
} from '../../lib/rewardsExplainer'
import type { RewardsTopPriority } from './types'

interface Props {
  topPriority?: RewardsTopPriority
}

export function RewardsEconomyGuide({ topPriority }: Props) {
  return (
    <FeatureExplainPanel
      title="Rules, tiers, and webhooks — how points flow"
      summary={REWARDS_EXPLAINER_SUMMARY}
      defaultOpen={isRewardsGuideExpanded(topPriority)}
    >
      <div className="grid gap-1 sm:grid-cols-2">
        {REWARDS_ECONOMY_CONCEPTS.map((concept) => (
          <WorkflowStageRow
            key={concept.id}
            id={concept.id}
            shortLabel={concept.label}
            posture="info"
            plain={concept.plain}
          />
        ))}
      </div>
    </FeatureExplainPanel>
  )
}
