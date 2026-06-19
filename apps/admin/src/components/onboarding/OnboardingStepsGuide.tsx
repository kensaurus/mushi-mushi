/**
 * Visible setup steps guide for Onboarding page.
 */

import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  ONBOARDING_EXPLAINER_SUMMARY,
  ONBOARDING_OPTIONAL_STEPS,
  ONBOARDING_REQUIRED_STEPS,
  isOnboardingGuideExpanded,
} from '../../lib/onboardingExplainer'
import type { OnboardingStats } from './types'

interface Props {
  stats: Pick<OnboardingStats, 'setupDone' | 'hasAnyProject' | 'requiredComplete' | 'requiredTotal'>
}

export function OnboardingStepsGuide({ stats }: Props) {
  return (
    <FeatureExplainPanel
      title="Required vs optional setup steps"
      summary={ONBOARDING_EXPLAINER_SUMMARY}
      category="workflow"
      defaultOpen={isOnboardingGuideExpanded(stats)}
    >
      <div className="space-y-2">
        <div>
          <p className="text-2xs font-medium uppercase tracking-wider text-fg-faint mb-1">
            Required ({stats.requiredComplete}/{stats.requiredTotal})
          </p>
          <div className="space-y-1">
            {ONBOARDING_REQUIRED_STEPS.map((step) => (
              <WorkflowStageRow
                key={step.id}
                id={step.id}
                shortLabel={step.label}
                posture="open"
                metric={`Step ${ONBOARDING_REQUIRED_STEPS.findIndex((s) => s.id === step.id) + 1}`}
                plain={step.plain}
              />
            ))}
          </div>
        </div>
        <div>
          <p className="text-2xs font-medium uppercase tracking-wider text-fg-faint mb-1">Optional</p>
          <div className="space-y-1">
            {ONBOARDING_OPTIONAL_STEPS.map((step) => (
              <WorkflowStageRow
                key={step.id}
                id={step.id}
                shortLabel={step.label}
                posture="info"
                metric="Optional"
                plain={step.plain}
              />
            ))}
          </div>
        </div>
      </div>
    </FeatureExplainPanel>
  )
}
