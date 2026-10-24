/**
 * FILE: apps/admin/src/components/settings/types.ts
 */

/**
 * The Settings tabs, in strip order. Old ids that links and browsers may
 * still carry (`firecrawl`, `health`, …) are not tabs: lib/settingsTabs.ts
 * maps them onto these.
 */
export const SETTINGS_TAB_IDS = ['general', 'byok', 'tools', 'voice', 'sdk', 'labs'] as const

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number]

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
  /** Webhook, or a channel plus a bot: something can actually post. */
  slackCanPost?: boolean
  slackChannelId?: string | null
  sentryConfigured: boolean
  /** True when the Sentry webhook secret is stored. Absent on older payloads. */
  sentryWebhookSecretSet?: boolean
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
