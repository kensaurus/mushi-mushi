/**
 * FILE: apps/admin/src/components/settings/types.ts
 */

export type SettingsTabId = 'general' | 'byok' | 'firecrawl' | 'browserbase' | 'health' | 'dev'

export type SettingsTopPriority =
  | 'no_project'
  | 'byok_failing'
  | 'no_anthropic'
  | 'sdk_off'
  | 'untested'
  | 'routing_optional'
  | 'healthy'

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
  githubRepoConfigured: boolean
  autofixEnabled: boolean
  topPriority?: SettingsTopPriority
  topPriorityLabel?: string | null
  topPriorityTo?: string | null
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
  githubRepoConfigured: false,
  autofixEnabled: false,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
