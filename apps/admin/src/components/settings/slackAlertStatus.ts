/**
 * FILE: apps/admin/src/components/settings/slackAlertStatus.ts
 * PURPOSE: Whether Settings can say Slack alerts will actually send.
 *
 * A saved channel id, bot token, or webhook is not enough on its own.
 * Posting needs a webhook, or a channel plus a bot. `/v1/admin/settings/stats`
 * reports that as `slackCanPost` (project bot, org bot, or the operator env
 * bot). The settings row still carries the project's own pieces
 * (`slack_channel_id`, `slack_webhook_url_set`, `slack_bot_token_ref_set`)
 * so a just-saved webhook is not hidden behind a stale stats read.
 */

import type { RowStatusValue } from './SettingsRow'

export interface SlackAlertInput {
  channelId?: string | null
  webhookSet?: boolean
  /** `project_settings.slack_bot_token_ref` is stored for this project. */
  botSet?: boolean
  /**
   * `slackCanPost` from GET /v1/admin/settings/stats. Undefined when that
   * payload has not loaded or an older server omitted it.
   */
  canPost?: boolean
  tested?: { ok: boolean } | null
}

export interface SlackAlertFlags {
  slackConfigured: boolean
  slackCanPost?: boolean
}

/** True when something can post. A missing `slackCanPost` falls back to "any Slack setting exists". */
export function slackAlertsReady(stats: SlackAlertFlags): boolean {
  return stats.slackCanPost ?? stats.slackConfigured
}

/** Alerts stat on Settings. Names a half-finished Slack setup instead of counting it as done. */
export function slackStatLabel(stats: SlackAlertFlags): string | null {
  if (stats.slackCanPost === true) return 'Slack'
  if (stats.slackConfigured && stats.slackCanPost === false) return 'Slack not ready'
  if (stats.slackConfigured) return 'Slack'
  return null
}

/** Developer-details row. Distinguishes "saved" from "can send". */
export function slackAlertsReadout(stats: SlackAlertFlags): string {
  if (stats.slackCanPost === true) return 'Can send'
  if (stats.slackCanPost === false) {
    return stats.slackConfigured ? 'Saved, but alerts cannot be sent yet' : 'Not set up'
  }
  return stats.slackConfigured ? 'Set up' : 'Not set up'
}

function localCanPost(input: SlackAlertInput): boolean {
  const channel = Boolean(input.channelId?.trim())
  const webhook = input.webhookSet === true
  const bot = input.botSet === true
  return webhook || (bot && channel)
}

/** Show "Send test message" only when a send has somewhere to go. */
export function slackCanOfferTest(input: SlackAlertInput): boolean {
  return input.canPost === true || localCanPost(input)
}

export function slackAlertStatus(input: SlackAlertInput): RowStatusValue {
  const channel = Boolean(input.channelId?.trim())
  const webhook = input.webhookSet === true
  const bot = input.botSet === true
  const canPost = slackCanOfferTest(input)

  if (input.tested?.ok) return { state: 'working', detail: 'Test message sent just now.' }
  if (input.tested) {
    return {
      state: 'attention',
      detail: "The test message didn't arrive. Check the channel ID and that the Mushi bot is in the channel.",
    }
  }
  if (!canPost && !channel && !webhook && !bot) {
    return { state: 'not_connected', detail: 'Add a channel ID below to get bug alerts in Slack.' }
  }
  if (!canPost && channel && !webhook) {
    return {
      state: 'attention',
      detail:
        'This channel is saved, but nothing can post to it yet. Add Mushi to Slack on Integrations, or paste a webhook below.',
    }
  }
  if (!canPost && bot && !channel) {
    return {
      state: 'attention',
      detail: 'Slack is connected. Add a channel ID so alerts have somewhere to go.',
    }
  }
  if (!canPost) {
    return { state: 'attention', detail: 'Slack is only partly set up, so alerts cannot be sent yet.' }
  }
  return { state: 'checking', detail: 'Saved. Send a test message to check it.' }
}
