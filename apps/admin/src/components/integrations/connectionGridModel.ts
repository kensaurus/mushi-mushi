/**
 * FILE: apps/admin/src/components/integrations/connectionGridModel.ts
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
import { PLATFORM_DEFS, ROUTING_PROVIDERS, type HealthRow, type Kind, type PlatformResponse } from './types'
import { GITHUB_ACCESS_LABEL, githubAccessMissingSentence, type GithubAccess } from '../../lib/githubAccess'

export type GridToolId =
  | 'sentry'
  | 'github'
  | 'slack'
  | 'discord'
  | 'teams'
  | 'langfuse'
  | 'cursor_cloud'
  | 'claude_code_agent'
  | 'linear'
  | 'jira'
  | 'github_issues'
  | 'pagerduty'

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
  slack: { configured: boolean | null; canPost: boolean; channelId: string | null }
  /** Alert channels the page offers beside Slack; the sentence counts them too. */
  discordConfigured?: boolean
  teamsConfigured?: boolean
  linearConnected: boolean
  /** Saved issue-tracker routes (Jira, GitHub Issues, PagerDuty); a paused one needs you. */
  routing?: ReadonlyArray<{ integration_type: string; is_active: boolean }>
  /**
   * The app's GitHub status from the dispatch preflight (lib/githubAccess.ts),
   * the one the GitHub card shows. Without it (still loading) the tile reads
   * the token form, which misses a GitHub App install.
   */
  github?: GithubAccess | null
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

/** GitHub: a linked repo the App cannot reach is amber, never "Not connected". */
function githubTile(input: ConnectionGridInput): GridTile {
  const fromToken = platformTile(input, 'github', 'github', 'GitHub', 'github')
  const access = input.github
  if (!access) return fromToken
  if (access.state === 'connected') {
    const probe = latestProbe(input.history, 'github')
    return {
      ...fromToken,
      view: connectionFromProbe({ configured: true, probe, now: input.now }),
      lastAt: probe?.checked_at ?? null,
      lastLabel: probe ? 'Checked' : null,
    }
  }
  if (access.state === 'repo_no_access') {
    return {
      ...fromToken,
      view: { state: 'attention', label: GITHUB_ACCESS_LABEL.repo_no_access, detail: githubAccessMissingSentence(access.repo) },
      lastAt: null,
      lastLabel: null,
    }
  }
  return { ...fromToken, view: { state: 'not_connected' }, lastAt: null, lastLabel: null }
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

  // A builder who connects only Discord read "Nothing is connected yet"
  // (first-time user test, 2026-10-28): every alert channel is a tile.
  const webhookTile = (id: 'discord' | 'teams', label: string, brand: string, configured: boolean): GridTile => {
    const probe = latestProbe(input.history, id)
    return {
      id,
      label,
      brand,
      anchor: `integrations-${id}`,
      view: connectionFromProbe({ configured, probe, now: input.now }),
      lastAt: configured ? (probe?.checked_at ?? null) : null,
      lastLabel: configured && probe ? 'Checked' : null,
    }
  }
  const discord = webhookTile('discord', 'Discord', 'discord', Boolean(input.discordConfigured))
  const teams = webhookTile('teams', 'Teams', 'microsoftteams', Boolean(input.teamsConfigured))

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

  // Langfuse that is only Mushi Mushi's own default reads as not connected:
  // the user's Langfuse is not (it still has a tile, so it can be set up).
  const langfuse = langfuseOwn
    ? platformTile(input, 'langfuse', 'langfuse', 'Langfuse', 'langfuse')
    : { ...platformTile(input, 'langfuse', 'langfuse', 'Langfuse', 'langfuse'), view: { state: 'not_connected' as const }, lastAt: null, lastLabel: null }

  // Same order as the page: what a solo builder needs first, monitoring last
  // (AGENTS.md positioning; first-time user test, 2026-10-28). The tiles are
  // the page now (owner, 2026-11-18), so every tool has one, set up or not.
  return [
    githubTile(input),
    slack,
    discord,
    teams,
    platformTile(input, 'cursor_cloud', 'cursor_cloud', 'Cursor', 'cursor'),
    claude,
    linear,
    ...ROUTING_PROVIDERS.map((p) => routingTile(input, p.type, p.healthKind, p.label)),
    sentry,
    langfuse,
  ]
}

/** Jira, GitHub Issues or PagerDuty, with the same verdict as its card (RoutingProviderCard). */
function routingTile(
  input: ConnectionGridInput,
  type: 'jira' | 'github' | 'pagerduty',
  healthKind: 'jira' | 'github_issues' | 'pagerduty',
  label: string,
): GridTile {
  const saved = input.routing?.find((r) => r.integration_type === type)
  const probe = latestProbe(input.history, healthKind)
  const view: ConnectionView =
    saved && !saved.is_active
      ? { state: 'attention', label: 'Paused', detail: 'Paused: new reports are not forwarded here.' }
      : connectionFromProbe({ configured: Boolean(saved), probe, now: input.now })
  return {
    id: healthKind,
    label,
    brand: type === 'github' ? 'github' : type,
    anchor: `integrations-${healthKind}`,
    view,
    lastAt: saved ? (probe?.checked_at ?? null) : null,
    lastLabel: saved && probe ? 'Checked' : null,
  }
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
    return { sentence: 'Nothing is connected yet. Start with GitHub so Mushi Mushi can open fix PRs.', tone: 'neutral' }
  }
  // Count each tool once: "1 connected, 1 not tested yet" was one tool, set
  // up and never tested, read as two (integrator's new-user walk, 2026-10-28).
  const unchecked = connected.filter((t) => t.view.state === 'checking').length
  const working = connected.length - unchecked
  if (unchecked === 0) return { sentence: `${working} connected and working.`, tone: 'ok' }
  if (working === 0) return { sentence: `${unchecked} set up, not tested yet.`, tone: 'neutral' }
  return { sentence: `${working} connected and working, ${unchecked} not tested yet.`, tone: 'neutral' }
}
