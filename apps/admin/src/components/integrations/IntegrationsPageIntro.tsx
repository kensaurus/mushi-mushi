/**
 * Visible intro for Integrations — what to connect first and why.
 */

import { Link } from 'react-router-dom'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { INTEGRATIONS_EXPLAINER } from '../../lib/integrationsExplainer'
import type { IntegrationTopPriority } from './types'

interface Props {
  topPriority?: IntegrationTopPriority
}

export function IntegrationsPageIntro({ topPriority }: Props) {
  const needsGuidance =
    topPriority === 'empty' ||
    topPriority === 'incomplete' ||
    topPriority === 'no_project' ||
    topPriority === 'platform_down'

  return (
    <FeatureExplainPanel
      title={INTEGRATIONS_EXPLAINER.title}
      summary={INTEGRATIONS_EXPLAINER.summary}
      category="guide"
      defaultOpen={needsGuidance}
    >
      <ol className="list-decimal pl-4 space-y-2 text-2xs text-fg-secondary">
        {INTEGRATIONS_EXPLAINER.steps.map((step) => (
          <li key={step.label}>
            <span className="font-medium text-fg">{step.label}</span>
            <span className="text-fg-muted"> — {step.detail}</span>
          </li>
        ))}
      </ol>
      <p className="text-2xs text-fg-faint">
        Each card below has setup steps and a Test button. See also{' '}
        <Link to="/health?fn=integration-probe" className="text-brand hover:underline">
          Health probes
        </Link>{' '}
        if a connection keeps failing.
      </p>
    </FeatureExplainPanel>
  )
}
