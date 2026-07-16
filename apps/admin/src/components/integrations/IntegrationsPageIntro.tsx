/**
 * Visible intro for Integrations — what to connect first and why.
 */

import { Link } from 'react-router-dom'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import { INTEGRATIONS_EXPLAINER } from '../../lib/integrationsExplainer'
import { integrationsStepOverlay } from '../../lib/guideLiveOverlay'
import type { IntegrationTopPriority } from './types'

interface IntegrationProbeFlags {
  githubOk: boolean
  sentryOk: boolean
  langfuseOk: boolean
  slackOk: boolean
}

interface Props {
  topPriority?: IntegrationTopPriority
  flags?: IntegrationProbeFlags
}

export function IntegrationsPageIntro({ topPriority, flags }: Props) {
  const needsGuidance =
    topPriority === 'empty' ||
    topPriority === 'incomplete' ||
    topPriority === 'no_project' ||
    topPriority === 'platform_down'

  const live = flags ?? {
    githubOk: false,
    sentryOk: false,
    langfuseOk: false,
    slackOk: false,
  }

  return (
    <FeatureExplainPanel
      title={INTEGRATIONS_EXPLAINER.title}
      summary={INTEGRATIONS_EXPLAINER.summary}
      category="guide"
      defaultOpen={needsGuidance}
    >
      <div className="space-y-1">
        {INTEGRATIONS_EXPLAINER.steps.map((step, i) => {
          const overlay = integrationsStepOverlay(i + 1, live)
          return (
            <WorkflowStageRow
              key={step.label}
              id={`step-${i + 1}`}
              shortLabel={step.label}
              metric={overlay.metric}
              posture={overlay.posture}
              plain={step.detail}
              actionLine={overlay.actionLine}
            />
          )
        })}
      </div>
      <p className="text-2xs text-fg-faint">
        Each card below has setup steps and a Test button. See also{' '}
        <Link to="/health?fn=integration-probe" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">
          Health probes
        </Link>{' '}
        if a connection keeps failing.
      </p>
    </FeatureExplainPanel>
  )
}
