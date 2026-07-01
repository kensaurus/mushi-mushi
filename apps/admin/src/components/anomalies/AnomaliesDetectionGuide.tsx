/**
 * Visible metric anomaly detection guide.
 */

import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  ANOMALIES_EXPLAINER_SUMMARY,
  ANOMALY_METHOD_DEFINITIONS,
  isAnomaliesGuideExpanded,
} from '../../lib/anomaliesExplainer'
import { anomaliesMethodOverlay } from '../../lib/guideLiveOverlay'
import type { AnomaliesStats, AnomaliesTopPriority } from './AnomaliesStatsTypes'

interface Props {
  topPriority?: AnomaliesTopPriority
  stats?: Pick<AnomaliesStats, 'openAnomalies' | 'metricPointCount' | 'topPriority'>
}

export function AnomaliesDetectionGuide({ topPriority, stats }: Props) {
  const live = stats ?? {
    openAnomalies: 0,
    metricPointCount: 0,
    topPriority: topPriority ?? 'healthy',
  }

  return (
    <FeatureExplainPanel
      title="How anomaly detection works"
      summary={ANOMALIES_EXPLAINER_SUMMARY}
      defaultOpen={isAnomaliesGuideExpanded(topPriority)}
    >
      <div className="space-y-1">
        {ANOMALY_METHOD_DEFINITIONS.map((method) => {
          const overlay = anomaliesMethodOverlay(method.id, live)
          return (
            <WorkflowStageRow
              key={method.id}
              id={method.id}
              shortLabel={method.label}
              metric={overlay.metric}
              posture={overlay.posture}
              plain={method.plain}
              actionLine={overlay.actionLine ?? `Best for: ${method.bestFor}`}
            />
          )
        })}
      </div>
    </FeatureExplainPanel>
  )
}
