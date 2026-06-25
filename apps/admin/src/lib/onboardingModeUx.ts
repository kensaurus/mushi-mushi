/**
 * FILE: apps/admin/src/lib/onboardingModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Setup / Onboarding page.
 */

import { useAdminMode } from './mode'
import type { OnboardingStats, OnboardingTabId } from '../components/onboarding/types'

export interface OnboardingUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  /** Hide Overview tab — jump to the action tab for the current step. */
  hideOverviewTab: boolean
  /** Hide editorial hero + PDCA explainer on Overview. */
  hideOverviewChrome: boolean
  /** Use plain-language status banner CTAs. */
  plainBanner: boolean
  /** Hide optional-setup stat tile. */
  hideOptionalStat: boolean
  /** Hide skip/tour footer links. */
  hideFooterLinks: boolean
}

export function useOnboardingUx(): OnboardingUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideOverviewTab: isQuickstart,
    // Only Quickstart hides the orienting hero + "how Mushi closes the loop"
    // explainer (and it hides the whole Overview tab anyway). Beginner mode is
    // "all the options, with tooltips" — orientation is the entire point — so
    // it must SEE the explainer, not have it hidden like Advanced power users
    // who don't need hand-holding. (Previously `!isAdvanced` hid it from exactly
    // the beginners who needed it most.)
    hideOverviewChrome: isQuickstart,
    plainBanner: !isAdvanced,
    hideOptionalStat: isQuickstart,
    hideFooterLinks: isQuickstart,
  }
}

/** Quick mode: land on the tab that matches the next incomplete step. */
export function resolveQuickOnboardingTab(stats: OnboardingStats): OnboardingTabId {
  if (!stats.hasAnyProject) return 'steps'
  if (stats.setupDone) return 'sdk'
  switch (stats.nextStepId) {
    case 'api_key_generated':
    case 'first_report_received':
      return 'verify'
    case 'sdk_installed':
      return 'sdk'
    default:
      return 'steps'
  }
}
