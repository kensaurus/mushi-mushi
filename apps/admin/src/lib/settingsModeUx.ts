/**
 * FILE: apps/admin/src/lib/settingsModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Settings page.
 */

import { useAdminMode } from './mode'
import type { SettingsStats, SettingsTabId } from '../components/settings/types'
import { shouldHideConfigSnapshot } from './pagePostureHelpers'

export interface SettingsUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideSettingsSnapshot: boolean
}

export function useSettingsUx(): SettingsUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideSettingsSnapshot: isQuickstart,
  }
}

/** Beginner: hide full snapshot when status banner already carries the headline. */
export function shouldHideSettingsSnapshot(
  ux: Pick<SettingsUxFlags, 'hideSettingsSnapshot' | 'isBeginner'>,
  stats: Pick<SettingsStats, 'topPriority'>,
): boolean {
  return shouldHideConfigSnapshot(ux.hideSettingsSnapshot, ux.isBeginner, stats.topPriority ?? 'healthy', [
    'healthy',
    'routing_optional',
  ])
}

/** Quick mode: land on the tab that matches settings posture. */
export function resolveQuickSettingsTab(stats: SettingsStats): SettingsTabId {
  if (
    stats.topPriority === 'byok_failing' ||
    stats.topPriority === 'no_anthropic' ||
    stats.topPriority === 'untested'
  ) {
    return 'byok'
  }
  if (stats.topPriority === 'sdk_off' || stats.topPriority === 'healthy') {
    return 'health'
  }
  return 'general'
}
