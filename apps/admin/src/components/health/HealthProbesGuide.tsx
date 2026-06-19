/**
 * Visible LLM / cron / activity probe guide for Health page.
 */

import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  HEALTH_EXPLAINER_SUMMARY,
  HEALTH_PROBE_TABS,
  isHealthGuideExpanded,
} from '../../lib/healthExplainer'
import type { HealthTopPriority } from './HealthStatsTypes'

interface Props {
  topPriority?: HealthTopPriority
}

export function HealthProbesGuide({ topPriority }: Props) {
  return (
    <FeatureExplainPanel
      title="LLM, cron, and activity tabs explained"
      summary={HEALTH_EXPLAINER_SUMMARY}
      defaultOpen={isHealthGuideExpanded(topPriority)}
    >
      <div className="space-y-1">
        {HEALTH_PROBE_TABS.map((tab) => (
          <WorkflowStageRow
            key={tab.id}
            id={tab.id}
            shortLabel={tab.label}
            posture="info"
            plain={tab.plain}
            actionLine={`Red means: ${tab.redMeans}`}
          />
        ))}
      </div>
    </FeatureExplainPanel>
  )
}
