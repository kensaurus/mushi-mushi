/**
 * FILE: apps/admin/src/components/settings/types.ts
 */

export type SettingsTabId = 'general' | 'byok' | 'firecrawl' | 'browserbase' | 'voice' | 'health' | 'dev'

/**
 * GET /v1/admin/settings/stats. It has no `topPriority`: what to do next is
 * worked out on the client by `settingsBannerPriority`, from these counts and
 * the saved-keys list.
 */
export interface SettingsStats {
  hasAnyProject?: boolean
  projectId: string | null
  projectName: string | null
  updatedAt: string | null
  slackConfigured: boolean
  sentryConfigured: boolean
  reporterNotificationsEnabled: boolean
  stage2Model: string | null
  sdkConfigEnabled: boolean
  sdkConfigUpdatedAt: string | null
  byokAnthropicConfigured: boolean
  byokOpenaiConfigured: boolean
  byokFirecrawlConfigured: boolean
  byokKeysConfigured: number
  byokKeysPassing: number
  byokKeysFailing: number
  byokKeysUntested: number
  /** Keys that stop working within 7 days (servers before 2026-10-04 omit it). */
  byokKeysExpiring?: number
  githubRepoConfigured: boolean
  autofixEnabled: boolean
}

export const EMPTY_SETTINGS_STATS: SettingsStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  updatedAt: null,
  slackConfigured: false,
  sentryConfigured: false,
  reporterNotificationsEnabled: false,
  stage2Model: null,
  sdkConfigEnabled: false,
  sdkConfigUpdatedAt: null,
  byokAnthropicConfigured: false,
  byokOpenaiConfigured: false,
  byokFirecrawlConfigured: false,
  byokKeysConfigured: 0,
  byokKeysPassing: 0,
  byokKeysFailing: 0,
  byokKeysUntested: 0,
  byokKeysExpiring: 0,
  githubRepoConfigured: false,
  autofixEnabled: false,
}
