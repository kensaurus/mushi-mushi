/**
 * FILE: apps/admin/src/components/integrations/connectionGrid.ts
 * PURPOSE: The connection grid at the top of Integrations (console journeys
 *          2026-10-27): "Which tools are connected? What's broken?"
 *
 *          One tile per tool a solo builder wires up (Sentry, GitHub, Slack,
 *          Langfuse, Cursor, Linear, and Claude Code once it is set up), each
 *          with the SAME verdict its card
 *          below shows: Sentry through the shared sentryConnectionFromPageData
 *          (also read by Settings → General), Slack through the Slack card's
 *          own slackCardConnection, the rest through connectionFromProbe on
 *          the card's required fields. The page used to open on a server
 *          banner that called Sentry "needs attention" while its card said it
 *          was importing.
 */

import type { ConnectionState } from '../ui/ConnectionStatus'
import { connectionFromProbe, type ConnectionView, type InboundDeliveryLike } from '../../lib/integrationConnection'
import { platformRequiredOk } from '../../lib/platformIntegrationForm'
import { sentryConnectionFromPageData } from '../../lib/useSentryConnection'
import { slackCardConnection } from './slackConnection'
import { PLATFORM_DEFS, type HealthRow, type Kind, type PlatformResponse } from './types'

type GridToolId = 'sentry' | 'github' | 'slack' | 'langfuse' | 'cursor_cloud' | 'claude_code_agent' | 'linear'

export interface GridTile {
  id: GridToolId
  label: string
  /** BrandIcon brand; Langfuse has no vendored mark and shows the neutral plug. */
  brand: string
  /** The card below this tile summarises. */
  anchor: string
  view: ConnectionView
  /** When something last happened: an event received, or the last check. */
  lastAt: string | null
  lastLabel: 'Last event' | 'Checked' | 'Last import' | null
}

export interface ConnectionGridInput {
  platform: PlatformResponse | null
  history: readonly HealthRow[]
  sentryDeliveries: InboundDeliveryLike[] | null
  sentryDeliveriesFailed?: boolean
  slack: { configured: boolean; canPost: boolean; channelId: string | null }
  linearConnected: boolean
  now?: number
}

const STATE_RANK: Record<ConnectionState, number> = {
  attention: 0,
  expiring: 1,
  checking: 2,
  working: 3,
  not_connected: 4,
}

function latestProbe(history: readonly HealthRow[], kind: string): HealthRow | undefined {
  return history.find((h) => h.kind === kind)
}

function platformTile(input: ConnectionGridInput, kind: Kind, id: GridToolId, label: string, brand: string): GridTile {
  const def = PLATFORM_DEFS.find((d) => d.kind === kind)
  const config = input.platform?.platform?.[kind] ?? {}
  const configured = def ? platformRequiredOk(def, config, input.platform?.sourceByField) : false
  const probe = latestProbe(input.history, kind)
  return {
    id,
    label,
    brand,
    anchor: `platform-card-${kind}`,
    view: connectionFromProbe({ configured, probe, now: input.now }),
    lastAt: configured ? (probe?.checked_at ?? null) : null,
    lastLabel: configured && probe ? 'Checked' : null,
  }
}

