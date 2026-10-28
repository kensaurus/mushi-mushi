/**
 * FILE: apps/admin/src/lib/onboardingPrimaryCta.ts
 * PURPOSE: Primary action on the /onboarding "pipeline live" card.
 *
 * OVERVIEW:
 * The card header prints `complete` of `total` from the setup project.
 * This helper uses those same counts (and a merged fix as "loop closed")
 * so a finished pipeline does not keep offering "Connect fix agents".
 *
 * DEPENDENCIES:
 * - None. Pure. Callers pass the setup project fields they already have.
 *
 * USAGE:
 * - OnboardingPage pipeline-live hero
 * - onboardingPrimaryCta.test.ts
 *
 * NOTES:
 * - `done` is required-steps-only on the server. The header's all-steps
 *   count is `complete >= total`. Either a full step list or a merged
 *   fix ends the setup CTA.
 */

export interface OnboardingPrimaryCtaInput {
  /** Required steps finished (`SetupProject.done`). Kept so callers pass the setup object, not a side flag. */
  done: boolean
  /** Steps marked complete — numerator of "10 of 10". */
  complete: number
  /** Step list length — denominator of "10 of 10". */
  total: number
  /** Merged fixes: the loop is closed. */
  mergedFixCount: number
}

export interface OnboardingPrimaryCta {
  label: string
  to: string
  /** `primary` is a setup prompt. `ghost` is neutral once setup is finished. */
  variant: 'primary' | 'ghost'
}

const CONNECT_FIX_AGENTS: OnboardingPrimaryCta = {
  label: 'Connect fix agents',
  to: '/integrations/config',
  variant: 'primary',
}

const VIEW_FIXES: OnboardingPrimaryCta = {
  label: 'View fixes',
  to: '/fixes',
  variant: 'ghost',
}

export function onboardingPrimaryCta(input: OnboardingPrimaryCtaInput): OnboardingPrimaryCta {
  const allStepsDone = input.total > 0 && input.complete >= input.total
  const loopClosed = input.done && input.mergedFixCount > 0
  if (allStepsDone || loopClosed) return VIEW_FIXES
  return CONNECT_FIX_AGENTS
}
