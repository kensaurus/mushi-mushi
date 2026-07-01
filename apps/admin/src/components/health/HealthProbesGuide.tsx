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
import { healthProbeOverlay } from '../../lib/guideLiveOverlay'
import type { HealthStats, HealthTopPriority } from './HealthStatsTypes'

interface Props {
  topPriority?: HealthTopPriority
  stats?: Pick<
    HealthStats,
    'errorRatePct' | 'cronErrorCount' | 'cronStaleCount' | 'cronWarnCount' | 'redCount' | 'topPriority'
  >
}

export function HealthProbesGuide({ topPriority, stats }: Props) {
  const live = stats ?? {
    errorRatePct: 0,
    cronErrorCount: 0,
    cronStaleCount: 0,
    cronWarnCount: 0,
    redCount: 0,
    topPriority: topPriority ?? 'healthy',
  }

  return (
    <FeatureExplainPanel
      title="LLM, cron, and activity tabs explained"
      summary={HEALTH_EXPLAINER_SUMMARY}
      defaultOpen={isHealthGuideExpanded(topPriority)}
    >
      <div className="space-y-1">
        {HEALTH_PROBE_TABS.map((tab) => {
          const overlay = healthProbeOverlay(tab.id, live)
          return (
            <WorkflowStageRow
              key={tab.id}
              id={tab.id}
              shortLabel={tab.label}
              metric={overlay.metric}
              posture={overlay.posture}
              plain={tab.plain}
              actionLine={overlay.actionLine ?? `Red means: ${tab.redMeans}`}
            />
          )
        })}
      </div>
    </FeatureExplainPanel>
  )
}
