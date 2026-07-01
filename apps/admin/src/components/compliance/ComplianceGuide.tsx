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
import { complianceConceptOverlay } from '../../lib/guideLiveOverlay'
import type { ComplianceStats } from './types'

interface Props {
  topPriority?: ComplianceTopPriority
  stats?: Pick<ComplianceStats, 'controlsFail' | 'overdueDsars' | 'topPriority'>
}

export function ComplianceGuide({ topPriority, stats }: Props) {
  const live = stats ?? {
    controlsFail: 0,
    overdueDsars: 0,
    topPriority: topPriority ?? 'healthy',
  }

  return (
    <FeatureExplainPanel
      title="SOC 2, DSAR, and retention — plain language"
      summary={COMPLIANCE_EXPLAINER_SUMMARY}
      category="security"
      defaultOpen={isComplianceGuideExpanded(topPriority)}
    >
      <div className="space-y-1">
        {COMPLIANCE_CONCEPT_DEFINITIONS.map((concept) => {
          const overlay = complianceConceptOverlay(concept.id, live)
          return (
            <WorkflowStageRow
              key={concept.id}
              id={concept.id}
              shortLabel={concept.label}
              metric={overlay.metric}
              posture={overlay.posture}
              plain={concept.plain}
              actionLine={overlay.actionLine ?? concept.operatorAction}
            />
          )
        })}
      </div>
    </FeatureExplainPanel>
  )
}
