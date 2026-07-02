/**
 * Visible setup steps guide for Onboarding page.
 */

import type { ReactNode } from 'react'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  ONBOARDING_EXPLAINER_SUMMARY,
  ONBOARDING_OPTIONAL_STEPS,
  ONBOARDING_REQUIRED_STEPS,
  isOnboardingGuideExpanded,
} from '../../lib/onboardingExplainer'
import { onboardingStepOverlay } from '../../lib/guideLiveOverlay'
import {
  IconProjects,
  IconKey,
  IconBolt,
  IconSend,
  IconGithub,
  IconBell,
  IconQaCoverage,
  IconMcp,
} from '../icons'
import type { OnboardingStats } from './types'

/** Scan affordance: one recognisable glyph per setup step, same set as nav/pages. */
const STEP_ICON: Record<string, ReactNode> = {
  project_created: <IconProjects />,
  api_key_generated: <IconKey />,
  sdk_installed: <IconBolt />,
  first_report_received: <IconSend />,
  github: <IconGithub />,
  slack: <IconBell />,
  qa: <IconQaCoverage />,
  mcp: <IconMcp />,
}

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
          <div className="mb-1.5 flex items-center gap-2">
            <p className="text-2xs font-medium uppercase tracking-wider text-fg-faint">
              Required ({stats.requiredComplete}/{stats.requiredTotal})
            </p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={stats.requiredTotal}
              aria-valuenow={stats.requiredComplete}
              aria-label={`${stats.requiredComplete} of ${stats.requiredTotal} required setup steps complete`}
              className="h-1 flex-1 max-w-[8rem] overflow-hidden rounded-full bg-surface-overlay"
            >
              <div
                className="h-full rounded-full bg-ok motion-safe:transition-[width] motion-safe:duration-500"
                style={{
                  width: `${stats.requiredTotal > 0 ? Math.round((stats.requiredComplete / stats.requiredTotal) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
          <div className="space-y-1">
            {ONBOARDING_REQUIRED_STEPS.map((step, i) => {
              const overlay = onboardingStepOverlay(step.id, overlayStats, false)
              return (
                <WorkflowStageRow
                  key={step.id}
                  id={step.id}
                  shortLabel={step.label}
                  icon={STEP_ICON[step.id]}
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
                  icon={STEP_ICON[step.id]}
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