export function buildConnectionGrid(input: ConnectionGridInput): GridTile[] {
  const sentryView =
    sentryConnectionFromPageData({
      platform: input.platform,
      history: input.history as HealthRow[],
      deliveries: input.sentryDeliveries,
      deliveriesFailed: input.sentryDeliveriesFailed,
      now: input.now,
    }) ?? { state: 'checking' as const, detail: 'Checking Sentry…' }
  const sentryConfig = input.platform?.platform?.sentry ?? {}
  const sentryDelivery = input.sentryDeliveries?.[0]?.created_at ?? null
  const sentryImport = typeof sentryConfig.sentry_auto_import_last_at === 'string' ? sentryConfig.sentry_auto_import_last_at : null
  const sentryProbe = latestProbe(input.history, 'sentry')
  const sentry: GridTile = {
    id: 'sentry',
    label: 'Sentry',
    brand: 'sentry',
    anchor: 'platform-card-sentry',
    view: sentryView,
    lastAt: sentryView.state === 'not_connected' ? null : (sentryDelivery ?? sentryImport ?? sentryProbe?.checked_at ?? null),
    lastLabel:
      sentryView.state === 'not_connected'
        ? null
        : sentryDelivery
          ? 'Last event'
          : sentryImport
            ? 'Last import'
            : sentryProbe
              ? 'Checked'
              : null,
  }

  const slackProbe = latestProbe(input.history, 'slack')
  const slack: GridTile = {
    id: 'slack',
    label: 'Slack',
    brand: 'slack',
    anchor: 'integrations-slack',
    view: slackCardConnection({
      slackConfigured: input.slack.configured,
      canPost: input.slack.canPost,
      channelId: input.slack.channelId,
      probe: slackProbe,
      now: input.now,
    }),
    lastAt: input.slack.configured ? (slackProbe?.checked_at ?? null) : null,
    lastLabel: input.slack.configured && slackProbe ? 'Checked' : null,
  }

  const linearProbe = latestProbe(input.history, 'linear')
  const linear: GridTile = {
    id: 'linear',
    label: 'Linear',
    brand: 'linear',
    anchor: 'integrations-linear',
    view: connectionFromProbe({ configured: input.linearConnected, probe: linearProbe, now: input.now }),
    lastAt: input.linearConnected ? (linearProbe?.checked_at ?? null) : null,
    lastLabel: input.linearConnected && linearProbe ? 'Checked' : null,
  }

  // Claude Code is the other fix agent. The integrations stats (and so the
  // sidebar badge) count it when it is set up, so the grid shows it then too.
  const claude = platformTile(input, 'claude_code_agent', 'claude_code_agent', 'Claude Code', 'claude')

  // Langfuse counts only when it is the user's own: Mushi's environment default
  // made a new app read "2 connected" with nothing connected (2026-10-28).
  const langfuseDef = PLATFORM_DEFS.find((d) => d.kind === 'langfuse')
  const langfuseOwn = (langfuseDef?.fields ?? []).some((f) => {
    const source = input.platform?.sourceByField?.[f.name]
    return source === 'project' || source === 'org'
  })

  return [
    sentry,
    platformTile(input, 'github', 'github', 'GitHub', 'github'),
    slack,
    ...(langfuseOwn ? [platformTile(input, 'langfuse', 'langfuse', 'Langfuse', 'langfuse')] : []),
    platformTile(input, 'cursor_cloud', 'cursor_cloud', 'Cursor', 'cursor'),
    ...(claude.view.state === 'not_connected' ? [] : [claude]),
    linear,
  ]
}

/** Tiles whose card asks for a fix, worst first. "Not connected" is a choice, not a problem. */
export function brokenConnections(tiles: readonly GridTile[]): GridTile[] {
  return tiles
    .filter((t) => t.view.state === 'attention' || t.view.state === 'expiring')
    .sort((a, b) => STATE_RANK[a.view.state] - STATE_RANK[b.view.state])
}

/** The page's one status sentence. */
export function connectionGridSentence(tiles: readonly GridTile[]): { sentence: string; tone: 'ok' | 'warn' | 'neutral' } {
  const broken = brokenConnections(tiles)
  const connected = tiles.filter((t) => t.view.state !== 'not_connected')
  if (broken.length > 0) {
    const names = broken.map((t) => t.label)
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    return { sentence: `${list} ${broken.length === 1 ? 'needs' : 'need'} you.`, tone: 'warn' }
  }
  if (connected.length === 0) {
    return { sentence: 'Nothing is connected yet. Start with GitHub so Mushi can open fix PRs.', tone: 'neutral' }
  }
  const unchecked = connected.filter((t) => t.view.state === 'checking').length
  return {
    sentence:
      unchecked > 0
        ? `${connected.length} connected, ${unchecked} not tested yet. Nothing is broken.`
        : `${connected.length} connected and working.`,
    tone: unchecked > 0 ? 'neutral' : 'ok',
  }
}
