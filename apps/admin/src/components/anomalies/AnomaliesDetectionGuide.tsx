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
import type { AnomaliesTopPriority } from './AnomaliesStatsTypes'

interface Props {
  topPriority?: AnomaliesTopPriority
}

export function AnomaliesDetectionGuide({ topPriority }: Props) {
  return (
    <FeatureExplainPanel
      title="How anomaly detection works"
      summary={ANOMALIES_EXPLAINER_SUMMARY}
      defaultOpen={isAnomaliesGuideExpanded(topPriority)}
    >
      <div className="space-y-1">
        {ANOMALY_METHOD_DEFINITIONS.map((method) => (
          <WorkflowStageRow
            key={method.id}
            id={method.id}
            shortLabel={method.label}
            posture="info"
            plain={method.plain}
            actionLine={`Best for: ${method.bestFor}`}
          />
        ))}
      </div>
    </FeatureExplainPanel>
  )
}
