/**
 * FILE: apps/admin/src/lib/setupProgress.ts
 * PURPOSE: Shared helpers for rendering setup progress in compact UI
 *          (project switcher, chips, tooltips). Mirrors /v1/admin/setup:
 *
 *          Required (4) — must complete for `done: true`:
 *            project_created, api_key_generated, sdk_installed,
 *            first_report_received
 *
 *          Optional (6) — unlock auto-fix, BYOK, alerts, QA:
 *            github_connected, sentry_connected, byok_anthropic,
 *            first_fix_dispatched, slack_connected, first_qa_story_passing
 */

import type { SetupProject, SetupStep, SetupStepId } from './useSetupStatus'

/** Canonical required step count from the backend checklist. */
export const REQUIRED_SETUP_STEP_COUNT = 4

/** Short labels for the segmented progress bar in dense chrome. */
export const REQUIRED_STEP_SHORT_LABEL: Partial<Record<SetupStepId, string>> = {
  project_created: 'Project',
  api_key_generated: 'API key',
  sdk_installed: 'SDK',
  first_report_received: 'First report',
}

export function requiredSetupSteps(project: SetupProject): SetupStep[] {
  return project.steps.filter((s) => s.required)
}

export function optionalSetupSteps(project: SetupProject): SetupStep[] {
  return project.steps.filter((s) => !s.required)
}

export function nextRequiredSetupStep(project: SetupProject): SetupStep | null {
  return requiredSetupSteps(project).find((s) => !s.complete) ?? null
}

export function requiredSetupPercent(project: SetupProject): number {
  return Math.round(
    (project.required_complete / Math.max(1, project.required_total)) * 100,
  )
}
