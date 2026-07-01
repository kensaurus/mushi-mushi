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
import { onboardingStepOverlay } from '../../lib/guideLiveOverlay'
import type { OnboardingStats } from './types'

interface Props {
  stats: Pick<
    OnboardingStats,
    | 'setupDone'
    | 'hasAnyProject'
    | 'requiredComplete'
    | 'requiredTotal'
    | 'nextStepId'
    | 'sdkInstalled'
    | 'reportCount'
  >
}

export function OnboardingStepsGuide({ stats }: Props) {
  const overlayStats = {
    requiredComplete: stats.requiredComplete,
    requiredTotal: stats.requiredTotal,
    sdkInstalled: stats.sdkInstalled,
    reportCount: stats.reportCount,
    nextStepId: stats.nextStepId,
  }

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
            {ONBOARDING_REQUIRED_STEPS.map((step, i) => {
              const overlay = onboardingStepOverlay(step.id, overlayStats, false)
              return (
                <WorkflowStageRow
                  key={step.id}
                  id={step.id}
                  shortLabel={step.label}
                  posture={overlay.posture}
                  metric={overlay.metric ?? `Step ${i + 1}`}
                  plain={step.plain}
                  actionLine={overlay.actionLine}
                />
              )
            })}
          </div>
        </div>
        <div>
          <p className="text-2xs font-medium uppercase tracking-wider text-fg-faint mb-1">Optional</p>
          <div className="space-y-1">
            {ONBOARDING_OPTIONAL_STEPS.map((step) => {
              const overlay = onboardingStepOverlay(step.id, overlayStats, true)
              return (
                <WorkflowStageRow
                  key={step.id}
                  id={step.id}
                  shortLabel={step.label}
                  posture={overlay.posture}
                  metric={overlay.metric ?? 'Optional'}
                  plain={step.plain}
                />
              )
            })}
          </div>
        </div>
      </div>
    </FeatureExplainPanel>
  )
}
