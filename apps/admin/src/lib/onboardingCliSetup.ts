/**
 * FILE: apps/admin/src/lib/onboardingCliSetup.ts
 * PURPOSE: Pure helpers for CLI-driven onboarding deep links (`?setup=cli`).
 *
 * USAGE:
 * - OnboardingPage reads search params via these helpers
 * - Unit-tested for routing contract stability
 */

export function isCliSetupMode(params: URLSearchParams | string): boolean {
  const sp = typeof params === 'string' ? new URLSearchParams(params) : params
  return sp.get('setup') === 'cli'
}

export function shouldFocusCreateForm(params: URLSearchParams | string): boolean {
  const sp = typeof params === 'string' ? new URLSearchParams(params) : params
  return isCliSetupMode(sp) || sp.get('focus') === 'create'
}

/** Create form on Setup → Steps: first project always; CLI deep link always (even if org has projects). */
export function shouldShowOnboardingCreateForm(
  setupCliMode: boolean,
  hasAnyProject: boolean,
  hasCreatedProject: boolean,
): boolean {
  if (hasCreatedProject) return false
  return setupCliMode || !hasAnyProject
}
