/**
 * FILE: apps/admin/src/components/integrations/slackConnection.ts
 * PURPOSE: The Slack card's status line as a pure function, so the
 *          Integrations connection grid shows the same verdict as the card.
 */

import { connectionFromProbe, type ConnectionView, type ProbeLike } from '../../lib/integrationConnection'
import { SLACK_VERIFIED_FRESH_MS } from '../settings/slackAlertStatus'

/**
 * The Slack card's status line, also read by the Integrations connection grid
 * so the two never disagree.
 */
export function slackCardConnection(input: {
  slackConfigured: boolean
  canPost: boolean
  channelId: string | null
  probe: ProbeLike | undefined
  installUnavailable?: boolean
  now?: number
}): ConnectionView {
  if (!input.slackConfigured) {
    return {
      state: 'not_connected',
      detail: input.installUnavailable
        ? "One-click Slack install isn't set up on this server. Paste an incoming webhook URL below to get alerts."
        : 'Add Mushi to a Slack workspace to get alerts.',
    }
  }
  if (!input.canPost && !input.channelId) return { state: 'attention', detail: 'Pick a channel below so Mushi knows where to post.' }
  if (!input.canPost) return { state: 'attention', detail: 'No Slack bot can post to this channel yet.' }
  const probed = connectionFromProbe({ configured: true, probe: input.probe, now: input.now, staleAfterMs: SLACK_VERIFIED_FRESH_MS })
  if (probed.state === 'checking') return { state: 'checking', detail: 'Connected, but no test message sent yet.' }
  return probed
}
