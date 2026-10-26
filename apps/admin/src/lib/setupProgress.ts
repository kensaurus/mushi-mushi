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

import type { SetupProject, SetupStep } from './useSetupStatus'

function requiredSetupSteps(project: SetupProject): SetupStep[] {
  return project.steps.filter((s) => s.required)
}

export function nextRequiredSetupStep(project: SetupProject): SetupStep | null {
  return requiredSetupSteps(project).find((s) => !s.complete) ?? null
}

/**
 * Required counts from GET /v1/admin/setup (the switcher and Home read it)
 * applied to the Setup page's stats. The activation payload counts the SDK
 * step as optional, so the page said "ready, 3/3" while setup said 3/4 with
 * the SDK never seen (mushi-demo, 2026-10-26). Ready only when both agree.
 */
export function withSetupRequiredCounts<
  T extends {
    projectId: string | null
    requiredComplete: number
    requiredTotal: number
    setupDone: boolean
    nextStepId: string | null
    nextStepLabel: string | null
  },
>(
  stats: T,
  setupProject: Pick<SetupProject, 'project_id' | 'required_complete' | 'required_total' | 'done' | 'steps'> | null,
): T {
  if (!setupProject || (stats.projectId && setupProject.project_id !== stats.projectId)) return stats
  // The next step comes from the same steps, so a subtitle never says "all done" beside 3/4.
  const next = setupProject.steps.find((s) => s.required && !s.complete) ?? null
  return {
    ...stats,
    requiredComplete: setupProject.required_complete,
    requiredTotal: setupProject.required_total,
    setupDone: stats.setupDone && setupProject.done,
    nextStepId: next ? next.id : stats.setupDone && setupProject.done ? null : stats.nextStepId,
    nextStepLabel: next ? next.label : stats.setupDone && setupProject.done ? null : stats.nextStepLabel,
  }
}
