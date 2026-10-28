/**
 * FILE: apps/admin/src/lib/onboardingPrimaryCta.ts
 * PURPOSE: Gate for the /onboarding "pipeline live" card.
 *
 * OVERVIEW:
 * The card header prints `complete` of `total` from the setup project.
 * The card renders only when required steps are done and that counter
 * is full. Its buttons are fixed in OnboardingPage ("View fixes" and
 * "Open dashboard").
 *
 * DEPENDENCIES:
 * - None. Pure. Callers pass the setup project fields they already have.
 *
 * USAGE:
 * - OnboardingPage pipeline-live card
 * - onboardingPrimaryCta.test.ts
 *
 * NOTES:
 * - `done` is required-steps-only on the server. The header's all-steps
 *   count is `complete >= total`. The card needs both.
 * - The card is the only place those buttons render, and it renders only
 *   in this state. A merged fix must not show the card while steps remain.
 */

export function onboardingSetupComplete(input: {
  /** Required steps finished (`SetupProject.done`). */
  done: boolean
  /** Steps marked complete — numerator of "10 of 10". */
  complete: number
  /** Step list length — denominator of "10 of 10". */
  total: number
}): boolean {
  return input.done && input.complete >= input.total
}
