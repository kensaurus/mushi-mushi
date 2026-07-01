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
import { ssoProtocolOverlay } from '../../lib/guideLiveOverlay'

interface Props {
  topPriority?: SsoTopPriority
  flags?: { samlConfigured: boolean; oidcConfigured: boolean }
}

export function SsoProtocolGuide({ topPriority, flags }: Props) {
  const live = flags ?? { samlConfigured: false, oidcConfigured: false }

  return (
    <FeatureExplainPanel
      title="SAML vs OIDC — what the acronyms mean"
      summary={SSO_EXPLAINER_SUMMARY}
      category="security"
      defaultOpen={isSsoGuideExpanded(topPriority)}
    >
      <div className="space-y-1">
        {SSO_PROTOCOL_DEFINITIONS.map((protocol) => {
          const overlay = ssoProtocolOverlay(protocol.id, live)
          return (
            <WorkflowStageRow
              key={protocol.id}
              id={protocol.id}
              shortLabel={`${protocol.label} (${protocol.acronym})`}
              metric={overlay.metric}
              posture={overlay.posture}
              plain={protocol.plain}
              actionLine={overlay.actionLine ?? `Use when: ${protocol.whenToUse}`}
              examples={protocol.setupSteps}
            />
          )
        })}
      </div>
    </FeatureExplainPanel>
  )
}
