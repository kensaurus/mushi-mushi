/**
 * Visible SOC 2 / GDPR concept guide for the Compliance page.
 */

import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  COMPLIANCE_CONCEPT_DEFINITIONS,
  COMPLIANCE_EXPLAINER_SUMMARY,
  isComplianceGuideExpanded,
  type ComplianceTopPriority,
} from '../../lib/complianceExplainer'

interface Props {
  topPriority?: ComplianceTopPriority
}

export function ComplianceGuide({ topPriority }: Props) {
  return (
    <FeatureExplainPanel
      title="SOC 2, DSAR, and retention — plain language"
      summary={COMPLIANCE_EXPLAINER_SUMMARY}
      category="security"
      defaultOpen={isComplianceGuideExpanded(topPriority)}
    >
      <div className="space-y-1">
        {COMPLIANCE_CONCEPT_DEFINITIONS.map((concept) => (
          <WorkflowStageRow
            key={concept.id}
            id={concept.id}
            shortLabel={concept.label}
            posture="info"
            plain={concept.plain}
            actionLine={concept.operatorAction}
          />
        ))}
      </div>
    </FeatureExplainPanel>
  )
}
