/**
 * The connection grid at the top of Integrations shows each card's own
 * verdict. Sentry's tile reads the same shared verdict as Settings → General
 * (e469ff36), so the two pages can't disagree; "not connected" is never
 * counted as broken.
 */

import { describe, expect, it } from 'vitest'
import { brokenConnections, buildConnectionGrid, connectionGridSentence, type ConnectionGridInput } from './connectionGrid'
import { sentryConnectionFromPageData } from '../../lib/useSentryConnection'
import type { HealthRow, PlatformResponse } from './types'

const NOW = Date.parse('2026-10-27T12:00:00Z')
const RECENT = '2026-10-27T11:50:00Z'

const probe = (kind: string, status: HealthRow['status'] = 'ok', message: string | null = 'HTTP 200'): HealthRow => ({
  id: `h-${kind}`,
  kind,
  status,
  latency_ms: 40,
  message,
  source: 'cron',
  checked_at: RECENT,
})

const platform: PlatformResponse = {
  platform: {
    sentry: { sentry_org_slug: 'acme', sentry_auth_token_ref: 'ref', sentry_auto_import: true, sentry_auto_import_last_at: RECENT },
    github: { github_repo_url: 'https://github.com/acme/app', github_installation_token_ref: 'ref' },
  },
  sourceByField: { sentry_org_slug: 'project', sentry_auth_token_ref: 'project' },
}

function input(over: Partial<ConnectionGridInput> = {}): ConnectionGridInput {
  return {
    platform,
    history: [probe('sentry'), probe('github')],
    sentryDeliveries: [],
    slack: { configured: false, canPost: false, channelId: null },
    linearConnected: false,
    now: NOW,
    ...over,
  }
}

describe('buildConnectionGrid', () => {
  // The row led with Sentry, a monitoring tool we never require (AGENTS.md;
  // first-time user test, 2026-10-28). GitHub and alerts lead; Sentry is last.
  it('lists the tools in a fixed order, GitHub first and monitoring last', () => {
    expect(buildConnectionGrid(input()).map((t) => t.id)).toEqual(['github', 'slack', 'discord', 'cursor_cloud', 'linear', 'sentry'])
  })

  // Mushi's own Langfuse (set in its environment) counted as one of the user's
  // connections: a new app read "2 connected" with nothing connected
  // (integrator's new-user walk, 2026-10-28).
  it("leaves out Mushi's own Langfuse and counts the user's", () => {
    const viaEnv: PlatformResponse = {
      platform: { langfuse: { langfuse_host: 'https://us.cloud.langfuse.com', langfuse_public_key_ref: 'ref', langfuse_secret_key_ref: 'ref' } },
      sourceByField: { langfuse_host: 'env', langfuse_public_key_ref: 'env', langfuse_secret_key_ref: 'env' },
    }
    const envTiles = buildConnectionGrid(input({ platform: viaEnv, history: [probe('langfuse')] }))
    expect(envTiles.map((t) => t.id)).not.toContain('langfuse')
    expect(connectionGridSentence(envTiles).sentence).toMatch(/^Nothing is connected yet/)

    const own: PlatformResponse = { ...viaEnv, sourceByField: { langfuse_host: 'project', langfuse_public_key_ref: 'project', langfuse_secret_key_ref: 'project' } }
    expect(buildConnectionGrid(input({ platform: own, history: [probe('langfuse')] })).map((t) => t.id)).toContain('langfuse')
  })

  it('shows Claude Code only once it is set up, so a failing agent is never hidden from the grid', () => {
    const withClaude: PlatformResponse = { ...platform, platform: { ...platform.platform, claude_code_agent: { claude_api_key_ref: 'ref' } } }
    const tiles = buildConnectionGrid(input({ platform: withClaude, history: [probe('sentry'), probe('github'), probe('claude_code_agent', 'down', 'HTTP 401')] }))
    expect(tiles.map((t) => t.id)).toContain('claude_code_agent')
    expect(brokenConnections(tiles).map((t) => t.id)).toEqual(['claude_code_agent'])
  })

  it("Sentry's tile is the verdict Settings → General reads, from the same inputs (e469ff36)", () => {
    const tile = buildConnectionGrid(input()).find((t) => t.id === 'sentry')!
    const shared = sentryConnectionFromPageData({ platform, history: [probe('sentry'), probe('github')], deliveries: [], now: NOW })
    expect(tile.view).toEqual(shared)
    // Importing automatically is working, not "needs attention" over a missing webhook.
    expect(tile.view.state).toBe('working')
    expect(tile.lastLabel).toBe('Last import')
  })

  it('a configured tool with a failing check needs you; an unconfigured one does not', () => {
    const tiles = buildConnectionGrid(input({ history: [probe('sentry'), probe('github', 'down', 'HTTP 401 Bad credentials')] }))
    expect(brokenConnections(tiles).map((t) => t.id)).toEqual(['github'])
    expect(tiles.find((t) => t.id === 'cursor_cloud')!.view.state).toBe('not_connected')
  })

  it('a Slack channel nothing can post to needs you, with the card’s words', () => {
    const tiles = buildConnectionGrid(input({ slack: { configured: true, canPost: false, channelId: 'C1' } }))
    const slack = tiles.find((t) => t.id === 'slack')!
    expect(slack.view).toEqual({ state: 'attention', detail: 'No Slack bot can post to this channel yet.' })
  })
})

describe('connectionGridSentence', () => {
  it('names the broken connections', () => {
    const tiles = buildConnectionGrid(
      input({
        history: [probe('sentry'), probe('github', 'down', 'HTTP 401')],
        slack: { configured: true, canPost: false, channelId: 'C1' },
      }),
    )
    expect(connectionGridSentence(tiles)).toEqual({ sentence: 'GitHub and Slack need you.', tone: 'warn' })
  })

  it('says all is well when every connected tool works', () => {
    expect(connectionGridSentence(buildConnectionGrid(input()))).toEqual({ sentence: '2 connected and working.', tone: 'ok' })
  })

  // One tool set up and never tested read "1 connected, 1 not tested yet"
  // beside tiles that showed nothing connected (integrator, 2026-10-28).
  it('counts a tool that is set up but not tested once', () => {
    expect(connectionGridSentence(buildConnectionGrid(input({ history: [probe('sentry')] })))).toEqual({
      sentence: '1 connected and working, 1 not tested yet.',
      tone: 'neutral',
    })
    expect(connectionGridSentence(buildConnectionGrid(input({ history: [] })))).toEqual({
      sentence: '2 set up, not tested yet.',
      tone: 'neutral',
    })
  })

  // Connecting only Discord read "Nothing is connected yet. Start with GitHub"
  // beside a Discord card saying Connected (first-time user test, 2026-10-28).
  it('counts an alert channel that is only Discord or Teams', () => {
    const only = input({ platform: { platform: {} }, history: [], discordConfigured: true, teamsConfigured: true })
    const tiles = buildConnectionGrid(only)
    expect(tiles.map((t) => t.id)).toEqual(expect.arrayContaining(['discord', 'teams']))
    expect(connectionGridSentence(tiles).sentence).toBe('2 set up, not tested yet.')
  })

  it('with nothing connected, points at GitHub first', () => {
    const empty = input({ platform: { platform: {} }, history: [] })
    expect(connectionGridSentence(buildConnectionGrid(empty)).sentence).toMatch(/^Nothing is connected yet/)
  })
})
