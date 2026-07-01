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
import { rewardsConceptOverlay } from '../../lib/guideLiveOverlay'
import type { RewardsStats, RewardsTopPriority } from './types'

interface Props {
  topPriority?: RewardsTopPriority
  stats?: Pick<RewardsStats, 'topPriority' | 'enabledRulesCount'>
}

export function RewardsEconomyGuide({ topPriority, stats }: Props) {
  const live = {
    topPriority: stats?.topPriority ?? topPriority ?? 'healthy',
    openRules: stats?.enabledRulesCount,
  }

  return (
    <FeatureExplainPanel
      title="Rules, tiers, and webhooks — how points flow"
      summary={REWARDS_EXPLAINER_SUMMARY}
      defaultOpen={isRewardsGuideExpanded(topPriority)}
    >
      <div className="grid gap-1 sm:grid-cols-2">
        {REWARDS_ECONOMY_CONCEPTS.map((concept) => {
          const overlay = rewardsConceptOverlay(concept.id, live)
          return (
            <WorkflowStageRow
              key={concept.id}
              id={concept.id}
              shortLabel={concept.label}
              metric={overlay.metric}
              posture={overlay.posture}
              plain={concept.plain}
            />
          )
        })}
      </div>
    </FeatureExplainPanel>
  )
}
