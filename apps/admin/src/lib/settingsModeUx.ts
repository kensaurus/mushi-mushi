/**
 * FILE: apps/admin/src/lib/settingsModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Settings page.
 */

import { useAdminMode } from './mode';
import type { SettingsStats, SettingsTabId } from '../components/settings/types';
import type { KeySummary } from '../components/settings/keyStatus';
import { settingsBannerPriority } from '../components/settings/SettingsStatusBanner';

export interface SettingsUxFlags {
  isQuickstart: boolean;
  isBeginner: boolean;
  isAdvanced: boolean;
  hideTabs: boolean;
  plainBanner: boolean;
  hideSettingsSnapshot: boolean;
}

export function useSettingsUx(): SettingsUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode();
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideSettingsSnapshot: isQuickstart,
  };
}


/**
 * Quick mode: land on the tab the status banner's button opens, decided by
 * the same priority function, so the landing tab and the banner never
 * disagree. (It used to read `stats.topPriority`, which /settings/stats never
 * returns, so Quick mode always opened General.) Without the BYOK plan the
 * optional "add your own Claude key" step is skipped: that tab would only
 * show an upgrade prompt.
 */
export function resolveQuickSettingsTab(
  stats: SettingsStats,
  keySummary: KeySummary | null,
  hasAnthropicKey: boolean,
  byokEnabled: boolean,
): SettingsTabId {
  let priority = settingsBannerPriority(stats, keySummary, hasAnthropicKey);
  if (priority === 'no_anthropic' && !byokEnabled) priority = settingsBannerPriority(stats, keySummary, true);
  switch (priority) {
    case 'keys_attention':
    case 'keys_expiring':
    case 'no_anthropic':
    case 'keys_unchecked':
      return 'byok';
    case 'sdk_off':
    case 'healthy':
      return 'sdk';
    default:
      return 'general';
  }
}

/** Quick mode may choose an initial tab, but an explicit deep link always wins. */
export function shouldResolveQuickSettingsTab(tabParam: string | null): boolean {
  return tabParam === null;
}
