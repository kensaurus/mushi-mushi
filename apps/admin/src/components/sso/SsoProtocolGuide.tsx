/**
 * Visible SSO protocol guide for the SSO page.
 */

import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  SSO_EXPLAINER_SUMMARY,
  SSO_PROTOCOL_DEFINITIONS,
  isSsoGuideExpanded,
  type SsoTopPriority,
} from '../../lib/ssoExplainer'

interface Props {
  topPriority?: SsoTopPriority
}

export function SsoProtocolGuide({ topPriority }: Props) {
  return (
    <FeatureExplainPanel
      title="SAML vs OIDC — what the acronyms mean"
      summary={SSO_EXPLAINER_SUMMARY}
      category="security"
      defaultOpen={isSsoGuideExpanded(topPriority)}
    >
      <div className="space-y-1">
        {SSO_PROTOCOL_DEFINITIONS.map((protocol) => (
          <WorkflowStageRow
            key={protocol.id}
            id={protocol.id}
            shortLabel={`${protocol.label} (${protocol.acronym})`}
            posture="info"
            plain={protocol.plain}
            actionLine={`Use when: ${protocol.whenToUse}`}
            examples={protocol.setupSteps}
          />
        ))}
      </div>
    </FeatureExplainPanel>
  )
}
