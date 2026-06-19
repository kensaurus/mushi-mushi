import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import { AUDIT_EXPLAINER_SUMMARY, AUDIT_TABS, isAuditGuideExpanded } from '../../lib/auditExplainer'

interface Props {
  failCount24h?: number
}

export function AuditGuide({ failCount24h = 0 }: Props) {
  return (
    <FeatureExplainPanel
      title="Audit log tabs explained"
      summary={AUDIT_EXPLAINER_SUMMARY}
      defaultOpen={isAuditGuideExpanded(failCount24h)}
    >
      <div className="space-y-1">
        {AUDIT_TABS.map((tab) => (
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
